# Multi-Role Auth (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the current auth gap in Estate Security Manager — `/passes/new` accepts a client-supplied `unitId` for any unit, and `/gate/[gateId]` has no login at all — by adding Resident (WhatsApp OTP), Guard, and Estate Admin (email+password) authentication via NextAuth v5.

**Architecture:** Single NextAuth v5 instance with two Credentials providers (`resident-otp`, `staff-login`), JWT session strategy (no DB session table), role/scope embedded in the JWT (`role`, plus `unitId` for residents or `userId`+`estateId` for staff). `src/middleware.ts` redirects unauthenticated page visits to the right login screen; every route handler additionally calls an explicit session-check helper before touching data, so route protection isn't middleware-only.

**Tech Stack:** Next.js 15 App Router, TypeScript (strict), Prisma/PostgreSQL, `next-auth@5.0.0-beta.32`, Node's built-in `crypto` (scrypt for passwords — no new hashing dependency, consistent with the rest of this codebase).

## Global Constraints

- Never store a plaintext password or OTP. Passwords: scrypt with a random salt (`src/lib/auth/password.ts`). Resident login OTPs: reuse the existing HMAC pattern in `src/lib/access-code.ts` (`generateAccessCode`, `hashAccessCode`, `accessCodesMatch`) — do not invent a second OTP-hashing scheme.
- Failed logins (both flows) return a generic error and must not reveal which half of the credential was wrong or whether a phone/email is registered.
- Every new/modified API route must rate-limit via the existing `isRateLimited` helper (`src/lib/rate-limit.ts`), following the `` `<purpose>:${clientIp}` `` key pattern already used in `check-in`/`check-out`/`incident`.
- This project has no automated test suite and the approved design spec explicitly scopes that out (`docs/superpowers/specs/2026-08-02-multi-role-auth-design.md`, Non-goals). Each task's verification step is therefore a concrete manual check (curl command, `psql` query, or browser flow with exact expected output) rather than an automated test — do not introduce a new test framework as part of this plan.
- After every task: `npx tsc --noEmit -p tsconfig.json` and `npx eslint .` must both be clean before committing.
- Session `maxAge`: 30 days for `RESIDENT`, 12 hours for `GUARD`/`ESTATE_ADMIN` (set via `token.exp` in the `jwt` callback — see Task 3, Step 3, which includes a verification step for this specific behavior since it's the least-standard part of the NextAuth config).

---

## File Structure

New:
- `src/lib/auth/password.ts` — scrypt hash/verify.
- `src/auth.ts` — NextAuth v5 config (providers, callbacks, session options).
- `src/app/api/auth/[...nextauth]/route.ts` — NextAuth route handler.
- `src/types/next-auth.d.ts` — module augmentation for `Session`/`JWT`/`User` custom fields.
- `src/lib/auth/require-session.ts` — `requireResidentSession()` / `requireStaffSession()` helpers used by route handlers and server components.
- `src/app/api/auth/resident/request-otp/route.ts` — generates + sends the resident login OTP.
- `src/app/login/page.tsx` — resident phone → OTP login (two-step client form).
- `src/app/staff/login/page.tsx` — guard/admin email+password login.
- `src/middleware.ts` — page-level redirect-to-login for unauthenticated visits.

Modified:
- `prisma/schema.prisma` — add `UserRole`, `User`, `ResidentLoginOtp`; add `otpLogins` relation on `Unit`.
- `prisma/seed.ts` — create a bootstrap `ESTATE_ADMIN` user.
- `src/app/api/visitor/pre-clearance/route.ts` — `unitId` from session, not request body.
- `src/components/PassRequestForm.tsx` — drop the unit `<select>`; show the resident's own unit as read-only text.
- `src/app/passes/new/page.tsx` — require resident session; fetch only that one unit.
- `src/app/api/gate/check-in/route.ts`, `check-out/route.ts`, `incident/route.ts` — require Guard/Admin session; verify the gate belongs to the caller's estate.
- `src/app/gate/page.tsx`, `src/app/gate/[gateId]/page.tsx` — require Guard/Admin session; scope the gate list/lookup to `session.estateId`.
- `src/components/GuardGateDashboard.tsx` — add a sign-out button.
- `.env.example` — add `AUTH_SECRET`.
- `package.json` — add `next-auth`.

---

### Task 1: Schema — User, UserRole, ResidentLoginOtp

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `User { id, email, passwordHash, role: UserRole, estateId, active, createdAt }`, `UserRole = "GUARD" | "ESTATE_ADMIN"`, `ResidentLoginOtp { id, unitId, otpHash, attempts, expiresAt, createdAt }`.

- [ ] **Step 1: Add the models**

Add this enum near the existing enums (after `GateAccessStatus`, schema.prisma:28):

```prisma
enum UserRole {
  GUARD
  ESTATE_ADMIN
}
```

Add these models after the `Gate` model (schema.prisma:112, right before the `GateAccessLog` comment):

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  role         UserRole
  estateId     String
  estate       Estate   @relation(fields: [estateId], references: [id])
  active       Boolean  @default(true)
  createdAt    DateTime @default(now())

  @@index([estateId])
}

// Hashed, one-time, short-lived OTP for resident login — mirrors the
// VisitorPass/access-code.ts pattern (HMAC hash at rest, timing-safe
// compare, attempt-limited) rather than a second OTP scheme.
model ResidentLoginOtp {
  id        String   @id @default(cuid())
  unitId    String
  unit      Unit     @relation(fields: [unitId], references: [id])
  otpHash   String
  attempts  Int      @default(0)
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([unitId])
}
```

- [ ] **Step 2: Add the reverse relations**

In `model Estate` (schema.prisma:30-37), add `users User[]` alongside `units`/`gates`:

```prisma
model Estate {
  id        String   @id @default(cuid())
  name      String
  code      String   @unique
  units     Unit[]
  gates     Gate[]
  users     User[]
  createdAt DateTime @default(now())
}
```

In `model Unit` (schema.prisma:39-51), add `otpLogins ResidentLoginOtp[]`:

```prisma
model Unit {
  id         String        @id @default(cuid())
  unitNumber String
  estateId   String
  estate     Estate        @relation(fields: [estateId], references: [id])
  passes     VisitorPass[]
  otpLogins  ResidentLoginOtp[]

  residentPhone String? @unique

  @@index([estateId])
}
```

- [ ] **Step 3: Migrate**

Run: `cd /home/byron/apps/estate-security && npx prisma migrate dev --name add_auth_models`

Expected: `Applying migration ... add_auth_models` followed by `Your database is now in sync with your schema.` and a regenerated Prisma Client.

- [ ] **Step 4: Verify**

Run: `psql postgresql://estate_security:estate_security@localhost:5433/estate_security -c '\d "User"'`

Expected: table description showing `id`, `email`, `passwordHash`, `role`, `estateId`, `active`, `createdAt` columns.

- [ ] **Step 5: Commit**

```bash
cd /home/byron/apps/estate-security
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add User, ResidentLoginOtp models for multi-role auth"
```

---

### Task 2: Password hashing

**Files:**
- Create: `src/lib/auth/password.ts`

**Interfaces:**
- Produces: `hashPassword(password: string): Promise<string>`, `verifyPassword(password: string, stored: string): Promise<boolean>`.

- [ ] **Step 1: Write the module**

```typescript
// src/lib/auth/password.ts
import crypto from "crypto";

const KEY_LENGTH = 64;

function scryptAsync(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/** Returns "salt:hashHex", safe to store in User.passwordHash. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(password, salt);
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;

  const derivedKey = await scryptAsync(password, salt);
  const storedBuf = Buffer.from(hashHex, "hex");
  if (derivedKey.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derivedKey, storedBuf);
}
```

- [ ] **Step 2: Verify with a throwaway script**

Run:
```bash
cd /home/byron/apps/estate-security
npx tsx -e '
import { hashPassword, verifyPassword } from "./src/lib/auth/password";
(async () => {
  const stored = await hashPassword("correct-horse-battery-staple");
  console.log("stored:", stored);
  console.log("correct password matches:", await verifyPassword("correct-horse-battery-staple", stored));
  console.log("wrong password matches:", await verifyPassword("wrong-password", stored));
})();
'
```

Expected output: `stored: <hex>:<hex>`, `correct password matches: true`, `wrong password matches: false`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/password.ts
git commit -m "feat: add scrypt password hashing for staff accounts"
```

---

### Task 3: NextAuth v5 config

**Files:**
- Modify: `package.json`
- Modify: `.env.example`
- Create: `src/types/next-auth.d.ts`
- Create: `src/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`

**Interfaces:**
- Consumes: `hashAccessCode`, `accessCodesMatch` from `@/lib/access-code` (`src/lib/access-code.ts:18,22`); `verifyPassword` from `@/lib/auth/password` (Task 2); `prisma` from `@/lib/prisma`.
- Produces: `auth()`, `signIn()`, `signOut()`, `handlers` exported from `@/auth`. `Session.user: { role: "RESIDENT" | "GUARD" | "ESTATE_ADMIN"; unitId?: string; userId?: string; estateId?: string }`.

- [ ] **Step 1: Add the dependency and env var**

In `package.json` (package.json:13-23), add to `dependencies`:

```json
    "next-auth": "5.0.0-beta.32",
```

In `.env.example` (after line 6, the `ACCESS_CODE_SECRET` block), add:

```bash
# Signs/encrypts NextAuth session JWTs. Generate with: openssl rand -hex 32
AUTH_SECRET=""
```

Run: `cd /home/byron/apps/estate-security && npm install`

Expected: `next-auth@5.0.0-beta.32` added to `node_modules` and `package-lock.json`.

- [ ] **Step 2: Type augmentation**

```typescript
// src/types/next-auth.d.ts
import { DefaultSession } from "next-auth";

export type AppRole = "RESIDENT" | "GUARD" | "ESTATE_ADMIN";

declare module "next-auth" {
  interface User {
    role: AppRole;
    unitId?: string;
    estateId?: string;
  }

  interface Session {
    user: {
      role: AppRole;
      unitId?: string;
      userId?: string;
      estateId?: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: AppRole;
    unitId?: string;
    userId?: string;
    estateId?: string;
  }
}
```

- [ ] **Step 3: Write the NextAuth config**

```typescript
// src/auth.ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { accessCodesMatch, hashAccessCode } from "@/lib/access-code";
import { verifyPassword } from "@/lib/auth/password";

const RESIDENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const STAFF_MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours
const MAX_OTP_ATTEMPTS = 5;

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: RESIDENT_MAX_AGE_SECONDS },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      id: "resident-otp",
      name: "Resident OTP",
      credentials: { phone: {}, code: {} },
      authorize: async (credentials) => {
        const phone = credentials?.phone as string | undefined;
        const code = credentials?.code as string | undefined;
        if (!phone || !code) return null;

        const unit = await prisma.unit.findUnique({ where: { residentPhone: phone } });
        if (!unit) return null;

        const otpRecord = await prisma.residentLoginOtp.findFirst({
          where: { unitId: unit.id, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
        });
        if (!otpRecord || otpRecord.attempts >= MAX_OTP_ATTEMPTS) return null;

        if (!accessCodesMatch(code, otpRecord.otpHash)) {
          await prisma.residentLoginOtp.update({
            where: { id: otpRecord.id },
            data: { attempts: { increment: 1 } },
          });
          return null;
        }

        // One-time use.
        await prisma.residentLoginOtp.delete({ where: { id: otpRecord.id } });

        return { id: unit.id, role: "RESIDENT", unitId: unit.id };
      },
    }),
    Credentials({
      id: "staff-login",
      name: "Staff Login",
      credentials: { email: {}, password: {} },
      authorize: async (credentials) => {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.active) return null;

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, role: user.role, estateId: user.estateId };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        if (user.role === "RESIDENT") {
          token.unitId = user.unitId;
        } else {
          token.userId = user.id;
          token.estateId = user.estateId;
        }
        const maxAgeSeconds = user.role === "RESIDENT" ? RESIDENT_MAX_AGE_SECONDS : STAFF_MAX_AGE_SECONDS;
        token.exp = Math.floor(Date.now() / 1000) + maxAgeSeconds;
      }
      return token;
    },
    session({ session, token }) {
      session.user.role = token.role as "RESIDENT" | "GUARD" | "ESTATE_ADMIN";
      session.user.unitId = token.unitId;
      session.user.userId = token.userId;
      session.user.estateId = token.estateId;
      return session;
    },
  },
});
```

- [ ] **Step 4: Route handler**

```typescript
// src/app/api/auth/[...nextauth]/route.ts
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 5: Verify — confirm the shorter staff expiry actually takes effect**

This is the one part of the config that isn't a well-trodden NextAuth default (per-role `maxAge` via manually setting `token.exp`), so verify it directly rather than trusting the code:

```bash
cd /home/byron/apps/estate-security
AUTH_SECRET=$(openssl rand -hex 32)
echo "AUTH_SECRET=\"$AUTH_SECRET\"" >> .env
npm run dev
```

Once the server is up, in another terminal seed a temporary test user and sign in via curl:

```bash
npx tsx -e '
import { prisma } from "./src/lib/prisma";
import { hashPassword } from "./src/lib/auth/password";
(async () => {
  const estate = await prisma.estate.findFirst();
  await prisma.user.upsert({
    where: { email: "test-admin@example.com" },
    update: {},
    create: { email: "test-admin@example.com", passwordHash: await hashPassword("test-password-123"), role: "ESTATE_ADMIN", estateId: estate!.id },
  });
  console.log("seeded test-admin@example.com");
})();
'
```

Then sign in and decode the resulting JWT cookie's `exp` claim:

```bash
COOKIE_JAR=/tmp/estate-auth-cookies.txt
CSRF=$(curl -s -c "$COOKIE_JAR" http://localhost:3000/api/auth/csrf | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).csrfToken))')
curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X POST http://localhost:3000/api/auth/callback/staff-login \
  -d "email=test-admin@example.com&password=test-password-123&csrfToken=$CSRF&json=true" > /dev/null
JWT=$(grep authjs.session-token "$COOKIE_JAR" | awk '{print $7}')
node -e "const p='$JWT'.split('.'); console.log(JSON.parse(Buffer.from(p[1],'base64').toString()))"
```

Expected: the decoded payload's `exp` is roughly `Math.floor(Date.now()/1000) + 43200` (12 hours), **not** 30 days out. If `exp` instead reflects the 30-day default, the manual `token.exp` assignment in Step 3 isn't taking effect — check that `jwt.encode` isn't being overridden elsewhere and that this callback runs (add a temporary `console.log(token)` in the `jwt` callback to confirm).

Clean up the temporary test user afterward:

```bash
npx tsx -e 'import { prisma } from "./src/lib/prisma"; prisma.user.delete({ where: { email: "test-admin@example.com" } }).then(() => prisma.$disconnect());'
```

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint .
git add package.json package-lock.json .env.example src/types/next-auth.d.ts src/auth.ts src/app/api/auth
git commit -m "feat: NextAuth v5 config with resident-otp and staff-login providers"
```

---

### Task 4: Session helpers

**Files:**
- Create: `src/lib/auth/require-session.ts`

**Interfaces:**
- Consumes: `auth` from `@/auth` (Task 3).
- Produces: `requireResidentSession(): Promise<{ unitId: string } | null>`, `requireStaffSession(allowedRoles: ("GUARD" | "ESTATE_ADMIN")[]): Promise<{ userId: string; estateId: string; role: "GUARD" | "ESTATE_ADMIN" } | null>`.

- [ ] **Step 1: Write the helpers**

```typescript
// src/lib/auth/require-session.ts
import { auth } from "@/auth";

export async function requireResidentSession(): Promise<{ unitId: string } | null> {
  const session = await auth();
  if (session?.user?.role !== "RESIDENT" || !session.user.unitId) return null;
  return { unitId: session.user.unitId };
}

export async function requireStaffSession(
  allowedRoles: Array<"GUARD" | "ESTATE_ADMIN">,
): Promise<{ userId: string; estateId: string; role: "GUARD" | "ESTATE_ADMIN" } | null> {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || role === "RESIDENT" || !role || !allowedRoles.includes(role)) return null;
  if (!session.user.userId || !session.user.estateId) return null;
  return { userId: session.user.userId, estateId: session.user.estateId, role };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: no errors. (No runtime verification here — this file has no behavior beyond delegating to `auth()`, exercised end-to-end in Tasks 9-11.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/require-session.ts
git commit -m "feat: add requireResidentSession/requireStaffSession helpers"
```

---

### Task 5: Resident OTP request route

**Files:**
- Create: `src/app/api/auth/resident/request-otp/route.ts`

**Interfaces:**
- Consumes: `generateAccessCode`, `hashAccessCode` from `@/lib/access-code`; `sendWhatsAppMessage` from `@/lib/whatsapp`; `isRateLimited` from `@/lib/rate-limit`.
- Produces: `POST /api/auth/resident/request-otp` — `{ phone: string }` → always `{ success: true, message: string }`.

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/auth/resident/request-otp/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateAccessCode, hashAccessCode } from "@/lib/access-code";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { isRateLimited } from "@/lib/rate-limit";

const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
const OTP_TTL_MS = 5 * 60_000;

export async function POST(req: Request) {
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(`resident-otp-request:${clientIp}`, RATE_LIMIT_MAX_ATTEMPTS, RATE_LIMIT_WINDOW_MS)) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  let body: { phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const phone = body.phone?.trim();
  if (!phone) {
    return NextResponse.json({ error: "phone is required" }, { status: 400 });
  }

  const unit = await prisma.unit.findUnique({ where: { residentPhone: phone } });

  // Identical response whether or not the phone is registered — this
  // endpoint must not be usable to enumerate residents.
  if (unit) {
    const code = generateAccessCode();
    await prisma.residentLoginOtp.create({
      data: {
        unitId: unit.id,
        otpHash: hashAccessCode(code),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });
    await sendWhatsAppMessage(phone, `Your Estate Security login code is: *${code}*. It expires in 5 minutes.`);
  }

  return NextResponse.json({ success: true, message: "If that number is registered, a code has been sent." });
}
```

- [ ] **Step 2: Verify**

With the dev server running and the demo seed applied (`residentPhone: "27821234567"` on `demo-unit-1`):

```bash
curl -s -X POST http://localhost:3000/api/auth/resident/request-otp \
  -H "Content-Type: application/json" -d '{"phone":"27821234567"}'
```

Expected: `{"success":true,"message":"If that number is registered, a code has been sent."}`. Then:

```bash
psql postgresql://estate_security:estate_security@localhost:5433/estate_security \
  -c 'SELECT "unitId", "expiresAt", attempts FROM "ResidentLoginOtp" ORDER BY "createdAt" DESC LIMIT 1;'
```

Expected: one row for `demo-unit-1`, `attempts = 0`, `expiresAt` ~5 minutes from now. Then repeat the curl with an unregistered number:

```bash
curl -s -X POST http://localhost:3000/api/auth/resident/request-otp \
  -H "Content-Type: application/json" -d '{"phone":"27800000000"}'
```

Expected: identical `{"success":true,...}` response, and no new row in `ResidentLoginOtp`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/auth/resident/request-otp
git commit -m "feat: resident OTP request endpoint"
```

---

### Task 6: Resident login page

**Files:**
- Create: `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/resident/request-otp` (Task 5); `signIn("resident-otp", {...})` from `next-auth/react`.

- [ ] **Step 1: Write the page**

```tsx
// src/app/login/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export default function ResidentLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await fetch("/api/auth/resident/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      setStep("code");
    } finally {
      setSubmitting(false);
    }
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    const res = await signIn("resident-otp", { phone, code, redirect: false });
    setSubmitting(false);
    if (!res || res.error) {
      setError("Invalid or expired code");
      return;
    }
    router.push("/passes/new");
    router.refresh();
  };

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="max-w-sm w-full p-6 border rounded-xl shadow-md bg-white">
        <h1 className="text-xl font-bold mb-4">Resident Login</h1>

        {step === "phone" ? (
          <form onSubmit={requestCode} className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">WhatsApp Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+27..."
              required
              className="w-full p-2 border rounded-lg"
            />
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-blue-600 text-white font-bold rounded-lg disabled:opacity-50"
            >
              {submitting ? "Sending..." : "Send Code"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCode} className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">6-Digit Code</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
              className="w-full p-2 border rounded-lg text-center text-2xl tracking-widest font-mono"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-blue-600 text-white font-bold rounded-lg disabled:opacity-50"
            >
              {submitting ? "Verifying..." : "Verify & Log In"}
            </button>
            <button
              type="button"
              onClick={() => setStep("phone")}
              className="w-full py-2 text-sm text-gray-500 underline"
            >
              Use a different number
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify end-to-end in the browser**

With the dev server running: visit `http://localhost:3000/login`, enter `27821234567`, click "Send Code". Check the dev server log (or `ResidentLoginOtp` table per Task 5 Step 2) for the code, since WhatsApp isn't configured in dev (`sendWhatsAppMessage` returns `delivered: false` silently — see `src/lib/whatsapp.ts`). Retrieve the plaintext code directly from the OTP generation for this manual check:

```bash
npx tsx -e '
import { prisma } from "./src/lib/prisma";
(async () => {
  const otp = await prisma.residentLoginOtp.findFirst({ orderBy: { createdAt: "desc" } });
  console.log(otp);
})();
'
```

This only shows the hash, not the plaintext (by design) — for this manual verification, temporarily add `console.log("DEV OTP:", code)` right after `const code = generateAccessCode();` in `src/app/api/auth/resident/request-otp/route.ts`, request a code, read it from the terminal running `npm run dev`, then **remove the console.log before committing**.

Enter the code on `/login`. Expected: redirect to `/passes/new` (which at this point in the plan still shows the old unit dropdown — that's fixed in Task 9).

- [ ] **Step 3: Commit**

```bash
git add src/app/login
git commit -m "feat: resident phone/OTP login page"
```

---

### Task 7: Staff login page

**Files:**
- Create: `src/app/staff/login/page.tsx`

**Interfaces:**
- Consumes: `signIn("staff-login", {...})`, `getSession()` from `next-auth/react`.

- [ ] **Step 1: Write the page**

```tsx
// src/app/staff/login/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, getSession } from "next-auth/react";

export default function StaffLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const res = await signIn("staff-login", { email, password, redirect: false });
    if (!res || res.error) {
      setSubmitting(false);
      setError("Invalid email or password");
      return;
    }

    const session = await getSession();
    router.push(session?.user?.role === "ESTATE_ADMIN" ? "/admin" : "/gate");
    router.refresh();
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="max-w-sm w-full p-6 border border-slate-800 rounded-xl shadow-md bg-slate-900">
        <h1 className="text-xl font-bold mb-4">Staff Login</h1>
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block text-sm font-medium text-slate-300">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
          />
          <label className="block text-sm font-medium text-slate-300">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
          />
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 bg-blue-600 text-white font-bold rounded-lg disabled:opacity-50"
          >
            {submitting ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify**

Re-seed the temporary test admin from Task 3 Step 5 if it was cleaned up, visit `http://localhost:3000/staff/login`, sign in with `test-admin@example.com` / `test-password-123`. Expected: redirected toward `/admin` (which 404s until a later task adds it — that's fine, confirms the redirect logic works off `session.user.role`). Then clean up the test user again.

- [ ] **Step 3: Commit**

```bash
git add src/app/staff/login
git commit -m "feat: staff email/password login page"
```

---

### Task 8: Middleware

**Files:**
- Create: `src/middleware.ts`

**Interfaces:**
- Consumes: `auth` from `@/auth` (Task 3).

- [ ] **Step 1: Write the middleware**

```typescript
// src/middleware.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const role = req.auth?.user?.role;

  if (pathname.startsWith("/passes") && role !== "RESIDENT") {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (pathname.startsWith("/gate") && role !== "GUARD" && role !== "ESTATE_ADMIN") {
    return NextResponse.redirect(new URL("/staff/login", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/passes/:path*", "/gate/:path*"],
};
```

- [ ] **Step 2: Verify**

With no session cookie (use an incognito window or `curl -i`):

```bash
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" http://localhost:3000/passes/new
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" http://localhost:3000/gate/demo-gate-1
```

Expected: both `307` (or `308`) redirecting to `/login` and `/staff/login` respectively. Then log in as the resident from Task 6 and confirm `/passes/new` now loads (still with the old dropdown UI at this point — Task 9 fixes that), and log in as staff from Task 7 and confirm `/gate/demo-gate-1` loads.

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat: middleware route protection for /passes and /gate"
```

---

### Task 9: Fix pre-clearance to use the resident's session, not a client-supplied unitId

**Files:**
- Modify: `src/app/api/visitor/pre-clearance/route.ts`
- Modify: `src/components/PassRequestForm.tsx`
- Modify: `src/app/passes/new/page.tsx`

**Interfaces:**
- Consumes: `requireResidentSession()` from `@/lib/auth/require-session` (Task 4).

- [ ] **Step 1: Fix the API route**

Replace `src/app/api/visitor/pre-clearance/route.ts` in full:

```typescript
// src/app/api/visitor/pre-clearance/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateAccessCode, hashAccessCode } from "@/lib/access-code";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { requireResidentSession } from "@/lib/auth/require-session";

const MAX_DURATION_HOURS = 72;

export async function POST(req: Request) {
  const session = await requireResidentSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: {
    visitorName?: string;
    visitorPhone?: string;
    durationHours?: number;
    isMultiEntry?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { visitorName, visitorPhone, isMultiEntry = false } = body;
  const durationHours = Math.min(body.durationHours ?? 8, MAX_DURATION_HOURS);

  if (!visitorName || !visitorPhone) {
    return NextResponse.json({ error: "visitorName and visitorPhone are required" }, { status: 400 });
  }
  if (durationHours <= 0) {
    return NextResponse.json({ error: "durationHours must be positive" }, { status: 400 });
  }

  const unit = await prisma.unit.findUnique({
    where: { id: session.unitId },
    include: { estate: true },
  });
  if (!unit) {
    return NextResponse.json({ error: "Unit not found" }, { status: 404 });
  }

  const accessCode = generateAccessCode();
  const validFrom = new Date();
  const validTo = new Date(validFrom.getTime() + durationHours * 60 * 60 * 1000);

  const pass = await prisma.visitorPass.create({
    data: {
      unitId: unit.id,
      visitorName,
      visitorPhone,
      accessCodeHash: hashAccessCode(accessCode),
      status: "ACTIVE",
      validFrom,
      validTo,
      isMultiEntry,
    },
  });

  const waMessage = `Hi ${visitorName}, your gate pass for ${unit.estate.name} (Unit ${unit.unitNumber}) is: *${accessCode}*. Valid until ${validTo.toLocaleTimeString(
    "en-ZA",
  )}. Do not share this code.`;

  const whatsapp = await sendWhatsAppMessage(visitorPhone, waMessage);

  return NextResponse.json({
    success: true,
    passId: pass.id,
    accessCode,
    validFrom,
    validTo,
    whatsapp,
  });
}
```

- [ ] **Step 2: Simplify PassRequestForm — drop the unit picker**

Replace `src/components/PassRequestForm.tsx` in full:

```tsx
// src/components/PassRequestForm.tsx
"use client";

import { useState } from "react";
import { SharePassModal } from "@/components/SharePassModal";

interface Result {
  success: boolean;
  passId?: string;
  accessCode?: string;
  validTo?: string;
  whatsapp?: { delivered: boolean; error?: string };
  error?: string;
}

export default function PassRequestForm({ unitLabel }: { unitLabel: string }) {
  const [visitorName, setVisitorName] = useState("");
  const [visitorPhone, setVisitorPhone] = useState("");
  const [durationHours, setDurationHours] = useState(8);
  const [isMultiEntry, setIsMultiEntry] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);

    try {
      const res = await fetch("/api/visitor/pre-clearance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorName, visitorPhone, durationHours, isMultiEntry }),
      });
      const data = await res.json();
      setResult(res.ok ? data : { success: false, error: data.error });
    } catch {
      setResult({ success: false, error: "Network error creating pass" });
    } finally {
      setSubmitting(false);
    }
  };

  if (result?.success && result.passId && result.accessCode) {
    return (
      <div className="max-w-sm mx-auto">
        {result.whatsapp?.delivered === false && (
          <div className="mb-3 p-3 bg-amber-100 border border-amber-400 text-amber-800 rounded-lg text-sm">
            WhatsApp delivery failed ({result.whatsapp.error}) — share the pass below manually.
          </div>
        )}
        <SharePassModal
          passId={result.passId}
          accessCode={result.accessCode}
          visitorName={visitorName}
          validTo={result.validTo ? new Date(result.validTo).toLocaleString("en-ZA") : ""}
        />
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-4 border rounded-xl shadow-md bg-white">
      <h2 className="text-xl font-bold mb-1">Request Visitor Pass</h2>
      <p className="text-sm text-gray-500 mb-4">{unitLabel}</p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Visitor Name</label>
          <input
            value={visitorName}
            onChange={(e) => setVisitorName(e.target.value)}
            required
            className="w-full p-2 border rounded-lg"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Visitor Phone (WhatsApp)
          </label>
          <input
            type="tel"
            value={visitorPhone}
            onChange={(e) => setVisitorPhone(e.target.value)}
            placeholder="+27..."
            required
            className="w-full p-2 border rounded-lg"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Valid For (hours)</label>
          <input
            type="number"
            min={1}
            max={72}
            value={durationHours}
            onChange={(e) => setDurationHours(Number(e.target.value))}
            className="w-full p-2 border rounded-lg"
          />
        </div>

        <label className="flex items-center space-x-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={isMultiEntry}
            onChange={(e) => setIsMultiEntry(e.target.checked)}
          />
          <span>Multi-entry (e.g. contractor working over several days)</span>
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
        >
          {submitting ? "Issuing..." : "Issue Pass"}
        </button>
      </form>

      {result && !result.success && (
        <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-800 rounded-lg">
          {result.error}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update the page to require a resident session and pass the unit label**

Replace `src/app/passes/new/page.tsx` in full:

```tsx
// src/app/passes/new/page.tsx
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import PassRequestForm from "@/components/PassRequestForm";
import { requireResidentSession } from "@/lib/auth/require-session";

export const dynamic = "force-dynamic";

export default async function NewPassPage() {
  const session = await requireResidentSession();
  if (!session) redirect("/login");

  const unit = await prisma.unit.findUnique({
    where: { id: session.unitId },
    include: { estate: true },
  });
  if (!unit) redirect("/login");

  const unitLabel = `${unit.estate.name} — Unit ${unit.unitNumber}`;

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <PassRequestForm unitLabel={unitLabel} />
    </main>
  );
}
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint .
```

Expected: clean. Then in the browser: log in at `/login` as the resident (Task 6), land on `/passes/new`, confirm the unit dropdown is gone and replaced by the "Demo Estate — Unit 12A" label, issue a pass, confirm the `SharePassModal` still appears. Then, with that same session, confirm the vulnerability is closed:

```bash
curl -s -X POST http://localhost:3000/api/visitor/pre-clearance \
  -H "Content-Type: application/json" \
  -d '{"unitId":"some-other-unit-id","visitorName":"Test","visitorPhone":"27800000001"}'
```

(No session cookie attached.) Expected: `{"error":"Not authenticated"}` with a 401 — the endpoint no longer accepts a client-supplied `unitId` at all, session or not.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/visitor/pre-clearance/route.ts src/components/PassRequestForm.tsx src/app/passes/new/page.tsx
git commit -m "fix: scope visitor pass issuance to the resident's own session, not a client-supplied unitId"
```

---

### Task 10: Protect gate API routes

**Files:**
- Modify: `src/app/api/gate/check-in/route.ts`
- Modify: `src/app/api/gate/check-out/route.ts`
- Modify: `src/app/api/gate/incident/route.ts`

**Interfaces:**
- Consumes: `requireStaffSession(["GUARD", "ESTATE_ADMIN"])` from `@/lib/auth/require-session` (Task 4).

- [ ] **Step 1: check-in**

In `src/app/api/gate/check-in/route.ts`, add the import (after line 7, `import { sendWhatsAppMessage } ...`):

```typescript
import { requireStaffSession } from "@/lib/auth/require-session";
```

At the top of `export async function POST(req: Request) {` (check-in/route.ts:31), before the `clientIp` line, add the session check and estate-scoping. This changes the batch-processing behavior: since a single tablet session covers every item in the batch, verify the session once up front and reject the whole request if it fails; then reject individual items whose `gateId` doesn't belong to the session's estate (a compromised/misconfigured tablet shouldn't be able to write access logs for a gate outside its estate):

```typescript
export async function POST(req: Request) {
  const staff = await requireStaffSession(["GUARD", "ESTATE_ADMIN"]);
  if (!staff) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  // ... (rest of the function unchanged up to the per-item loop)
```

Inside the `for (const payload of requests) {` loop (check-in/route.ts:56), immediately after the existing `if (!idempotencyKey || !accessCode || !gateId || !scannedAt) {` block (check-in/route.ts:59-66), add a gate-ownership check:

```typescript
    const gate = await prisma.gate.findUnique({ where: { id: gateId } });
    if (!gate || gate.estateId !== staff.estateId) {
      results.push({ idempotencyKey, success: false, status: "DENIED_INVALID_CODE" });
      continue;
    }
```

(This makes the existing `const gate = await prisma.gate.findUnique({ where: { id: gateId } });` at check-in/route.ts:166, inside the WhatsApp-alert block, redundant — remove that duplicate lookup and reuse the `gate` variable already in scope from this new check.)

- [ ] **Step 2: check-out**

In `src/app/api/gate/check-out/route.ts`, add the import (after line 4):

```typescript
import { requireStaffSession } from "@/lib/auth/require-session";
```

At the top of `export async function POST(req: Request) {` (check-out/route.ts:29), before the rate-limit check:

```typescript
export async function POST(req: Request) {
  const staff = await requireStaffSession(["GUARD", "ESTATE_ADMIN"]);
  if (!staff) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  // ... (rest unchanged)
```

After the existing validation block (check-out/route.ts:46-51, the `if (!gateId || (!accessCode && !licensePlate))` check), add:

```typescript
  const gate = await prisma.gate.findUnique({ where: { id: gateId } });
  if (!gate || gate.estateId !== staff.estateId) {
    return NextResponse.json({ error: "Gate not found" }, { status: 404 });
  }
```

- [ ] **Step 3: incident**

In `src/app/api/gate/incident/route.ts`, add the import (after line 2):

```typescript
import { requireStaffSession } from "@/lib/auth/require-session";
```

At the top of `export async function POST(req: Request) {` (incident/route.ts:17):

```typescript
export async function POST(req: Request) {
  const staff = await requireStaffSession(["GUARD", "ESTATE_ADMIN"]);
  if (!staff) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  // ... (rest unchanged)
```

After the existing validation block (incident/route.ts:33-35, `if (!gateId || !reason?.trim())`), add the same gate-ownership check as Steps 1-2:

```typescript
  const gate = await prisma.gate.findUnique({ where: { id: gateId } });
  if (!gate || gate.estateId !== staff.estateId) {
    return NextResponse.json({ error: "Gate not found" }, { status: 404 });
  }
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint .
```

Then, unauthenticated:

```bash
curl -s -X POST http://localhost:3000/api/gate/check-in \
  -H "Content-Type: application/json" \
  -d '{"idempotencyKey":"test-1","accessCode":"123456","gateId":"demo-gate-1","scannedAt":"2026-08-02T00:00:00Z"}'
```

Expected: `{"error":"Not authenticated"}`, 401.

There is no durable staff account yet at this point in the plan (the bootstrap admin is seeded in Task 12, later) — seed a temporary one the same way Task 3 Step 5 and Task 7 Step 2 did, sign in, then confirm an authenticated call to `demo-gate-1` returns the normal `DENIED_INVALID_CODE` result for a bogus code, not a 401:

```bash
npx tsx -e '
import { prisma } from "./src/lib/prisma";
import { hashPassword } from "./src/lib/auth/password";
(async () => {
  const estate = await prisma.estate.findFirst();
  await prisma.user.upsert({
    where: { email: "test-admin@example.com" },
    update: {},
    create: { email: "test-admin@example.com", passwordHash: await hashPassword("test-password-123"), role: "ESTATE_ADMIN", estateId: estate!.id },
  });
})();
'
COOKIE_JAR=/tmp/estate-auth-cookies-task10.txt
CSRF=$(curl -s -c "$COOKIE_JAR" http://localhost:3000/api/auth/csrf | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).csrfToken))')
curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X POST http://localhost:3000/api/auth/callback/staff-login \
  -d "email=test-admin@example.com&password=test-password-123&csrfToken=$CSRF&json=true" > /dev/null

curl -s -b "$COOKIE_JAR" -X POST http://localhost:3000/api/gate/check-in \
  -H "Content-Type: application/json" \
  -d '{"idempotencyKey":"test-2","accessCode":"999999","gateId":"demo-gate-1","scannedAt":"2026-08-02T00:00:00Z"}'
```

Expected: `{"success":true,"processed":[{"idempotencyKey":"test-2","success":false,"status":"DENIED_INVALID_CODE","unitNumber":null}]}`. Clean up afterward:

```bash
npx tsx -e 'import { prisma } from "./src/lib/prisma"; prisma.user.delete({ where: { email: "test-admin@example.com" } }).then(() => prisma.$disconnect());'
rm -f /tmp/estate-auth-cookies-task10.txt
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/gate
git commit -m "fix: require staff session + estate-scoped gate ownership on check-in/check-out/incident"
```

---

### Task 11: Protect gate pages, scope gate list, add sign-out

**Files:**
- Modify: `src/app/gate/page.tsx`
- Modify: `src/app/gate/[gateId]/page.tsx`
- Modify: `src/components/GuardGateDashboard.tsx`

**Interfaces:**
- Consumes: `requireStaffSession(["GUARD", "ESTATE_ADMIN"])` from `@/lib/auth/require-session` (Task 4); `signOut` from `next-auth/react`.

- [ ] **Step 1: Gate index — scope to the caller's estate**

Replace `src/app/gate/page.tsx` in full:

```tsx
// src/app/gate/page.tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireStaffSession } from "@/lib/auth/require-session";

export const dynamic = "force-dynamic";

export default async function GateIndexPage() {
  const staff = await requireStaffSession(["GUARD", "ESTATE_ADMIN"]);
  if (!staff) redirect("/staff/login");

  const gates = await prisma.gate.findMany({
    where: { estateId: staff.estateId },
    include: { estate: true },
    orderBy: { name: "asc" },
  });

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold">Select Your Gate</h1>
      <p className="text-sm text-slate-400 mb-2">
        Tablets should bookmark or install directly to their assigned gate below.
      </p>
      <div className="flex flex-col gap-3 w-full max-w-sm">
        {gates.map((gate) => (
          <Link
            key={gate.id}
            href={`/gate/${gate.id}`}
            className="px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl font-semibold text-center hover:bg-slate-800 transition"
          >
            {gate.name}
            <span className="block text-xs text-slate-500 font-normal">{gate.estate.name}</span>
          </Link>
        ))}
        {gates.length === 0 && <p className="text-center text-slate-500 text-sm">No gates configured yet.</p>}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Gate terminal — require session, verify gate belongs to the estate**

Replace `src/app/gate/[gateId]/page.tsx` in full:

```tsx
// src/app/gate/[gateId]/page.tsx
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import GuardGateDashboard from "@/components/GuardGateDashboard";
import { requireStaffSession } from "@/lib/auth/require-session";

export const dynamic = "force-dynamic";

export default async function GatePage({ params }: { params: Promise<{ gateId: string }> }) {
  const staff = await requireStaffSession(["GUARD", "ESTATE_ADMIN"]);
  if (!staff) redirect("/staff/login");

  const { gateId } = await params;
  const gate = await prisma.gate.findUnique({ where: { id: gateId } });

  if (!gate || gate.estateId !== staff.estateId) notFound();

  return <GuardGateDashboard gateId={gate.id} gateName={gate.name} />;
}
```

- [ ] **Step 3: Sign-out button**

In `src/components/GuardGateDashboard.tsx`, make two import changes:

Replace line 4 (the `lucide-react` import) to add `LogOut`:

```typescript
import { Wifi, WifiOff, ShieldCheck, AlertTriangle, Delete, CheckCircle2, XCircle, RefreshCw, LogOut } from "lucide-react";
```

Add a new import line after line 8 (the `offline-sync` import):

```typescript
import { signOut } from "next-auth/react";
```

In the header's connectivity block (GuardGateDashboard.tsx:145-165), add a sign-out button before the closing `</div>` of the `flex items-center space-x-6` container:

```tsx
        <div className="flex items-center space-x-6">
          <PWAInstallPrompt />

          {pendingSyncCount > 0 && (
            <div className="flex items-center space-x-2 bg-amber-500/20 text-amber-300 border border-amber-500/40 px-4 py-2 rounded-lg font-mono text-sm">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>{pendingSyncCount} Sync Pending</span>
            </div>
          )}

          <div
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg border font-bold text-sm ${
              isOnline
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                : "bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse"
            }`}
          >
            {isOnline ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
            <span>{isOnline ? "ONLINE" : "OFFLINE MODE"}</span>
          </div>

          <button
            onClick={() => signOut({ callbackUrl: "/staff/login" })}
            className="flex items-center space-x-2 px-4 py-2 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm transition"
          >
            <LogOut className="w-5 h-5" />
            <span>SIGN OUT</span>
          </button>
        </div>
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint .
```

There is no durable staff account yet at this point in the plan (the bootstrap admin is seeded in Task 12, later) — seed a temporary one the same way Task 3 Step 5 and Task 7 Step 2 did:

```bash
npx tsx -e '
import { prisma } from "./src/lib/prisma";
import { hashPassword } from "./src/lib/auth/password";
(async () => {
  const estate = await prisma.estate.findFirst();
  await prisma.user.upsert({
    where: { email: "test-admin@example.com" },
    update: {},
    create: { email: "test-admin@example.com", passwordHash: await hashPassword("test-password-123"), role: "ESTATE_ADMIN", estateId: estate!.id },
  });
})();
'
```

Then in the browser: sign in at `/staff/login` with `test-admin@example.com` / `test-password-123`, land on `/gate`, confirm only `Main Boom North` (the demo estate's gate) is listed, open it, confirm the terminal loads and now has a "SIGN OUT" button in the header, click it, confirm it redirects to `/staff/login` and that revisiting `/gate/demo-gate-1` now redirects back to `/staff/login` (per Task 8's middleware). Clean up afterward:

```bash
npx tsx -e 'import { prisma } from "./src/lib/prisma"; prisma.user.delete({ where: { email: "test-admin@example.com" } }).then(() => prisma.$disconnect());'
```

- [ ] **Step 5: Commit**

```bash
git add src/app/gate "src/app/gate/[gateId]" src/components/GuardGateDashboard.tsx
git commit -m "fix: scope gate pages to caller's estate, add sign-out to guard terminal"
```

---

### Task 12: Bootstrap Estate Admin in seed

**Files:**
- Modify: `prisma/seed.ts`

**Interfaces:**
- Consumes: `hashPassword` from `@/lib/auth/password` (Task 2).

- [ ] **Step 1: Update the seed script**

Replace `prisma/seed.ts` in full:

```typescript
// prisma/seed.ts
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";

const prisma = new PrismaClient();

const SEED_ADMIN_EMAIL = "admin@demo-estate.test";
const SEED_ADMIN_PASSWORD = "change-me-immediately";

async function main() {
  const estate = await prisma.estate.upsert({
    where: { code: "DEMO" },
    update: {},
    create: { name: "Demo Estate", code: "DEMO" },
  });

  await prisma.unit.upsert({
    where: { id: "demo-unit-1" },
    update: {},
    create: {
      id: "demo-unit-1",
      unitNumber: "12A",
      estateId: estate.id,
      residentPhone: "27821234567",
    },
  });

  await prisma.gate.upsert({
    where: { id: "demo-gate-1" },
    update: {},
    create: { id: "demo-gate-1", name: "Main Boom North", estateId: estate.id },
  });

  await prisma.user.upsert({
    where: { email: SEED_ADMIN_EMAIL },
    update: {},
    create: {
      email: SEED_ADMIN_EMAIL,
      passwordHash: await hashPassword(SEED_ADMIN_PASSWORD),
      role: "ESTATE_ADMIN",
      estateId: estate.id,
    },
  });

  console.log("Seeded estate=%s unit=demo-unit-1 gate=demo-gate-1", estate.id);
  console.log("Bootstrap admin: %s / %s (change this password)", SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Verify**

```bash
cd /home/byron/apps/estate-security
npx prisma db seed
```

Expected: `Bootstrap admin: admin@demo-estate.test / change-me-immediately (change this password)` printed, and `/staff/login` accepts those credentials (there is currently no `/admin` route yet, so the post-login redirect to `/admin` 404s — expected until the follow-up Admin UI plan; `/gate` works immediately as an `ESTATE_ADMIN` too, since `requireStaffSession` in Task 11 allows both roles).

- [ ] **Step 3: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat: seed bootstrap Estate Admin account"
```

---

### Task 13: Final verification and README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Full verification pass**

```bash
cd /home/byron/apps/estate-security
npx tsc --noEmit -p tsconfig.json
npx eslint .
rm -f tsconfig.tsbuildinfo
DATABASE_URL="postgresql://estate_security:estate_security@localhost:5433/estate_security" \
AUTH_SECRET="$(grep AUTH_SECRET .env | cut -d'"' -f2)" \
ACCESS_CODE_SECRET="$(grep ACCESS_CODE_SECRET .env | cut -d'"' -f2)" \
npx next build
```

Expected: all three commands clean, build lists `/login`, `/staff/login`, and `/api/auth/[...nextauth]` among the routes alongside the existing ones.

- [ ] **Step 2: Manual end-to-end walkthrough**

1. `/passes/new` with no session → redirected to `/login`.
2. `/login` → phone `27821234567` → code from dev logs → lands on `/passes/new` showing "Demo Estate — Unit 12A", no dropdown.
3. Issue a pass, confirm `SharePassModal` shows the QR/PDF as before.
4. `/gate/demo-gate-1` with no session → redirected to `/staff/login`.
5. `/staff/login` with the seeded admin → lands on `/gate` (redirect target is `/admin`, which 404s — expected, confirms role-based redirect logic — but `/gate` itself is directly reachable and works) → confirm only the demo estate's gate is listed.
6. Open the gate terminal, confirm "SIGN OUT" is present and works.

- [ ] **Step 3: Update README**

Add a new section to `README.md`, after the existing "Security notes" section:

```markdown
## Authentication

Three roles, one NextAuth v5 instance (`src/auth.ts`), JWT sessions:

- **Resident** — phone number → WhatsApp OTP (`/login`,
  `POST /api/auth/resident/request-otp`, `resident-otp` Credentials
  provider). Session carries `unitId`; `/passes/new` and
  `POST /api/visitor/pre-clearance` no longer accept a client-supplied
  `unitId` at all — it comes from the session.
- **Guard / Estate Admin** — email + password (`/staff/login`,
  `staff-login` Credentials provider, `src/lib/auth/password.ts` for
  scrypt hashing). Session carries `estateId`; every gate route
  (`/gate`, `/gate/[gateId]`, `check-in`/`check-out`/`incident`) is scoped
  to gates belonging to that estate.
- Session length: 30 days for residents, 12 hours for staff (kiosk
  tablets shouldn't stay signed in indefinitely) — set via `token.exp` in
  the `jwt` callback, since NextAuth's `session.maxAge` is otherwise a
  single global value.
- `src/middleware.ts` redirects unauthenticated page visits to the right
  login screen; `src/lib/auth/require-session.ts` is the actual
  enforcement used inside every protected route handler and server
  component (defense in depth — don't rely on middleware alone).
- The first `ESTATE_ADMIN` account is created by `prisma/seed.ts`
  (`admin@demo-estate.test` / `change-me-immediately` for the demo
  estate — change this password). There is no public admin signup;
  Estate Admins create Guard accounts (see the follow-up Admin UI plan).
```

- [ ] **Step 4: Commit and push**

```bash
git add README.md
git commit -m "docs: document authentication in README"
git push
```

---

## Follow-up (separate plan)

`/admin` — Estate Admin UI for managing Units, Gates, and Guard accounts,
plus a read-only Activity view over `VisitorPass`/`GateAccessLog`. Depends
on everything in this plan (`User` model, `requireStaffSession`, staff
login). See `docs/superpowers/specs/2026-08-02-multi-role-auth-design.md`
for its scope; write its own plan once this one is merged.

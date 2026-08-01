# Multi-role authentication — design

## Problem

Estate Security Manager currently has zero authentication. Anyone can hit
`/passes/new`, pick any unit from a dropdown, and issue a visitor pass for
it. Anyone can hit `/gate/[gateId]` and operate the guard terminal — grant
entry, log incidents, view scanned vehicle data — with no login at all.
This is the core gap this design closes.

## Roles

- **Resident** — issues visitor passes for their own unit only.
- **Guard** — operates the gate terminal (check-in, check-out, incidents)
  for gates belonging to their estate.
- **Estate Admin** — manages units, gates, and guard accounts for their
  estate; views visitor/access history.

No Super Admin role in this iteration — each Estate Admin is scoped to
exactly one estate. Multi-estate platform administration is out of scope
and can be added later without reshaping this design (it would be a new
role plus a relaxed `estateId` scope check, not a rearchitecture).

## Data model

```prisma
enum UserRole {
  GUARD
  ESTATE_ADMIN
}

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

Residents do not get a `User` row. Their identity is `Unit.residentPhone`
(already on the schema); a session is a claim of "I control this phone
number", not a traditional account. `ResidentLoginOtp` mirrors the existing
hashed-OTP pattern from `VisitorPass`/`lib/access-code.ts` — 6-digit code,
HMAC-hashed at rest, `crypto.timingSafeEqual` compare, attempt-limited —
rather than inventing a second pattern for the same idea.

No NextAuth Prisma adapter tables (`Session`/`Account`/`VerificationToken`)
are needed: session strategy is JWT, so session state lives entirely in the
signed cookie.

## Login flows

### Resident

1. `/login` (resident-facing) — phone number input.
2. Server looks up `Unit.residentPhone`. Whether or not it matches, the
   response is the same generic "if that number is registered, you'll
   receive a code" — the lookup must not be usable to enumerate which
   phone numbers are registered residents.
3. If it matched: generate OTP, hash + store in `ResidentLoginOtp`, send via
   the existing `sendWhatsAppMessage`.
4. Resident submits the code. A NextAuth Credentials provider
   (`resident-otp`) verifies hash + expiry + attempt count, and on success
   issues a JWT session: `{ role: "RESIDENT", unitId }`.
5. `/passes/new` reads `unitId` from the session — the unit dropdown is
   removed. `POST /api/visitor/pre-clearance` likewise takes `unitId` from
   the session, not the request body, closing the vulnerability that
   motivated this design.

### Guard / Estate Admin

1. Shared `/staff/login` — email + password.
2. NextAuth Credentials provider (`staff-login`) looks up `User` by email,
   compares `passwordHash` (Node `crypto.scrypt`, no new dependency —
   consistent with how `access-code.ts`/`dedupe.ts` already hand-roll
   crypto rather than reaching for a library), issues a JWT session:
   `{ role, userId, estateId }`.
3. Guard → redirected to `/gate` (gate picker filtered to `session.estateId`).
4. Estate Admin → redirected to `/admin`.

Failed logins on both flows return a generic error ("invalid code" /
"invalid email or password") and are rate-limited per IP via the existing
`isRateLimited` helper — no signal about which half of the credential was
wrong.

## Session & route protection

Single NextAuth v5 (App Router) instance. `src/middleware.ts` enforces role
and estate/unit scoping per route group:

| Route(s) | Requires |
|---|---|
| `/passes/**`, `POST /api/visitor/pre-clearance` | `RESIDENT`; `unitId` comes from session |
| `/gate/**`, `POST /api/gate/{check-in,check-out,incident}` | `GUARD` or `ESTATE_ADMIN`; target gate's `estateId` must match session |
| `/admin/**`, `/api/admin/**` | `ESTATE_ADMIN`; all queries scoped to `session.estateId` |
| `/api/whatsapp/webhook` | unchanged — public, protected by `X-Hub-Signature-256`, not a user session |
| `/api/visitor/pass-card` | unchanged — public, protected by the accessCode-hash proof, since a visitor with no account may open this link |

Session `maxAge`: 30 days for residents (convenience — they're not a
security-sensitive login target the way a gate terminal is), 12 hours for
guard/admin (shared kiosk tablets should not stay signed in indefinitely).
`GuardGateDashboard` gets a sign-out control in its header, which it
currently lacks.

JWT sessions can't be revoked server-side: deactivating a Guard in `/admin`
stops new logins but doesn't invalidate an already-issued token, which
stays valid until it expires. The 12-hour `maxAge` bounds that exposure
window; closing it fully would mean switching staff sessions to the
database strategy (a session lookup per request) or checking `User.active`
in middleware on every request, either of which is a reasonable follow-up
but adds a DB round-trip this design doesn't require otherwise.

## Admin UI

`/admin` — scoped entirely to `session.estateId`:

- **Units**: add/edit unit number and resident phone.
- **Gates**: add/edit gate name.
- **Guards**: create (email + generated temp password shown once, no
  self-service signup), deactivate. No self-service password reset in this
  pass — an Admin resets a Guard's password by issuing a new temp one.
- **Activity** (read-only): `VisitorPass` and `GateAccessLog` history for
  the estate — who entered, when, denials, incidents.

New routes under `/api/admin/*` back this UI, all requiring an
`ESTATE_ADMIN` session and filtering every query by `estateId`.

## Bootstrapping

The very first `User` row (an Estate Admin) per estate is created via
`prisma/seed.ts`, the same way estates/units/gates are bootstrapped today —
there is no public admin signup. From there, that Admin creates Guards
through `/admin`.

## Non-goals

- Multi-estate Super Admin role.
- Self-service password reset (email-based) for Guard/Admin.
- Multiple resident phone numbers per unit (still one `residentPhone` per
  `Unit`, unchanged from the current schema).
- Automated test coverage — this project has no test suite yet; adding one
  is a stretch goal, not a blocker, for this design.

## New dependency

- `next-auth@beta` (v5, App Router support).

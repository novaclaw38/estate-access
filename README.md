# Estate Security Manager

Visitor pre-clearance (WhatsApp OTP) and boom-gate access control with South
African Motor Vehicle License Disc (MVL) scanning.

## Stack

Next.js 15 (App Router), TypeScript, Tailwind CSS v4, Prisma/PostgreSQL,
`@zxing/library` for in-browser PDF417 decoding, Meta WhatsApp Cloud API.

## Setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, ACCESS_CODE_SECRET, WhatsApp creds
npx prisma migrate dev --name init
npx prisma db seed
npm run dev
```

- `/passes/new` — resident issues a visitor pass; OTP is sent via WhatsApp
  Cloud API (or shown on screen if WhatsApp isn't configured/fails).
- `/gate/[gateId]` — guard tablet: scans the vehicle's license disc PDF417
  barcode, resident/guard enters the 6-digit OTP, grants or denies entry.
  The seed script creates a demo gate at `/gate/demo-gate-1`.

## Security notes

- OTPs are never stored in plaintext — `ACCESS_CODE_SECRET` HMACs the code
  before it's persisted (`src/lib/access-code.ts`), and lookup at the gate is
  by hash equality with a `crypto.timingSafeEqual` comparison.
- The gate check-in endpoint is rate-limited per source IP
  (`src/lib/rate-limit.ts`, in-memory — swap for Redis if scaling beyond one
  instance) to blunt OTP brute-forcing.
- `src/lib/parsers/licenceDiscParser.ts` parses the `%`-delimited MVL PDF417
  payload (disc no, register no, plate, description, make, series, colour,
  VIN, engine no, expiry, issue date). The exact byte layout is unverified
  against physical hardware — `isValid`/`rawPayload` on the parse result let
  a caller fall back to manual entry rather than trusting a garbled parse.
  An expired disc does not block entry — it's surfaced to the guard as a
  warning, since the decision belongs to estate policy, not the app.

## Offline gate operation

Boom gates often sit on unreliable cellular/Wi-Fi. The scanner queues every
check-in in IndexedDB (`src/lib/offline-sync.ts`) before attempting a network
call:

- **Online**: the item is flushed immediately and the guard sees the real
  GRANTED/DENIED result.
- **Offline or the flush fails**: the item stays queued, the UI shows
  "CHECK-IN QUEUED" (a provisional state, distinct from GRANTED — the guard
  makes the physical call), and a badge tracks the pending count. A `window`
  `online` listener retries the whole queue automatically on reconnect.
- Every queued item carries a client-generated `idempotencyKey` (UUID). The
  server's `GateAccessLog.idempotencyKey` is unique, so a batch resync after
  a partial failure never double-processes or double-opens the gate for the
  same scan.

`POST /api/gate/check-in` accepts either a single check-in object or an array
(a full offline-queue flush) and processes each idempotently.

## WhatsApp resident bot & arrival alerts

`src/app/api/whatsapp/webhook/route.ts` is the Meta WhatsApp Cloud API
webhook. Point a WhatsApp Business app's webhook subscription at
`/api/whatsapp/webhook`:

- **GET** — Meta's verification handshake, checked against `WHATSAPP_VERIFY_TOKEN`.
- **POST** — inbound messages. Every request is verified against
  `WHATSAPP_APP_SECRET` via `X-Hub-Signature-256` (HMAC-SHA256 over the raw
  body) before it's parsed — unsigned/forged webhook calls are rejected with
  401, since this is the only auth on a public endpoint that can create
  visitor passes. Delivery retries are deduped by `message.id`
  (`src/lib/dedupe.ts`) so a resend can't create a second pass.
- A resident is identified by `Unit.residentPhone` — link a resident's
  WhatsApp sender number to their unit (the seed script does this for the
  demo unit) before they can use the bot.
- Command: `Pass <Visitor Name> <VisitorCell> [<N>h]`, e.g.
  `Pass John Doe 0821234567 4h` (duration defaults to 8h, capped at 72h).
  Anything else gets the help text.

When a gate check-in is GRANTED (`src/app/api/gate/check-in/route.ts`), if
the pass's unit has a `residentPhone`, the resident gets an immediate
WhatsApp arrival alert with the visitor's name and plate.

## Multi-entry passes

Most passes are single-use: a `GRANTED` check-in flips `status` to
`CHECKED_IN`, and a repeat scan is denied (`DENIED_ALREADY_CHECKED_IN`).
Setting `isMultiEntry` when issuing a pass (checkbox in `/passes/new`,
`isMultiEntry` field on `POST /api/visitor/pre-clearance`) keeps the pass
`ACTIVE` across repeat scans within its validity window instead — for
contractors or recurring visitors who need to come and go. `entryCount` on
`VisitorPass` tracks how many times it's been used either way.

## Guard tablet dashboard

`/gate/[gateId]` renders `GuardGateDashboard` — a full-screen, high-contrast
kiosk UI (dark theme, oversized touch keypad) built for outdoor glare, gloves,
and vehicle throughput: the camera runs continuously (no tap-to-scan), OTP
entry is a numeric keypad, and connectivity/pending-sync state is always
visible. "LOG MANUAL RESIDENT" opens `/passes/new` for the guard to issue a
pass directly; "DENY ENTRY / INCIDENT" logs a reason-tagged
`GateAccessLog` row (`status: DENIED_MANUAL_INCIDENT`, `POST
/api/gate/incident`) for guard-initiated denials that never had an OTP.

## Shareable QR / PDF pass

`SharePassModal` (shown right after a resident issues a pass in
`/passes/new`) renders a QR code and downloadable PDF via
`GET /api/visitor/pass-card?passId=...&code=...&format=png|pdf`.

This is deliberately **not** a "fetch anytime by passId" endpoint. Per the
security notes above, the plaintext OTP is never persisted — only its HMAC.
So the pass-card route requires the caller to already hold the code (the
resident's browser, right after `/api/visitor/pre-clearance` returned it)
and verifies it against the stored hash before rendering; it 404s identically
for a wrong code or an unknown passId. The artifact can be regenerated at
will while the resident still has the code on screen, but not from a bare
link after the fact — that's the same tradeoff as a "reveal once" secret.

Note the gate itself has no QR/camera reader for visitor passes (only the
vehicle license disc PDF417 scanner) — the PDF/QR exists so the guard can
read the code off the visitor's phone, not for an automated scan-to-open
flow.

## Vehicle check-out & stay duration

`POST /api/gate/check-out` closes out a visit, matching by `accessCode` or by
`licensePlate` (for ANPR-style exit lanes where the visitor doesn't have
their code handy) against whichever `VisitorPass` currently has
`isInside: true`. It records `checkedOutAt`, computes stay duration from
`checkedInAt`, and logs a `GateAccessLog` row (`EXIT_GRANTED` /
`DENIED_NO_ACTIVE_ENTRY`). `isInside` is separate from `status` because a
multi-entry pass stays `ACTIVE` across visits — it's the only "currently on
the estate" signal for those passes. Unlike check-in, this endpoint is
**not** offline-queued — it assumes the exit lane has connectivity.

## Guard terminal PWA

`/gate` and `/gate/[gateId]` are installable as a standalone app
(`public/manifest.json`, `public/sw.js`, `src/app/gate/layout.tsx`) so a
guard tablet can run the terminal full-screen without browser chrome, keep
working through short connectivity drops (network-first caching for pages,
but `/api/gate/*` is always bypassed — a scan result must never be served
stale), and re-launch straight into the terminal after a device reboot.
`/gate` itself is a gate picker (the PWA `start_url`, since a manifest can't
target a dynamic `[gateId]` route) — install from the specific gate's page
via the header's "INSTALL APP" button, which only appears once the browser's
`beforeinstallprompt` fires. The dark theme, locked zoom, and kiosk styling
in `gate/layout.tsx` are scoped to `/gate/*` only, so the resident-facing
pages stay a normal light, zoomable site.

## API

- `POST /api/visitor/pre-clearance` — `{ unitId, visitorName, visitorPhone, durationHours?, isMultiEntry? }`
- `POST /api/gate/check-in` — `{ idempotencyKey, accessCode, gateId, scannedAt, vehicleData? }`
  or an array of the same shape for offline-queue sync.
- `POST /api/gate/check-out` — `{ idempotencyKey?, gateId, accessCode?, licensePlate?, scannedAt? }`
- `POST /api/gate/incident` — `{ idempotencyKey?, gateId, reason }`
- `GET|POST /api/whatsapp/webhook` — Meta WhatsApp Cloud API webhook.
- `GET /api/visitor/pass-card?passId=...&code=...&format=png|pdf`

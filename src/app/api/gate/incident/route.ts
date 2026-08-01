import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isRateLimited } from "@/lib/rate-limit";

const RATE_LIMIT_MAX_ATTEMPTS = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

interface IncidentPayload {
  idempotencyKey?: string;
  gateId?: string;
  reason?: string;
}

// Manual guard-initiated denial/incident log. Unlike /api/gate/check-in this
// isn't tied to an OTP and isn't offline-queued — it's a real-time action
// the guard takes while standing at the boom with connectivity.
export async function POST(req: Request) {
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(`incident:${clientIp}`, RATE_LIMIT_MAX_ATTEMPTS, RATE_LIMIT_WINDOW_MS)) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  let body: IncidentPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { gateId, reason } = body;
  const idempotencyKey = body.idempotencyKey ?? crypto.randomUUID();

  if (!gateId || !reason?.trim()) {
    return NextResponse.json({ error: "gateId and reason are required" }, { status: 400 });
  }

  const existing = await prisma.gateAccessLog.findUnique({ where: { idempotencyKey } });
  if (existing) {
    return NextResponse.json({ success: true, duplicate: true });
  }

  await prisma.gateAccessLog.create({
    data: {
      idempotencyKey,
      gateId,
      status: "DENIED_MANUAL_INCIDENT",
      reason: reason.trim(),
      scannedAt: new Date(),
      isOfflineSync: false,
    },
  });

  return NextResponse.json({ success: true });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashAccessCode } from "@/lib/access-code";
import { isRateLimited } from "@/lib/rate-limit";

const RATE_LIMIT_MAX_ATTEMPTS = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

interface CheckOutPayload {
  idempotencyKey?: string;
  gateId?: string;
  accessCode?: string;
  licensePlate?: string;
  scannedAt?: string;
}

function cleanPlate(reg: string): string {
  return reg.replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

// Not offline-queued (unlike /api/gate/check-in) — a guard-initiated exit
// scan is expected to happen with connectivity present.
export async function POST(req: Request) {
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(`checkout:${clientIp}`, RATE_LIMIT_MAX_ATTEMPTS, RATE_LIMIT_WINDOW_MS)) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  let body: CheckOutPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { gateId, accessCode, licensePlate } = body;
  const idempotencyKey = body.idempotencyKey ?? crypto.randomUUID();
  const scanTime = body.scannedAt ? new Date(body.scannedAt) : new Date();

  if (!gateId || (!accessCode && !licensePlate)) {
    return NextResponse.json(
      { error: "gateId and either accessCode or licensePlate are required" },
      { status: 400 },
    );
  }

  const existingLog = await prisma.gateAccessLog.findUnique({ where: { idempotencyKey } });
  if (existingLog) {
    return NextResponse.json({ success: existingLog.status === "EXIT_GRANTED", status: existingLog.status, duplicate: true });
  }

  const pass = accessCode
    ? await prisma.visitorPass.findFirst({
        where: { accessCodeHash: hashAccessCode(accessCode), isInside: true },
        include: { unit: true },
      })
    : await prisma.visitorPass.findFirst({
        where: { licensePlate: cleanPlate(licensePlate!), isInside: true },
        orderBy: { checkedInAt: "desc" },
        include: { unit: true },
      });

  if (!pass || !pass.checkedInAt) {
    await prisma.gateAccessLog.create({
      data: {
        idempotencyKey,
        gateId,
        status: "DENIED_NO_ACTIVE_ENTRY",
        licensePlate: licensePlate ? cleanPlate(licensePlate) : undefined,
        scannedAt: scanTime,
      },
    });
    return NextResponse.json({ error: "No active entry found for that code or plate" }, { status: 404 });
  }

  const totalMinutes = Math.max(0, Math.floor((scanTime.getTime() - pass.checkedInAt.getTime()) / 60_000));

  await prisma.$transaction([
    prisma.visitorPass.update({
      where: { id: pass.id },
      data: { isInside: false, checkedOutAt: scanTime },
    }),
    prisma.gateAccessLog.create({
      data: {
        idempotencyKey,
        gateId,
        passId: pass.id,
        status: "EXIT_GRANTED",
        licensePlate: pass.licensePlate,
        scannedAt: scanTime,
      },
    }),
  ]);

  return NextResponse.json({
    success: true,
    visitorName: pass.visitorName,
    unitNumber: pass.unit.unitNumber,
    licensePlate: pass.licensePlate,
    checkedInAt: pass.checkedInAt,
    checkedOutAt: scanTime,
    stayDuration: { totalMinutes, formatted: formatDuration(totalMinutes) },
  });
}

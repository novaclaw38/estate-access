import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashAccessCode } from "@/lib/access-code";
import { isRateLimited } from "@/lib/rate-limit";
import { SALicenceDiscData } from "@/lib/parsers/licenceDiscParser";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

const RATE_LIMIT_MAX_ATTEMPTS = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
// Scans older than this are assumed to have been queued offline on the
// tablet rather than submitted live at the boom.
const OFFLINE_STALENESS_MS = 30_000;

interface CheckInPayload {
  idempotencyKey: string;
  accessCode: string;
  gateId: string;
  scannedAt: string; // ISO string generated at the gate tablet
  vehicleData?: Pick<SALicenceDiscData, "discNumber" | "registrationNumber" | "make"> | null;
}

interface CheckInResult {
  idempotencyKey: string;
  success: boolean;
  status: string;
  unitNumber?: string | null;
  duplicate?: boolean;
}

export async function POST(req: Request) {
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const requests: CheckInPayload[] = Array.isArray(body) ? body : [body as CheckInPayload];

  if (requests.length === 0) {
    return NextResponse.json({ error: "No check-in payloads provided" }, { status: 400 });
  }

  // Batch offline-sync flushes cost proportionally to their size, so an
  // attacker can't bypass the OTP brute-force limit by packing many guesses
  // into a single array request.
  if (isRateLimited(`checkin:${clientIp}`, RATE_LIMIT_MAX_ATTEMPTS, RATE_LIMIT_WINDOW_MS, requests.length)) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  const results: CheckInResult[] = [];

  for (const payload of requests) {
    const { idempotencyKey, accessCode, gateId, scannedAt, vehicleData } = payload;

    if (!idempotencyKey || !accessCode || !gateId || !scannedAt) {
      results.push({
        idempotencyKey: idempotencyKey ?? "unknown",
        success: false,
        status: "DENIED_INVALID_CODE",
      });
      continue;
    }

    // Idempotency check: a previously-synced offline scan (or a retried
    // in-flight request) is a no-op — return its original outcome.
    const existingLog = await prisma.gateAccessLog.findUnique({ where: { idempotencyKey } });
    if (existingLog) {
      results.push({
        idempotencyKey,
        success: existingLog.status === "GRANTED",
        status: existingLog.status,
        duplicate: true,
      });
      continue;
    }

    const scanTime = new Date(scannedAt);
    const isOfflineSync = Array.isArray(body) || Date.now() - scanTime.getTime() > OFFLINE_STALENESS_MS;
    const accessCodeHash = hashAccessCode(accessCode);

    const pass = await prisma.visitorPass.findUnique({
      where: { accessCodeHash },
      include: { unit: true },
    });

    let status: string;
    let accessGranted = false;

    if (!pass) {
      status = "DENIED_INVALID_CODE";
    } else if (pass.status === "REVOKED") {
      status = "DENIED_REVOKED";
    } else if (pass.status === "CHECKED_IN" && !pass.isMultiEntry) {
      status = "DENIED_ALREADY_CHECKED_IN";
    } else if (pass.isMultiEntry && pass.isInside) {
      // Multi-entry passes don't consume on entry, but can't re-enter
      // without checking out first.
      status = "DENIED_ALREADY_CHECKED_IN";
    } else if (scanTime < pass.validFrom) {
      status = "DENIED_NOT_YET_VALID";
    } else if (scanTime > pass.validTo || pass.status === "EXPIRED") {
      status = "DENIED_EXPIRED";
    } else {
      status = "GRANTED";
      accessGranted = true;
    }

    try {
      await prisma.$transaction(async (tx) => {
        if (accessGranted && pass) {
          await tx.visitorPass.update({
            where: { id: pass.id },
            data: {
              // Multi-entry passes (contractors, recurring visitors) stay
              // ACTIVE so the next scan isn't denied as already-checked-in.
              status: pass.isMultiEntry ? "ACTIVE" : "CHECKED_IN",
              entryCount: { increment: 1 },
              isInside: true,
              checkedInAt: scanTime,
              checkedInGateId: gateId,
              licensePlate: vehicleData?.registrationNumber ?? pass.licensePlate,
              vehicleMake: vehicleData?.make ?? pass.vehicleMake,
              licenceDiscNo: vehicleData?.discNumber ?? pass.licenceDiscNo,
            },
          });
        } else if (status === "DENIED_EXPIRED" && pass && pass.status !== "EXPIRED") {
          await tx.visitorPass.update({ where: { id: pass.id }, data: { status: "EXPIRED" } });
        }

        await tx.gateAccessLog.create({
          data: {
            idempotencyKey,
            gateId,
            passId: pass?.id,
            accessCodeHash,
            status: status as Prisma.GateAccessLogCreateInput["status"],
            licensePlate: vehicleData?.registrationNumber,
            licenceDiscNo: vehicleData?.discNumber,
            vehicleMake: vehicleData?.make,
            scannedAt: scanTime,
            isOfflineSync,
          },
        });
      });
    } catch (err) {
      // A concurrent request created the same idempotencyKey between our
      // read and write — treat it as an already-synced duplicate.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const raced = await prisma.gateAccessLog.findUnique({ where: { idempotencyKey } });
        results.push({
          idempotencyKey,
          success: raced?.status === "GRANTED",
          status: raced?.status ?? "DENIED_INVALID_CODE",
          duplicate: true,
        });
        continue;
      }
      throw err;
    }

    if (accessGranted && pass?.unit.residentPhone) {
      const gate = await prisma.gate.findUnique({ where: { id: gateId } });
      await sendWhatsAppMessage(
        pass.unit.residentPhone,
        `🔔 *Visitor Arrived at Gate*\n\n${pass.visitorName} (${vehicleData?.registrationNumber ?? "Vehicle"}) has just checked in at ${gate?.name ?? "the gate"}.`,
      );
    }

    results.push({
      idempotencyKey,
      success: accessGranted,
      status,
      unitNumber: pass?.unit.unitNumber ?? null,
    });
  }

  return NextResponse.json({ success: true, processed: results });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateAccessCode, hashAccessCode } from "@/lib/access-code";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

const MAX_DURATION_HOURS = 72;

export async function POST(req: Request) {
  let body: {
    unitId?: string;
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

  const { unitId, visitorName, visitorPhone, isMultiEntry = false } = body;
  const durationHours = Math.min(body.durationHours ?? 8, MAX_DURATION_HOURS);

  if (!unitId || !visitorName || !visitorPhone) {
    return NextResponse.json(
      { error: "unitId, visitorName and visitorPhone are required" },
      { status: 400 },
    );
  }
  if (durationHours <= 0) {
    return NextResponse.json({ error: "durationHours must be positive" }, { status: 400 });
  }

  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
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
      unitId,
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

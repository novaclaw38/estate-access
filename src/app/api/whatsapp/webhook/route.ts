import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { generateAccessCode, hashAccessCode } from "@/lib/access-code";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { parsePassCommand } from "@/lib/parsers/whatsapp-command";
import { markAndCheckDuplicate } from "@/lib/dedupe";

const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET;

const HELP_TEXT =
  "👋 *Estate Security Bot*\n\nTo generate a visitor pass, reply in this format:\n\n`Pass [VisitorName] [VisitorCell] [DurationH]`\n\n*Example:* `Pass Sam 0829998888 4h` (defaults to 8h)";

// Meta webhook verification handshake.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (!WHATSAPP_VERIFY_TOKEN) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }
  if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Verification token mismatch" }, { status: 403 });
}

function isValidSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!WHATSAPP_APP_SECRET) return false;
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const expected = crypto.createHmac("sha256", WHATSAPP_APP_SECRET).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);

  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export async function POST(req: Request) {
  const rawBody = await req.text();

  if (!isValidSignature(rawBody, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: WhatsAppWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message || message.type !== "text") {
    return NextResponse.json({ status: "ignored" });
  }

  // Meta retries undelivered webhook acks; a message.id has already been
  // processed if we've seen it within the dedupe window.
  if (markAndCheckDuplicate(`wa:${message.id}`)) {
    return NextResponse.json({ status: "duplicate" });
  }

  const senderPhone = message.from;
  const textBody = message.text?.body.trim() ?? "";

  const unit = await prisma.unit.findUnique({
    where: { residentPhone: senderPhone },
    include: { estate: true },
  });

  if (!unit) {
    await sendWhatsAppMessage(
      senderPhone,
      "This number isn't registered to a unit. Contact estate management to link your WhatsApp number.",
    );
    return NextResponse.json({ status: "unregistered_sender" });
  }

  const command = parsePassCommand(textBody);
  if (!command) {
    await sendWhatsAppMessage(senderPhone, HELP_TEXT);
    return NextResponse.json({ status: "help_sent" });
  }

  const accessCode = generateAccessCode();
  const validFrom = new Date();
  const validTo = new Date(validFrom.getTime() + command.durationHours * 60 * 60 * 1000);

  await prisma.visitorPass.create({
    data: {
      unitId: unit.id,
      visitorName: command.visitorName,
      visitorPhone: command.visitorPhone,
      accessCodeHash: hashAccessCode(accessCode),
      status: "ACTIVE",
      validFrom,
      validTo,
    },
  });

  await sendWhatsAppMessage(
    senderPhone,
    `✅ *Pass Generated!*\n\nVisitor: ${command.visitorName}\nOTP Access Code: *${accessCode}*\nValid until: ${validTo.toLocaleTimeString(
      "en-ZA",
    )}\n\nShare this code with your visitor for boom entry.`,
  );

  return NextResponse.json({ status: "pass_created" });
}

interface WhatsAppWebhookBody {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          id: string;
          from: string;
          type: string;
          text?: { body: string };
        }>;
      };
    }>;
  }>;
}

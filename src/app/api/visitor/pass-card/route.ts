import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { accessCodesMatch } from "@/lib/access-code";
import { isRateLimited } from "@/lib/rate-limit";
import { generateQrPng, generatePassPdf } from "@/lib/pass-card";

const RATE_LIMIT_MAX_ATTEMPTS = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Renders a shareable QR/PDF artifact for a pass. The plaintext OTP is
 * never persisted (see lib/access-code.ts), so this can't be a "fetch by
 * passId alone" endpoint — the caller must already hold the code (e.g. the
 * resident's browser, immediately after /api/visitor/pre-clearance
 * returned it) and we verify it against the stored hash before rendering.
 * This means the artifact can only be (re)generated while the resident
 * still has the code on-screen, not fetched later from a bare link.
 */
export async function GET(req: Request) {
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(`passcard:${clientIp}`, RATE_LIMIT_MAX_ATTEMPTS, RATE_LIMIT_WINDOW_MS)) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const passId = searchParams.get("passId");
  const code = searchParams.get("code");
  const format = searchParams.get("format") ?? "png";

  if (!passId || !code || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "passId and a valid code are required" }, { status: 400 });
  }
  if (format !== "png" && format !== "pdf") {
    return NextResponse.json({ error: "format must be png or pdf" }, { status: 400 });
  }

  const pass = await prisma.visitorPass.findUnique({
    where: { id: passId },
    include: { unit: { include: { estate: true } } },
  });

  // Same 404 whether the pass doesn't exist or the code is wrong — don't
  // let this endpoint be used to probe for valid passIds.
  if (!pass || !accessCodesMatch(code, pass.accessCodeHash)) {
    return NextResponse.json({ error: "Pass not found" }, { status: 404 });
  }

  const qrBuffer = await generateQrPng(
    JSON.stringify({ passId: pass.id, code, unit: pass.unit.unitNumber }),
  );

  if (format === "png") {
    return new Response(new Uint8Array(qrBuffer), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" },
    });
  }

  const pdfBuffer = await generatePassPdf(
    {
      estateName: pass.unit.estate.name,
      unitNumber: pass.unit.unitNumber,
      visitorName: pass.visitorName,
      accessCode: code,
      validFrom: pass.validFrom,
      validTo: pass.validTo,
    },
    qrBuffer,
  );

  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="EstatePass_${pass.id}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

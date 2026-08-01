import QRCode from "qrcode";
import PDFDocument from "pdfkit";

export async function generateQrPng(payload: string): Promise<Buffer> {
  return QRCode.toBuffer(payload, {
    type: "png",
    width: 600,
    margin: 2,
    color: { dark: "#0F172A", light: "#FFFFFF" },
  });
}

export interface PassCardDetails {
  estateName: string;
  unitNumber: string;
  visitorName: string;
  accessCode: string;
  validFrom: Date;
  validTo: Date;
}

export async function generatePassPdf(pass: PassCardDetails, qrBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [360, 600], margin: 20 });
    const buffers: Buffer[] = [];

    doc.on("data", (chunk) => buffers.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    doc.rect(0, 0, 360, 80).fill("#0F172A");

    doc
      .fillColor("#FFFFFF")
      .fontSize(16)
      .font("Helvetica-Bold")
      .text(pass.estateName.toUpperCase() || "ESTATE ACCESS PASS", 20, 25, { align: "center" });

    doc
      .fontSize(10)
      .fillColor("#94A3B8")
      .text("VISITOR GATE ENTRY CLEARANCE", 20, 48, { align: "center" });

    doc
      .fillColor("#0F172A")
      .fontSize(18)
      .font("Helvetica-Bold")
      .text(pass.visitorName, 20, 110, { align: "center" });

    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor("#64748B")
      .text(`HOST UNIT: ${pass.unitNumber}`, 20, 132, { align: "center" });

    doc.image(qrBuffer, 80, 160, { width: 200, height: 200 });

    doc.roundedRect(60, 380, 240, 50, 8).fillAndStroke("#F8FAFC", "#E2E8F0");

    doc
      .fillColor("#0284C7")
      .fontSize(24)
      .font("Helvetica-Bold")
      .text(pass.accessCode, 60, 393, { align: "center", characterSpacing: 4 });

    doc
      .fillColor("#64748B")
      .fontSize(8)
      .font("Helvetica")
      .text("SHOW THIS CODE TO THE GUARD AT THE BOOM KEYPAD", 20, 440, { align: "center" });

    const validFromStr = pass.validFrom.toLocaleString("en-ZA", { dateStyle: "short", timeStyle: "short" });
    const validToStr = pass.validTo.toLocaleString("en-ZA", { dateStyle: "short", timeStyle: "short" });

    doc.fontSize(9).fillColor("#334155").text(`Valid From: ${validFromStr}`, 20, 490, { align: "center" });
    doc.text(`Valid Until: ${validToStr}`, 20, 505, { align: "center" });

    doc
      .fontSize(8)
      .fillColor("#94A3B8")
      .text("Automated Access Control - Do not share with unauthorized persons", 20, 555, {
        align: "center",
      });

    doc.end();
  });
}

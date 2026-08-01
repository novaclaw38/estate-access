"use client";

import React, { useState } from "react";
import { Share2, Copy, Check, FileText } from "lucide-react";

interface SharePassModalProps {
  passId: string;
  accessCode: string;
  visitorName: string;
  validTo: string;
}

export function SharePassModal({ passId, accessCode, visitorName, validTo }: SharePassModalProps) {
  const [copied, setCopied] = useState(false);

  const pngUrl = `/api/visitor/pass-card?passId=${passId}&code=${accessCode}&format=png`;
  const pdfUrl = `/api/visitor/pass-card?passId=${passId}&code=${accessCode}&format=pdf`;

  const buildShareText = () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `Hi ${visitorName}, here is your gate access code for entry:\n\n🔑 OTP Code: *${accessCode}*\n⏰ Valid until: ${validTo}\n\nYour QR pass: ${origin}${pdfUrl}`;
  };

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(buildShareText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleWhatsAppShare = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(buildShareText())}`, "_blank", "noopener");
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-sm w-full text-slate-100 shadow-2xl">
      <div className="text-center mb-4">
        <h3 className="text-lg font-extrabold text-white">Visitor Gate Pass</h3>
        <p className="text-xs text-slate-400">Created for {visitorName}</p>
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-700 flex flex-col items-center justify-center my-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={pngUrl} alt={`QR pass for ${visitorName}`} className="w-48 h-48 object-contain" />
        <div className="mt-2 font-mono text-2xl font-black tracking-widest text-slate-900">{accessCode}</div>
      </div>

      <div className="space-y-3">
        <button
          onClick={handleWhatsAppShare}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl flex items-center justify-center space-x-2 transition"
        >
          <Share2 className="w-5 h-5" />
          <span>Share via WhatsApp</span>
        </button>

        <div className="grid grid-cols-2 gap-2">
          <a
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-sm rounded-xl flex items-center justify-center space-x-2 transition"
          >
            <FileText className="w-4 h-4 text-blue-400" />
            <span>Open PDF</span>
          </a>

          <button
            onClick={handleCopyLink}
            className="py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-sm rounded-xl flex items-center justify-center space-x-2 transition"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? "Copied!" : "Copy Details"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

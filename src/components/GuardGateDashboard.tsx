"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Wifi, WifiOff, ShieldCheck, AlertTriangle, Delete, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { SALicenceDiscData } from "@/lib/parsers/licenceDiscParser";
import { LicenceDiscScanner } from "@/components/gate/LicenceDiscScanner";
import { PWAInstallPrompt } from "@/components/gate/PWAInstallPrompt";
import { queueCheckIn, pendingCheckInCount, registerOfflineSync } from "@/lib/offline-sync";

type Status = "IDLE" | "PROCESSING" | "GRANTED" | "DENIED" | "QUEUED";

const DENIAL_MESSAGES: Record<string, string> = {
  DENIED_INVALID_CODE: "No pass found for that code",
  DENIED_EXPIRED: "Pass has expired",
  DENIED_NOT_YET_VALID: "Pass is not yet valid",
  DENIED_REVOKED: "Pass has been revoked",
  DENIED_ALREADY_CHECKED_IN: "Pass already checked in",
};

interface GuardGateDashboardProps {
  gateId: string;
  gateName: string;
}

export default function GuardGateDashboard({ gateId, gateName }: GuardGateDashboardProps) {
  const [pin, setPin] = useState("");
  const [isOnline, setIsOnline] = useState(true);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [status, setStatus] = useState<Status>("IDLE");
  const [statusMessage, setStatusMessage] = useState("");
  const [unitInfo, setUnitInfo] = useState<string | null>(null);
  const [scannedDisc, setScannedDisc] = useState<SALicenceDiscData | null>(null);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [incidentReason, setIncidentReason] = useState("");
  const [incidentSubmitting, setIncidentSubmitting] = useState(false);

  const refreshPendingCount = useCallback(() => {
    pendingCheckInCount().then(setPendingSyncCount);
  }, []);

  useEffect(() => {
    registerOfflineSync();
    refreshPendingCount();

    const handleOnline = () => {
      setIsOnline(true);
      setTimeout(refreshPendingCount, 1500);
    };
    const handleOffline = () => setIsOnline(false);

    setIsOnline(navigator.onLine);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [refreshPendingCount]);

  const handleKeyPress = (num: string) => {
    if (pin.length < 6 && status !== "PROCESSING") setPin((prev) => prev + num);
  };

  const handleDelete = () => setPin((prev) => prev.slice(0, -1));

  const handleClear = () => {
    setPin("");
    setStatus("IDLE");
    setStatusMessage("");
    setUnitInfo(null);
  };

  const handleAuthorize = async () => {
    if (pin.length !== 6) {
      setStatus("DENIED");
      setStatusMessage("Enter a valid 6-digit OTP code");
      return;
    }

    setStatus("PROCESSING");
    setStatusMessage("");

    const result = await queueCheckIn({
      accessCode: pin,
      gateId,
      vehicleData: scannedDisc
        ? {
            discNumber: scannedDisc.discNumber,
            registrationNumber: scannedDisc.registrationNumber,
            make: scannedDisc.make,
          }
        : null,
    });
    refreshPendingCount();

    if (result === null) {
      setStatus("QUEUED");
      setStatusMessage("No connection — queued, will sync automatically");
      setUnitInfo(null);
      setTimeout(handleClear, 4000);
      return;
    }

    if (result.success) {
      setStatus("GRANTED");
      setStatusMessage("ACCESS GRANTED — BOOM OPENING");
      setUnitInfo(result.unitNumber ? `Unit ${result.unitNumber}` : null);
      setScannedDisc(null);
      setTimeout(handleClear, 4000);
    } else {
      setStatus("DENIED");
      setStatusMessage(DENIAL_MESSAGES[result.status] ?? "Invalid or expired pass");
    }
  };

  const submitIncident = async () => {
    if (!incidentReason.trim()) return;
    setIncidentSubmitting(true);
    try {
      await fetch("/api/gate/incident", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gateId, reason: incidentReason.trim(), idempotencyKey: crypto.randomUUID() }),
      });
    } finally {
      setIncidentSubmitting(false);
      setIncidentReason("");
      setIncidentOpen(false);
    }
  };

  return (
    <div className="h-screen w-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none overflow-hidden">
      <header className="h-20 bg-slate-900 border-b border-slate-800 px-6 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="p-3 bg-blue-600/20 text-blue-400 rounded-xl border border-blue-500/30">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-wide text-white">{gateName.toUpperCase()}</h1>
            <p className="text-xs text-slate-400 font-mono">ESTATE SECURE V2.4</p>
          </div>
        </div>

        <div className="flex items-center space-x-6">
          <PWAInstallPrompt />

          {pendingSyncCount > 0 && (
            <div className="flex items-center space-x-2 bg-amber-500/20 text-amber-300 border border-amber-500/40 px-4 py-2 rounded-lg font-mono text-sm">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>{pendingSyncCount} Sync Pending</span>
            </div>
          )}

          <div
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg border font-bold text-sm ${
              isOnline
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                : "bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse"
            }`}
          >
            {isOnline ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
            <span>{isOnline ? "ONLINE" : "OFFLINE MODE"}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-12 gap-6 p-6 h-[calc(100vh-5rem)]">
        <div className="col-span-7 flex flex-col space-y-6">
          <div className="flex-1 min-h-0">
            <LicenceDiscScanner onScanSuccess={setScannedDisc} />
          </div>

          <div className="h-24 grid grid-cols-2 gap-4">
            <button
              onClick={() => window.open("/passes/new", "_blank", "noopener")}
              className="bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 text-slate-200 rounded-xl font-bold text-lg flex items-center justify-center space-x-3 transition"
            >
              <AlertTriangle className="w-6 h-6 text-amber-400" />
              <span>LOG MANUAL RESIDENT</span>
            </button>
            <button
              onClick={() => setIncidentOpen((v) => !v)}
              className="bg-rose-950/40 hover:bg-rose-900/60 active:bg-rose-950 border border-rose-800/60 text-rose-300 rounded-xl font-bold text-lg flex items-center justify-center space-x-3 transition"
            >
              <XCircle className="w-6 h-6 text-rose-400" />
              <span>DENY ENTRY / INCIDENT</span>
            </button>
          </div>

          {incidentOpen && (
            <div className="bg-slate-900 border border-rose-800/50 rounded-xl p-4 flex flex-col space-y-3">
              <label className="text-xs font-bold text-rose-300 uppercase tracking-wider">Incident reason</label>
              <textarea
                value={incidentReason}
                onChange={(e) => setIncidentReason(e.target.value)}
                rows={2}
                className="bg-slate-950 border border-slate-700 rounded-lg p-3 text-slate-100 text-sm"
                placeholder="e.g. Refused entry — no valid pass, aggressive driver"
              />
              <div className="flex space-x-3">
                <button
                  onClick={submitIncident}
                  disabled={incidentSubmitting || !incidentReason.trim()}
                  className="flex-1 py-2 bg-rose-700 hover:bg-rose-600 disabled:opacity-40 rounded-lg font-bold"
                >
                  {incidentSubmitting ? "Logging..." : "Log Incident"}
                </button>
                <button
                  onClick={() => setIncidentOpen(false)}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg font-bold"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 text-center">
              ENTER VISITOR 6-DIGIT PASS CODE
            </div>
            <div className="h-20 bg-slate-950 border-2 border-slate-700 rounded-xl flex items-center justify-center font-mono text-4xl tracking-[0.5em] font-black text-blue-400 shadow-inner">
              {pin.padEnd(6, "•")}
            </div>
          </div>

          {status !== "IDLE" && (
            <div
              className={`p-4 rounded-xl border flex items-center space-x-4 ${
                status === "GRANTED"
                  ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300"
                  : status === "DENIED"
                    ? "bg-rose-500/20 border-rose-500/50 text-rose-300"
                    : status === "QUEUED"
                      ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
                      : "bg-blue-500/20 border-blue-500/50 text-blue-300"
              }`}
            >
              {status === "GRANTED" && <CheckCircle2 className="w-10 h-10 flex-shrink-0 text-emerald-400" />}
              {status === "DENIED" && <XCircle className="w-10 h-10 flex-shrink-0 text-rose-400" />}
              {status === "QUEUED" && <RefreshCw className="w-10 h-10 flex-shrink-0 text-amber-400" />}
              {status === "PROCESSING" && (
                <RefreshCw className="w-10 h-10 flex-shrink-0 animate-spin text-blue-400" />
              )}
              <div>
                <div className="font-extrabold text-lg">{statusMessage}</div>
                {unitInfo && <div className="text-sm font-mono text-emerald-200">{unitInfo}</div>}
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 my-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
              <button
                key={num}
                onClick={() => handleKeyPress(num)}
                className="h-20 bg-slate-800 hover:bg-slate-700 active:bg-blue-600 active:scale-95 text-3xl font-black rounded-xl border border-slate-700 shadow-lg transition duration-75 flex items-center justify-center"
              >
                {num}
              </button>
            ))}
            <button
              onClick={handleClear}
              className="h-20 bg-slate-800/60 hover:bg-slate-800 active:bg-slate-900 text-slate-400 font-bold rounded-xl border border-slate-700/60 text-sm"
            >
              CLEAR
            </button>
            <button
              onClick={() => handleKeyPress("0")}
              className="h-20 bg-slate-800 hover:bg-slate-700 active:bg-blue-600 active:scale-95 text-3xl font-black rounded-xl border border-slate-700 shadow-lg transition duration-75 flex items-center justify-center"
            >
              0
            </button>
            <button
              onClick={handleDelete}
              className="h-20 bg-slate-800/60 hover:bg-slate-800 active:bg-slate-900 text-slate-400 font-bold rounded-xl border border-slate-700/60 flex items-center justify-center"
            >
              <Delete className="w-8 h-8" />
            </button>
          </div>

          <button
            onClick={handleAuthorize}
            disabled={pin.length < 6 || status === "PROCESSING"}
            className="w-full h-20 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white font-black text-2xl tracking-wider rounded-xl shadow-xl transition flex items-center justify-center space-x-3"
          >
            <span>GRANT ENTRY</span>
            <CheckCircle2 className="w-8 h-8" />
          </button>
        </div>
      </main>
    </div>
  );
}

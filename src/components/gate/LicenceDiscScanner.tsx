"use client";

import React, { useEffect, useRef, useState } from "react";
import { BrowserPDF417Reader, NotFoundException } from "@zxing/library";
import { parseSALicenceDisc, SALicenceDiscData } from "@/lib/parsers/licenceDiscParser";
import { Camera, AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";

interface LicenceDiscScannerProps {
  onScanSuccess: (data: SALicenceDiscData) => void;
}

export function LicenceDiscScanner({ onScanSuccess }: LicenceDiscScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const codeReaderRef = useRef<BrowserPDF417Reader | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [isScanning, setIsScanning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<SALicenceDiscData | null>(null);

  useEffect(() => {
    let cancelled = false;
    codeReaderRef.current = new BrowserPDF417Reader();

    codeReaderRef.current
      .listVideoInputDevices()
      .then((videoDevices) => {
        if (cancelled) return;
        setDevices(videoDevices);
        const firstDevice = videoDevices[0];
        if (firstDevice) {
          // Default to environment-facing (rear) camera on guard tablets
          const rearCamera = videoDevices.find((device) => /back|rear|environment/i.test(device.label));
          setSelectedDeviceId((rearCamera ?? firstDevice).deviceId);
        }
      })
      .catch((err) => {
        console.error("Camera access error:", err);
        if (!cancelled) setErrorMsg("Failed to access tablet camera. Please check browser permissions.");
      });

    return () => {
      cancelled = true;
      codeReaderRef.current?.reset();
    };
  }, []);

  // Restart the decode stream whenever the guard switches cameras.
  useEffect(() => {
    if (!selectedDeviceId || !codeReaderRef.current || !videoRef.current) return;

    codeReaderRef.current.reset();
    setErrorMsg(null);
    setIsScanning(true);

    try {
      // Not awaited: this promise only settles when the reader is reset,
      // so awaiting it would block the effect indefinitely.
      codeReaderRef.current.decodeFromVideoDevice(selectedDeviceId, videoRef.current, (result, err) => {
        if (result) {
          const decodedVehicle = parseSALicenceDisc(result.getText());
          if (decodedVehicle.isValid) {
            setLastScan(decodedVehicle);
            onScanSuccess(decodedVehicle);
          } else {
            setErrorMsg("Barcode detected, but could not parse SA Licence Disc payload.");
          }
          return;
        }
        if (err && !(err instanceof NotFoundException)) {
          console.error("PDF417 decode error:", err);
        }
      });
    } catch (err) {
      console.error("Error opening camera video stream:", err);
      setIsScanning(false);
      setErrorMsg("Error opening camera video stream.");
    }
    // onScanSuccess intentionally omitted: re-running this effect for a
    // new callback identity would tear down and restart the live camera
    // stream on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDeviceId]);

  return (
    <div className="w-full max-w-xl mx-auto bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
      <div className="p-4 bg-slate-950 flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <Camera className="w-5 h-5 text-sky-400" />
          <h2 className="text-sm font-bold text-white tracking-wide">VEHICLE DISC SCANNER (PDF417)</h2>
        </div>

        {devices.length > 1 && (
          <select
            value={selectedDeviceId}
            onChange={(e) => setSelectedDeviceId(e.target.value)}
            className="bg-slate-800 text-xs text-slate-200 border border-slate-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            {devices.map((device, i) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="relative aspect-[4/3] bg-black flex items-center justify-center overflow-hidden">
        <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />

        <div className="absolute inset-0 border-[40px] border-slate-950/70 pointer-events-none flex items-center justify-center">
          <div className="w-full h-48 border-2 border-dashed border-sky-400/80 rounded-2xl relative">
            {isScanning && (
              <div className="w-full h-0.5 bg-red-500 shadow-[0_0_12px_#ef4444] animate-pulse absolute top-1/2 -translate-y-1/2" />
            )}
          </div>
        </div>

        {errorMsg && (
          <div className="absolute bottom-4 left-4 right-4 bg-red-950/90 border border-red-500 text-red-200 p-3 rounded-xl text-xs flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      {lastScan && (
        <div className="p-4 bg-slate-950 border-t border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span className="text-xs font-bold text-slate-300">DISC VERIFIED</span>
            </div>
            {lastScan.isExpired ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/20">
                <ShieldAlert className="w-3 h-3 mr-1" /> EXPIRED
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                VALID
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs bg-slate-900 p-3 rounded-xl border border-slate-800">
            <div>
              <p className="text-slate-500">Registration</p>
              <p className="font-mono text-base font-black text-white">{lastScan.registrationNumber}</p>
            </div>
            <div>
              <p className="text-slate-500">Make / Model</p>
              <p className="font-semibold text-slate-200">
                {lastScan.make} {lastScan.seriesName}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Color / Body</p>
              <p className="text-slate-300">
                {lastScan.color} • {lastScan.description}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Disc Expiry</p>
              <p className={`font-mono font-bold ${lastScan.isExpired ? "text-red-400" : "text-emerald-400"}`}>
                {lastScan.expiryDate}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

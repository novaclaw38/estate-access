"use client";

import { useState } from "react";
import { SharePassModal } from "@/components/SharePassModal";

interface UnitOption {
  id: string;
  label: string;
}

interface Result {
  success: boolean;
  passId?: string;
  accessCode?: string;
  validTo?: string;
  whatsapp?: { delivered: boolean; error?: string };
  error?: string;
}

export default function PassRequestForm({ units }: { units: UnitOption[] }) {
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const [visitorName, setVisitorName] = useState("");
  const [visitorPhone, setVisitorPhone] = useState("");
  const [durationHours, setDurationHours] = useState(8);
  const [isMultiEntry, setIsMultiEntry] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);

    try {
      const res = await fetch("/api/visitor/pre-clearance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitId, visitorName, visitorPhone, durationHours, isMultiEntry }),
      });
      const data = await res.json();
      setResult(res.ok ? data : { success: false, error: data.error });
    } catch {
      setResult({ success: false, error: "Network error creating pass" });
    } finally {
      setSubmitting(false);
    }
  };

  if (result?.success && result.passId && result.accessCode) {
    return (
      <div className="max-w-sm mx-auto">
        {result.whatsapp?.delivered === false && (
          <div className="mb-3 p-3 bg-amber-100 border border-amber-400 text-amber-800 rounded-lg text-sm">
            WhatsApp delivery failed ({result.whatsapp.error}) — share the pass below manually.
          </div>
        )}
        <SharePassModal
          passId={result.passId}
          accessCode={result.accessCode}
          visitorName={visitorName}
          validTo={result.validTo ? new Date(result.validTo).toLocaleString("en-ZA") : ""}
        />
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-4 border rounded-xl shadow-md bg-white">
      <h2 className="text-xl font-bold mb-4">Request Visitor Pass</h2>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
          <select
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            required
            className="w-full p-2 border rounded-lg"
          >
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Visitor Name</label>
          <input
            value={visitorName}
            onChange={(e) => setVisitorName(e.target.value)}
            required
            className="w-full p-2 border rounded-lg"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Visitor Phone (WhatsApp)
          </label>
          <input
            type="tel"
            value={visitorPhone}
            onChange={(e) => setVisitorPhone(e.target.value)}
            placeholder="+27..."
            required
            className="w-full p-2 border rounded-lg"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Valid For (hours)</label>
          <input
            type="number"
            min={1}
            max={72}
            value={durationHours}
            onChange={(e) => setDurationHours(Number(e.target.value))}
            className="w-full p-2 border rounded-lg"
          />
        </div>

        <label className="flex items-center space-x-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={isMultiEntry}
            onChange={(e) => setIsMultiEntry(e.target.checked)}
          />
          <span>Multi-entry (e.g. contractor working over several days)</span>
        </label>

        <button
          type="submit"
          disabled={submitting || !unitId}
          className="w-full py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
        >
          {submitting ? "Issuing..." : "Issue Pass"}
        </button>
      </form>

      {result && !result.success && (
        <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-800 rounded-lg">
          {result.error}
        </div>
      )}
    </div>
  );
}

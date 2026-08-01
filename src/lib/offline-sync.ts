import { openDB, type DBSchema } from "idb";

const DB_NAME = "gate_access_db";
const STORE_NAME = "offline_queue";

interface VehicleData {
  discNumber?: string;
  registrationNumber?: string;
  make?: string;
}

export interface QueuedCheckIn {
  idempotencyKey: string;
  accessCode: string;
  gateId: string;
  scannedAt: string;
  vehicleData?: VehicleData | null;
}

interface GateDB extends DBSchema {
  [STORE_NAME]: {
    key: string;
    value: QueuedCheckIn;
  };
}

interface ProcessedResult {
  idempotencyKey: string;
  success: boolean;
  status: string;
  unitNumber?: string | null;
  duplicate?: boolean;
}

async function getDB() {
  return openDB<GateDB>(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "idempotencyKey" });
      }
    },
  });
}

/**
 * Queues a gate scan locally (so it survives a reload with no connectivity)
 * and, if the tablet appears online, tries an immediate flush. Returns the
 * per-item result on immediate success, or null if it stayed queued.
 */
export async function queueCheckIn(
  payload: Omit<QueuedCheckIn, "idempotencyKey" | "scannedAt">,
): Promise<ProcessedResult | null> {
  const item: QueuedCheckIn = {
    ...payload,
    idempotencyKey: crypto.randomUUID(),
    scannedAt: new Date().toISOString(),
  };

  const db = await getDB();
  await db.put(STORE_NAME, item);

  if (navigator.onLine) {
    const results = await flushOfflineQueue();
    return results?.find((r) => r.idempotencyKey === item.idempotencyKey) ?? null;
  }
  return null;
}

export async function pendingCheckInCount(): Promise<number> {
  const db = await getDB();
  return db.count(STORE_NAME);
}

export async function flushOfflineQueue(): Promise<ProcessedResult[] | null> {
  const db = await getDB();
  const allQueued = await db.getAll(STORE_NAME);
  if (allQueued.length === 0) return [];

  try {
    const res = await fetch("/api/gate/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(allQueued),
    });

    if (!res.ok) return null;

    const data: { processed: ProcessedResult[] } = await res.json();

    const tx = db.transaction(STORE_NAME, "readwrite");
    for (const item of data.processed) {
      await tx.store.delete(item.idempotencyKey);
    }
    await tx.done;

    return data.processed;
  } catch (err) {
    console.warn("Offline queue sync failed, retaining items for retry.", err);
    return null;
  }
}

export function registerOfflineSync() {
  if (typeof window === "undefined") return;
  window.addEventListener("online", () => {
    flushOfflineQueue();
  });
}

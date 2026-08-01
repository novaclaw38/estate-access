const seen = new Map<string, number>();
const DEFAULT_TTL_MS = 5 * 60_000;

/**
 * Marks `key` as processed and reports whether it was already seen within
 * the TTL window. Used to make webhook delivery retries (Meta resends
 * undelivered-ack'd events) idempotent without a persistent store.
 */
export function markAndCheckDuplicate(key: string, ttlMs = DEFAULT_TTL_MS): boolean {
  const now = Date.now();
  for (const [k, expiresAt] of seen) {
    if (expiresAt <= now) seen.delete(k);
  }

  if (seen.has(key)) return true;
  seen.set(key, now + ttlMs);
  return false;
}

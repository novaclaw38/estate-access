interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Fixed-window in-memory limiter. Good enough for a single-instance guard
 * tablet deployment; swap for a Redis-backed limiter if this ever runs
 * behind multiple app instances.
 */
export function isRateLimited(key: string, limit: number, windowMs: number, increment = 1): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart > windowMs) {
    buckets.set(key, { count: increment, windowStart: now });
    return increment > limit;
  }

  bucket.count += increment;
  return bucket.count > limit;
}

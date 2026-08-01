import crypto from "crypto";

const ACCESS_CODE_SECRET = process.env.ACCESS_CODE_SECRET;

if (!ACCESS_CODE_SECRET) {
  throw new Error("ACCESS_CODE_SECRET env var is required to hash visitor OTPs");
}

/** Generates a cryptographically secure 6-digit OTP. */
export function generateAccessCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * Deterministic HMAC so a submitted OTP can be looked up by equality
 * against the stored hash without ever persisting the plaintext code.
 */
export function hashAccessCode(code: string): string {
  return crypto.createHmac("sha256", ACCESS_CODE_SECRET as string).update(code).digest("hex");
}

export function accessCodesMatch(submitted: string, storedHash: string): boolean {
  const submittedHash = Buffer.from(hashAccessCode(submitted), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (submittedHash.length !== stored.length) return false;
  return crypto.timingSafeEqual(submittedHash, stored);
}

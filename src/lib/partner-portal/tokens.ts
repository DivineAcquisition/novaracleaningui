import { createHash, randomBytes, timingSafeEqual } from "crypto";

export function mintRawToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function tokensMatch(raw: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(raw), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function normalizeEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

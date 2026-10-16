import { createHash, randomBytes, randomInt } from "node:crypto";

export function hashVerificationCode(code: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${code.trim()}`).digest("hex");
}

export function issueVerificationCode(now = new Date()): {
  code: string;
  salt: string;
  hash: string;
  expiresAt: string;
} {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const salt = randomBytes(16).toString("hex");
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  return { code, salt, hash: hashVerificationCode(code, salt), expiresAt };
}

export function verificationCodeMatches(input: {
  code: string;
  salt: string;
  hash: string;
  expiresAt: string;
  now?: Date;
}): boolean {
  const now = input.now ?? new Date();
  if (Date.parse(input.expiresAt) < now.getTime()) return false;
  const got = hashVerificationCode(input.code, input.salt);
  if (got.length !== input.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ input.hash.charCodeAt(i);
  return diff === 0;
}

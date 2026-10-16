// Keep in step with src/lib/compliance/engine.ts redactAccessText.
// Access codes never leave in texts, calendar notes, or dispute packets.

const ACCESS_LINE = /\b((?:gate|alarm|door|lockbox|keypad|entry|access|garage)\s*(?:code|pin)?|key\s*location|hide-?a-?key)\b[^.\n]{0,80}/gi;

export function redactAccessText(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(ACCESS_LINE, (match) => {
      const label = match.match(/^(gate|alarm|door|lockbox|keypad|entry|access|garage|key\s*location|hide-?a-?key)/i);
      return `${label ? label[0] : "Access"} [removed]`;
    })
    .replace(/\bcode\s*[:#-]?\s*[A-Za-z0-9#*]{3,}/gi, "code [removed]");
}

export function textHasAccessSecret(text: string | null | undefined): boolean {
  if (!text) return false;
  return /\b(gate|alarm|lockbox|keypad)\b|\bcode\s*[:#-]?\s*[A-Za-z0-9]{3,}|\bkey\s*location\b|\bACCESS:/i.test(text);
}

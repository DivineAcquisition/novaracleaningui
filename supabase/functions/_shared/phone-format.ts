// US phone normalization for GHL + display.

/** E.164 for GHL contact records (+1XXXXXXXXXX). */
export function toE164US(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (String(raw || "").trim().startsWith("+")) return String(raw).trim();
  return digits.length >= 10 ? `+${digits}` : "";
}

/** National display for contractor number fields: (301) 346-8452 */
export function formatPhoneDisplayUS(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return String(raw || "").trim();
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/** Ten-digit core for matching / storage consistency. */
export function phoneDigits10(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length === 10) return digits;
  return digits;
}

// Contractor-facing checks for the onboarding W-9. The admin 1099 blocker
// copy stays on blockerMessage; this list names the field that is missing.

import { formatTin } from "./nec-1099";
import { postalStateCode } from "./us-states";

export type W9Draft = {
  legalName: string;
  tinType: string;
  tin: string;
  street: string;
  city: string;
  state: string;
  zip: string;
};

export function w9FieldErrors(draft: W9Draft): string[] {
  const errors: string[] = [];
  if (!draft.legalName.trim()) errors.push("Enter the name on your tax return.");

  const tinType = draft.tinType.trim().toLowerCase();
  if (tinType !== "ssn" && tinType !== "ein" && tinType !== "itin") {
    errors.push("Choose Social Security number, EIN, or ITIN.");
  } else if (!formatTin(draft.tin, tinType)) {
    errors.push("Enter a 9-digit taxpayer identification number.");
  }

  if (!draft.street.trim()) errors.push("Enter a street address.");
  if (!draft.city.trim()) errors.push("Enter a city.");
  if (!postalStateCode(draft.state)) errors.push("Choose a 2-letter state, like MD.");

  const zip = draft.zip.trim();
  if (!/^\d{5}(?:-\d{4})?$/.test(zip)) errors.push("Enter a 5-digit ZIP, or ZIP+4.");

  return errors;
}

export type W9LinkSummary = {
  legalName: string;
  tinLast4: string;
  street: string;
  city: string;
  state: string;
  zip: string;
};

/** What a tokenized W-9 page may show. The full TIN stays off this object. */
export function w9LinkSummary(row: {
  legal_name?: string | null;
  tin?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
} | null): W9LinkSummary | null {
  const legalName = String(row?.legal_name || "").trim();
  if (!legalName) return null;
  const digits = String(row?.tin || "").replace(/\D/g, "");
  return {
    legalName,
    tinLast4: digits.slice(-4),
    street: String(row?.street || ""),
    city: String(row?.city || ""),
    state: postalStateCode(row?.state) || String(row?.state || "").trim(),
    zip: String(row?.zip || ""),
  };
}

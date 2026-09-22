// Form 1099-NEC, revision December 2026 (calendar year 2026 payments,
// filed beginning January 2027). Continuous-use until the IRS publishes
// a superseding revision.
//
// Checked against the published Instructions for Forms 1099-MISC and
// 1099-NEC (Rev. December 2026), https://www.irs.gov/instructions/i1099mec
// on 2026-09-22:
//   Box 1b — "Enter the total amount designated as cash tips included in box 1a."
//   Box 1d — qualified overtime "included in box 1a" (the FLSA premium half only).
//   Box 3 — excess golden parachute payments.
//   Payer and recipient addresses are separate fields.
//
// A draft of this form treated box 1a as job pay with tips only in box 1b.
// The finalized instructions do not. Tips are still read only from
// cleaner_tips and job pay only from the pay ledger, then box 1a is the
// sum (tips included once). Eligibility uses that same combined total.
// Adding box 1a and box 1b again would count tips twice.

export const NEC_FORM_REVISION = "December 2026" as const;
export const NEC_ELIGIBILITY_THRESHOLD_CENTS = 200_000;
export const PRINTABLE_NEC_COPIES = ["B", "C"] as const;
export type NecCopy = (typeof PRINTABLE_NEC_COPIES)[number];

export const NEC_1099_PAYER_SETTING = "nec_1099_payer";
export const NEC_1099_TTOC_SETTING = "nec_1099_ttoc";

const TTOC_CODE = /^\d{3}$/;

export type PayerIdentity = {
  name: string;
  tin: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
};

export type RecipientIdentity = {
  name: string;
  tin: string;
  tinType: "ssn" | "ein" | "itin";
  street: string;
  city: string;
  state: string;
  zip: string;
};

export type StateTaxLine = {
  withheldCents: number | null;
  state: string | null;
  payerStateId: string | null;
  incomeCents: number | null;
};

export type TtocSetting = {
  codes: string[];
  confirmed: boolean;
};

export type Nec1099Amounts = {
  jobPayCents: number;
  tipCents: number;
  /** Job pay plus tips. This is the $2,000 threshold basis and box 1a. */
  combinedCents: number;
  box1aCents: number;
  box1bCents: number | null;
  box1cCodes: string[] | null;
  box1dCents: number | null;
  box3Cents: number | null;
  box4Cents: number | null;
  stateLines: StateTaxLine[];
};

export type Nec1099Form = {
  taxYear: number;
  revision: typeof NEC_FORM_REVISION;
  corrected: boolean;
  correctsFormId: string | null;
  accountNumber: string;
  payer: PayerIdentity;
  recipient: RecipientIdentity;
  jobPayCents: number;
  tipCents: number;
  combinedCents: number;
  box1aCents: number;
  box1bCents: number | null;
  box1cCodes: string[] | null;
  box1dCents: number | null;
  box2DirectSales: false;
  box3Cents: number | null;
  box4Cents: number | null;
  stateLines: StateTaxLine[];
};

export type NecBlocker =
  | "below_threshold"
  | "w9_required"
  | "payer_incomplete"
  | "ttoc_unconfirmed"
  | "ttoc_required"
  | "ttoc_invalid"
  | "not_this_revision"
  | "correction_link";

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function nonNegative(value: unknown): number {
  const n = Math.round(Number(value) || 0);
  return n > 0 ? n : 0;
}

/** Blank on the form. Zero is not a reported amount for optional boxes. */
export function positiveOrNull(value: unknown): number | null {
  const n = Math.round(Number(value) || 0);
  return n > 0 ? n : null;
}

export function calendarYear(value: string | null | undefined): number | null {
  if (!value) return null;
  const day = String(value).slice(0, 10);
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(day);
  if (match) return Number(match[1]);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).getUTCFullYear();
}

export function formatNecMoney(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const dollars = (abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return negative ? `-$${dollars}` : `$${dollars}`;
}

export function formatTin(tin: string, type: "ssn" | "ein" | "itin"): string | null {
  const digits = String(tin || "").replace(/\D/g, "");
  if (digits.length !== 9) return null;
  if (type === "ein") return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

export function printableCopy(copy: string): NecCopy | null {
  if (copy === "B" || copy === "C") return copy;
  return null;
}

export function copyAIsPrintable(): false {
  return false;
}

export function validatePayer(raw: unknown): { ok: true; payer: PayerIdentity } | { ok: false; missing: string[] } {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const name = clean(src.name);
  const tin = formatTin(clean(src.tin), "ein");
  const street = clean(src.street);
  const city = clean(src.city);
  const state = clean(src.state).toUpperCase();
  const zip = clean(src.zip);
  const phone = clean(src.phone);
  const missing: string[] = [];
  if (!name) missing.push("name");
  if (!tin) missing.push("tin");
  if (!street) missing.push("street");
  if (!city) missing.push("city");
  if (!/^[A-Z]{2}$/.test(state)) missing.push("state");
  if (!/^\d{5}(?:-\d{4})?$/.test(zip)) missing.push("zip");
  if (missing.length) return { ok: false, missing };
  return { ok: true, payer: { name, tin: tin!, street, city, state, zip, phone } };
}

export function validateRecipient(raw: unknown): { ok: true; recipient: RecipientIdentity } | { ok: false; reason: "w9_required" } {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const tinTypeRaw = clean(src.tinType || src.tin_type).toLowerCase();
  const tinType = tinTypeRaw === "ein" || tinTypeRaw === "itin" || tinTypeRaw === "ssn" ? tinTypeRaw : null;
  const name = clean(src.name || src.legal_name || src.legalName);
  const street = clean(src.street);
  const city = clean(src.city);
  const state = clean(src.state).toUpperCase();
  const zip = clean(src.zip);
  const tin = tinType ? formatTin(clean(src.tin), tinType) : null;
  if (!name || !street || !city || !/^[A-Z]{2}$/.test(state) || !/^\d{5}(?:-\d{4})?$/.test(zip) || !tin || !tinType) {
    return { ok: false, reason: "w9_required" };
  }
  return { ok: true, recipient: { name, tin, tinType, street, city, state, zip } };
}

export function parseTtocSetting(value: unknown): TtocSetting {
  const src = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const raw = Array.isArray(src.codes) ? src.codes : [];
  const codes = raw.map((code) => clean(code)).filter(Boolean);
  return { codes, confirmed: src.confirmed === true };
}

export function ttocForTips(
  setting: TtocSetting,
  tipCents: number,
): { ok: true; codes: string[] | null } | { ok: false; reason: "ttoc_unconfirmed" | "ttoc_required" | "ttoc_invalid" } {
  if (tipCents <= 0) return { ok: true, codes: null };
  if (!setting.confirmed) return { ok: false, reason: "ttoc_unconfirmed" };
  if (setting.codes.length === 0) return { ok: false, reason: "ttoc_required" };
  if (setting.codes.length > 2 || setting.codes.some((code) => !TTOC_CODE.test(code))) {
    return { ok: false, reason: "ttoc_invalid" };
  }
  return { ok: true, codes: [...setting.codes] };
}

export function stateLinesForForm(lines: unknown): StateTaxLine[] {
  if (!Array.isArray(lines)) return [];
  const out: StateTaxLine[] = [];
  for (const line of lines) {
    if (!line || typeof line !== "object") continue;
    const src = line as Record<string, unknown>;
    const withheldCents = positiveOrNull(src.withheldCents ?? src.withheld_cents);
    const incomeCents = positiveOrNull(src.incomeCents ?? src.income_cents);
    const stateRaw = clean(src.state).toUpperCase();
    const state = /^[A-Z]{2}$/.test(stateRaw) ? stateRaw : null;
    const payerStateId = clean(src.payerStateId ?? src.payer_state_id) || null;
    if (!withheldCents && !incomeCents && !state && !payerStateId) continue;
    out.push({ withheldCents, state, payerStateId, incomeCents });
    if (out.length === 2) break;
  }
  return out;
}

export type LedgerPayout = {
  cleanerId?: string | null;
  amountCents?: number | null;
  status?: string | null;
  serviceDate?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
  breakdown?: unknown;
};

export type ExtraPayRow = {
  status?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
  surgeCents?: number | null;
  jobValueCents?: number | null;
  overtimeCents?: number | null;
  supplyCents?: number | null;
  mileageCents?: number | null;
};

export type TipRow = {
  amountCents?: number | null;
  status?: string | null;
  createdAt?: string | null;
  paidOutAt?: string | null;
};

/** This contractor's share of one custom-payout row. Tips are not on this ledger. */
export function payoutShareCents(row: LedgerPayout, cleanerId: string): number {
  const breakdown = Array.isArray(row.breakdown) ? row.breakdown : [];
  if (breakdown.length) {
    let sum = 0;
    for (const item of breakdown) {
      if (!item || typeof item !== "object") continue;
      const entry = item as { cleanerId?: string; amountCents?: number };
      if (String(entry.cleanerId || "") !== cleanerId) continue;
      sum += nonNegative(entry.amountCents);
    }
    return sum;
  }
  if (String(row.cleanerId || "") === cleanerId) return nonNegative(row.amountCents);
  return 0;
}

function paidInYear(status: string | null | undefined, when: string | null | undefined, year: number): boolean {
  if (String(status || "").toLowerCase() !== "paid") return false;
  return calendarYear(when) === year;
}

/**
 * Job-pay compensation for box 1a, excluding tips.
 * manual_payouts (custom payout) plus the compensation portion of
 * job_extra_pay (surge, job-value increases, and recorded overtime dollars).
 * Supply and mileage reimbursements stay off the form.
 * Overtime dollars are compensation, so they sit in this total. They are
 * not box 1d: that box is only the FLSA premium half, which this pay
 * model does not record.
 */
export function jobPayFromLedgers(input: {
  cleanerId: string;
  year: number;
  payouts: LedgerPayout[];
  extras: ExtraPayRow[];
}): { jobPayCents: number; overtimeTrackedCents: number; reimbursementCents: number } {
  let jobPayCents = 0;
  let overtimeTrackedCents = 0;
  let reimbursementCents = 0;
  for (const row of input.payouts) {
    const when = row.paidAt || row.serviceDate || row.createdAt;
    if (!paidInYear(row.status, when, input.year)) continue;
    jobPayCents += payoutShareCents(row, input.cleanerId);
  }
  for (const row of input.extras) {
    const when = row.paidAt || row.createdAt;
    if (!paidInYear(row.status, when, input.year)) continue;
    const surge = nonNegative(row.surgeCents);
    const jobValue = nonNegative(row.jobValueCents);
    const overtime = nonNegative(row.overtimeCents);
    jobPayCents += surge + jobValue + overtime;
    overtimeTrackedCents += overtime;
    reimbursementCents += nonNegative(row.supplyCents) + nonNegative(row.mileageCents);
  }
  return { jobPayCents, overtimeTrackedCents, reimbursementCents };
}

/** Year tips from cleaner_tips only. */
export function tipsFromLedger(rows: TipRow[], year: number): number {
  let sum = 0;
  for (const row of rows) {
    const status = String(row.status || "received").toLowerCase();
    if (status !== "received" && status !== "paid_out") continue;
    const when = row.createdAt || row.paidOutAt;
    if (calendarYear(when) !== year) continue;
    sum += nonNegative(row.amountCents);
  }
  return sum;
}

export function combinedCompensationCents(jobPayCents: number, tipCents: number): number {
  return nonNegative(jobPayCents) + nonNegative(tipCents);
}

export function meetsNecThreshold(jobPayCents: number, tipCents: number): boolean {
  return combinedCompensationCents(jobPayCents, tipCents) >= NEC_ELIGIBILITY_THRESHOLD_CENTS;
}

/**
 * Box 1d stays empty unless a caller has the FLSA premium half as its own
 * figure. A full overtime amount, a zero, or a guess is not that figure.
 * Novara's percentage-of-job pay does not produce one, so the loader passes null.
 */
export function box1dCents(qualifiedOvertimePremiumCents: number | null | undefined): number | null {
  return positiveOrNull(qualifiedOvertimePremiumCents);
}

/** Not applicable to these contractor relationships. Never a placeholder zero. */
export function box3Cents(excessGoldenParachuteCents: number | null | undefined): number | null {
  return positiveOrNull(excessGoldenParachuteCents);
}

export function assignNecAmounts(input: {
  jobPayCents: number;
  tipCents: number;
  ttoc: TtocSetting;
  qualifiedOvertimePremiumCents?: number | null;
  excessGoldenParachuteCents?: number | null;
  federalWithheldCents?: number | null;
  stateLines?: unknown;
}): { ok: true; amounts: Nec1099Amounts } | { ok: false; reason: NecBlocker } {
  const jobPayCents = nonNegative(input.jobPayCents);
  const tipCents = nonNegative(input.tipCents);
  const ttoc = ttocForTips(input.ttoc, tipCents);
  if (ttoc.ok === false) return { ok: false, reason: ttoc.reason };
  const combinedCents = jobPayCents + tipCents;
  return {
    ok: true,
    amounts: {
      jobPayCents,
      tipCents,
      combinedCents,
      box1aCents: combinedCents,
      box1bCents: tipCents > 0 ? tipCents : null,
      box1cCodes: ttoc.codes,
      box1dCents: box1dCents(input.qualifiedOvertimePremiumCents),
      box3Cents: box3Cents(input.excessGoldenParachuteCents),
      box4Cents: positiveOrNull(input.federalWithheldCents),
      stateLines: stateLinesForForm(input.stateLines),
    },
  };
}

export function assembleNecForm(input: {
  taxYear: number;
  corrected: boolean;
  correctsFormId: string | null;
  accountNumber: string;
  payer: unknown;
  recipient: unknown;
  jobPayCents: number;
  tipCents: number;
  ttoc: TtocSetting;
  qualifiedOvertimePremiumCents?: number | null;
  excessGoldenParachuteCents?: number | null;
  federalWithheldCents?: number | null;
  stateLines?: unknown;
  allowBelowThreshold?: boolean;
}): { ok: true; form: Nec1099Form } | { ok: false; reason: NecBlocker; missing?: string[] } {
  const year = Math.round(Number(input.taxYear));
  if (!Number.isFinite(year) || year < 2026) return { ok: false, reason: "not_this_revision" };
  const payer = validatePayer(input.payer);
  if (payer.ok === false) return { ok: false, reason: "payer_incomplete", missing: payer.missing };
  const recipient = validateRecipient(input.recipient);
  if (recipient.ok === false) return { ok: false, reason: recipient.reason };
  const accountNumber = clean(input.accountNumber);
  if (!accountNumber) return { ok: false, reason: "w9_required" };
  const amounts = assignNecAmounts(input);
  if (amounts.ok === false) return amounts;
  if (!input.allowBelowThreshold && amounts.amounts.combinedCents < NEC_ELIGIBILITY_THRESHOLD_CENTS) {
    return { ok: false, reason: "below_threshold" };
  }
  if (input.corrected && !clean(input.correctsFormId)) return { ok: false, reason: "correction_link" };
  return {
    ok: true,
    form: {
      taxYear: year,
      revision: NEC_FORM_REVISION,
      corrected: input.corrected === true,
      correctsFormId: input.corrected ? clean(input.correctsFormId) : null,
      accountNumber,
      payer: payer.payer,
      recipient: recipient.recipient,
      box2DirectSales: false,
      ...amounts.amounts,
    },
  };
}

/** Electronic Copy A. No PDF bytes. */
export function efileRecord(form: Nec1099Form): Record<string, unknown> {
  return {
    form: "1099-NEC",
    revision: form.revision,
    taxYear: form.taxYear,
    corrected: form.corrected,
    correctsFormId: form.correctsFormId,
    payer: form.payer,
    recipient: form.recipient,
    accountNumber: form.accountNumber,
    box1aCents: form.box1aCents,
    box1bCents: form.box1bCents,
    box1cCodes: form.box1cCodes,
    box1dCents: form.box1dCents,
    box3Cents: form.box3Cents,
    box4Cents: form.box4Cents,
    stateLines: form.stateLines,
    pdf: null,
  };
}

export function correctionOf(originalId: string, form: Nec1099Form): Nec1099Form {
  return {
    ...form,
    corrected: true,
    correctsFormId: originalId,
  };
}

export function blockerMessage(reason: NecBlocker, missing?: string[]): string {
  switch (reason) {
    case "below_threshold":
      return "Combined job pay and tips are under the $2,000 reporting threshold.";
    case "w9_required":
      return "A validated W-9 with legal name, street, city, state, ZIP, and TIN is required. Recipient lines are not retyped onto the form.";
    case "payer_incomplete":
      return `Payer name, EIN, street, city, state, and ZIP are saved separately before a 1099 is generated.${missing?.length ? ` Missing: ${missing.join(", ")}.` : ""}`;
    case "ttoc_unconfirmed":
      return "Box 1b has tips, so Box 1c needs the accountant-confirmed Treasury Tipped Occupation Code. The saved code is not confirmed.";
    case "ttoc_required":
      return "Box 1b has tips, so Box 1c needs a Treasury Tipped Occupation Code. None is saved.";
    case "ttoc_invalid":
      return "Box 1c accepts one or two 3-digit Treasury Tipped Occupation Codes.";
    case "not_this_revision":
      return "This December 2026 form is for calendar year 2026 and later. Earlier years keep the prior form.";
    case "correction_link":
      return "A corrected 1099 is a new record linked to the original filing.";
    default:
      return "The 1099 could not be prepared.";
  }
}

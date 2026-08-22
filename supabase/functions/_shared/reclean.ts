// ─── Re-clean policy (Spotless Guarantee) ────────────────────────────────
//
// Three standing rules, encoded here so no caller can "forget":
//   1. Whoever performs a re-clean is paid, at their normal tier rate, on
//      the re-clean's assessed value from the pricing engine. Unpaid or
//      reduced-rate corrective work is a bug.
//   2. The company absorbs the cost. The customer is never charged.
//   3. Classification (quality miss vs scope confusion vs unsupported)
//      decides Score impact. Scope-confusion and unsupported never hit
//      the original cleaner.
//
// Pricing for targeted re-cleans reuses the Focused Clean engine. That
// module is also dependency-free (no database). Edge functions that talk
// to Postgres live in qc-reclean / the patched pay+score paths.
import {
  calculateFocusedPrice,
  type FocusedSameDaySettings,
} from "./focused-same-day.ts";

export const RECLEAN_SETTINGS_KEY = "reclean_settings";
export const DEFAULT_GUARANTEE_WINDOW_HOURS = 48;
export const SERIAL_REQUESTER_THRESHOLD = 2;
export const REPEAT_QUALITY_MISS_THRESHOLD = 2;
export const REPEAT_LOOKBACK_DAYS = 90;

export const RECLEAN_CLASSIFICATIONS = [
  "pending",
  "quality_miss",
  "scope_confusion",
  "not_supported",
] as const;
export type RecleanClassification = (typeof RECLEAN_CLASSIFICATIONS)[number];

export const RECLEAN_SCOPES = ["targeted", "full"] as const;
export type RecleanScope = (typeof RECLEAN_SCOPES)[number];

export const RECLEAN_STATUSES = [
  "none",
  "requested",
  "pending_review",
  "classified",
  "approved",
  "declined",
  "offered",
  "dispatched",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type RecleanStatus = (typeof RECLEAN_STATUSES)[number];

export const RECLEAN_OFFER_STATUSES = [
  "pending",
  "offered",
  "accepted",
  "declined",
  "skipped_customer_pref",
  "expired",
] as const;
export type RecleanOfferStatus = (typeof RECLEAN_OFFER_STATUSES)[number];

export interface RecleanSettings {
  guarantee_window_hours: number;
  serial_requester_threshold: number;
  repeat_quality_miss_threshold: number;
}

export const RECLEAN_SETTINGS_DEFAULTS: RecleanSettings = {
  guarantee_window_hours: DEFAULT_GUARANTEE_WINDOW_HOURS,
  serial_requester_threshold: SERIAL_REQUESTER_THRESHOLD,
  repeat_quality_miss_threshold: REPEAT_QUALITY_MISS_THRESHOLD,
};

export function mergeRecleanSettings(raw: unknown): RecleanSettings {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const hours = Number(obj.guarantee_window_hours);
  const serial = Number(obj.serial_requester_threshold);
  const repeat = Number(obj.repeat_quality_miss_threshold);
  return {
    guarantee_window_hours: Number.isFinite(hours) && hours > 0
      ? Math.min(24 * 14, Math.round(hours))
      : DEFAULT_GUARANTEE_WINDOW_HOURS,
    serial_requester_threshold: Number.isFinite(serial) && serial >= 2
      ? Math.round(serial)
      : SERIAL_REQUESTER_THRESHOLD,
    repeat_quality_miss_threshold: Number.isFinite(repeat) && repeat >= 2
      ? Math.round(repeat)
      : REPEAT_QUALITY_MISS_THRESHOLD,
  };
}

/** True only for a verified quality miss. Pending / scope / unsupported never hit Score. */
export function qualityHitApplies(classification: string | null | undefined): boolean {
  return String(classification || "") === "quality_miss";
}

/**
 * QC cases that should start a re-clean *request* (verification still required
 * before dispatch). Matches the three intake paths in the spec.
 */
export function intakeCreatesRecleanRequest(opts: {
  issueType: string;
  reportedVia: string;
  requestReclean?: boolean;
}): boolean {
  if (opts.requestReclean === true) return true;
  if (opts.requestReclean === false) return false;
  const t = String(opts.issueType || "");
  if (t === "reclean") return true;
  if (t === "complaint") return true;
  if (t === "quality_flag") return true;
  if (opts.reportedVia === "customer") return true;
  return false;
}

export function isInsideGuaranteeWindow(opts: {
  completedAt?: string | null;
  serviceDate?: string | null;
  windowHours: number;
  now?: Date;
}): boolean {
  const deadline = guaranteeDeadline(opts);
  if (!deadline) return false;
  return (opts.now || new Date()).getTime() <= deadline.getTime();
}

/** 48h (configurable) after job completion, falling back to 8pm ET on service day. */
export function guaranteeDeadline(opts: {
  completedAt?: string | null;
  serviceDate?: string | null;
  windowHours: number;
}): Date | null {
  const hours = Math.max(1, Number(opts.windowHours) || DEFAULT_GUARANTEE_WINDOW_HOURS);
  if (opts.completedAt) {
    const completed = new Date(opts.completedAt);
    if (!Number.isNaN(completed.getTime())) {
      return new Date(completed.getTime() + hours * 3600_000);
    }
  }
  const d = String(opts.serviceDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  // 20:00 America/New_York on the service date, then + window. Offset is
  // resolved via the ISO string with a fixed ET offset for the date; DST
  // is approximate (EDT -04 from Mar–Nov) which is close enough for a
  // 48-hour window.
  const month = Number(d.slice(5, 7));
  const offset = month >= 3 && month <= 11 ? "-04:00" : "-05:00";
  const start = new Date(`${d}T20:00:00${offset}`);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() + hours * 3600_000);
}

export function recleanRequestColumns(opts: {
  completedAt?: string | null;
  serviceDate?: string | null;
  windowHours: number;
  now?: Date;
}): {
  reclean_status: "requested";
  reclean_classification: "pending";
  reclean_requested_at: string;
  reclean_inside_window: boolean;
  reclean_guarantee_window_hours: number;
} {
  const now = opts.now || new Date();
  return {
    reclean_status: "requested",
    reclean_classification: "pending",
    reclean_requested_at: now.toISOString(),
    reclean_inside_window: isInsideGuaranteeWindow({ ...opts, now }),
    reclean_guarantee_window_hours: Math.max(1, Number(opts.windowHours) || DEFAULT_GUARANTEE_WINDOW_HOURS),
  };
}

export interface PayBasisBooking {
  is_reclean?: boolean | null;
  reclean_assessed_value_cents?: number | null;
  final_charge_cents?: number | null;
  total_estimate_cents?: number | null;
}

/**
 * Job value that cleaner pay is computed from.
 *
 * For a re-clean this is ALWAYS the assessed scope value — never the $0
 * customer charge. Throws if a re-clean is missing a positive assessed
 * value: that path would produce unpaid corrective work, which is prohibited.
 */
export function jobValueForPay(booking: PayBasisBooking): number {
  if (booking.is_reclean) {
    const assessed = Math.round(Number(booking.reclean_assessed_value_cents) || 0);
    if (assessed <= 0) {
      throw new Error("Reclean pay basis missing — unpaid re-cleans are prohibited.");
    }
    return assessed;
  }
  return Math.max(0, Math.round(
    Number(booking.final_charge_cents) || Number(booking.total_estimate_cents) || 0,
  ));
}

/** Customer-facing charge on a re-clean is always zero. */
export function customerChargeCents(booking: PayBasisBooking): number {
  if (booking.is_reclean) return 0;
  return Math.max(0, Math.round(
    Number(booking.final_charge_cents) || Number(booking.total_estimate_cents) || 0,
  ));
}

export interface RecleanScopeItem {
  areaId: string;
  quantity?: number;
  label?: string;
  notes?: string;
}

const AREA_KEYWORDS: Array<{ areaId: string; pattern: RegExp }> = [
  { areaId: "kitchen", pattern: /\bkitchen|stove|oven|fridge|sink\b/i },
  { areaId: "bathroom", pattern: /\bbath(room)?s?|toilet|shower|tub\b/i },
  { areaId: "bedroom", pattern: /\bbed(room)?s?\b/i },
  { areaId: "living", pattern: /\bliving|family room|den|common area|lounge\b/i },
];

/**
 * What a contractor is allowed to see on the offer / job card.
 * No job totals, payment-intent ids, assessed QC value, or "customer
 * not charged" — those stay on admin team notes.
 */
export function contractorFacingRecleanNotes(opts: {
  scope?: string | null;
  areas?: string[] | null;
}): string {
  const areas = (opts.areas || []).map((a) => String(a).trim()).filter(Boolean);
  if (opts.scope === "full") {
    return "Re-clean — full follow-up of the original visit. Stay on the booked work.";
  }
  if (areas.length) {
    return `Re-clean — ${areas.join(", ")}. Stay in the named areas.`;
  }
  return "Re-clean — complete the areas listed for this visit.";
}

const CONTRACTOR_NOTE_REDACT =
  /assessed value|customer not charged|performer is paid|see qc case|re-clean of nvc-|add-ons updated by admin|hold captured|overage|scope extras still due|charged off-session|spotless guarantee\s*—|pi_[a-z0-9]+|delta \$/i;

export function sanitizeContractorJobNotes(notes?: string | null): string | null {
  const raw = String(notes || "");
  if (!raw.trim()) return null;
  const kept = raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (CONTRACTOR_NOTE_REDACT.test(line)) return false;
      if (/\$[\d,]/.test(line)) return false;
      return true;
    });
  const text = kept.join("\n").trim();
  return text || null;
}

export function adminFacingRecleanNotes(opts: {
  originalRef: string;
  scope: string;
  areas?: string[] | null;
  assessedCents: number;
}): string {
  const areas = (opts.areas || []).filter(Boolean).join(", ");
  const scopeLabel = opts.scope === "full"
    ? "full re-service"
    : `targeted: ${areas || "see QC case"}`;
  return `RE-CLEAN of ${opts.originalRef} — ${scopeLabel}. Spotless Guarantee — customer not charged. Performer is paid on assessed value $${(opts.assessedCents / 100).toFixed(2)}.`;
}

export function namedAreasFromText(text: string | null | undefined): string[] {
  const raw = String(text || "");
  const found: string[] = [];
  for (const { areaId, pattern } of AREA_KEYWORDS) {
    if (pattern.test(raw) && !found.includes(areaId)) found.push(areaId);
  }
  return found;
}

export function photoMatchesAreas(
  photo: string | { url?: string | null; public_url?: string | null; caption?: string | null },
  areas: string[],
): boolean {
  if (!areas.length) return true;
  const hay = (typeof photo === "string"
    ? photo
    : [photo.url, photo.public_url, photo.caption].filter(Boolean).join(" ")
  ).toLowerCase();
  return areas.some((a) => hay.includes(a.toLowerCase()));
}

export function draftCustomerMessage(opts: {
  classification: RecleanClassification;
  firstName?: string | null;
  serviceDate?: string | null;
  timeSlot?: string | null;
  scope?: RecleanScope | null;
  scopeSummary?: string | null;
}): { subject: string; body: string; sms: string } {
  const name = (opts.firstName || "").trim() || "there";
  const when = [opts.serviceDate, opts.timeSlot].filter(Boolean).join(" · ");
  if (opts.classification === "not_supported") {
    const body =
      `Hi ${name},\n\n` +
      `Thank you for writing in. We reviewed the before-and-after photos and the completed checklist from your visit against what you described.\n\n` +
      `The documentation shows the booked work was completed to our standard in the areas you named. We'd still like to walk through the photos with you — reply to this message and we'll set that up. If anything was truly missed we'll make it right under the Spotless Guarantee.\n\n` +
      `— Novara Cleaning`;
    return {
      subject: "We reviewed your visit — happy to walk through the photos",
      body,
      sms:
        `Novara Cleaning: We reviewed the photos from your visit. They show the booked work was completed to standard. Want to go through them together? Reply to this text or call (844) 735-2070.`,
    };
  }
  const scopeLine = opts.scope === "full"
    ? "a full re-service of the home"
    : (opts.scopeSummary || "the specific areas you named");
  const whenLine = when ? ` We've scheduled it for ${when}.` : " We'll confirm the window shortly.";
  const body =
    `Hi ${name},\n\n` +
    `Under our Spotless Guarantee this re-clean is at no charge.${whenLine} ` +
    `The visit is ${scopeLine}.\n\n` +
    `Your cleaner will photograph the areas on arrival and after they're done so you can see the result.\n\n` +
    `— Novara Cleaning`;
  return {
    subject: "Your complimentary re-clean is scheduled — Spotless Guarantee",
    body,
    sms:
      `Novara Cleaning: Your complimentary re-clean is set` +
      (when ? ` for ${when}` : "") +
      `. No charge — Spotless Guarantee. Reply STOP to opt out.`,
  };
}

export function draftCompletionMessage(opts: {
  firstName?: string | null;
  photoCount?: number;
}): { subject: string; body: string; sms: string } {
  const name = (opts.firstName || "").trim() || "there";
  const n = Number(opts.photoCount) || 0;
  return {
    subject: "Your re-clean is complete",
    body:
      `Hi ${name},\n\n` +
      `The complimentary re-clean is finished. ` +
      (n > 0
        ? `We've attached the after photos (${n}) so you can see the result.\n\n`
        : `After photos are in your job gallery.\n\n`) +
      `If anything still needs attention, reply to this email.\n\n— Novara Cleaning`,
    sms:
      `Novara Cleaning: Your complimentary re-clean is complete. After photos are in your gallery. Reply STOP to opt out.`,
  };
}

export function originalCleanerDeclineCopy(): string {
  return "Customer requested a different team.";
}

/** Reliability scoring must ignore re-clean offer outcomes. */
export function countsTowardReliability(assignment: {
  reliability_neutral?: boolean | null;
}): boolean {
  return assignment.reliability_neutral !== true;
}

/**
 * Quality Score only moves on a verified quality miss. Add-on / site-finding
 * rows are documentation, not failures. A re-clean request that is still
 * pending, classified as scope confusion, or not supported never hits.
 */
export function countsTowardQualityScore(issue: {
  issue_type?: string | null;
  reclean_status?: string | null;
  reclean_classification?: string | null;
}): boolean {
  const t = String(issue.issue_type || "");
  if (t === "addon" || t === "site_finding") return false;
  const status = String(issue.reclean_status || "none");
  if (status && status !== "none") return qualityHitApplies(issue.reclean_classification);
  return true;
}

export function recleanSourceForIntake(opts: {
  issueType: string;
  reportedVia: string;
}): "review_gating" | "internal_qc" | "va_complaint" {
  if (opts.reportedVia === "customer") return "review_gating";
  if (opts.issueType === "quality_flag") return "internal_qc";
  return "va_complaint";
}

export function sizeBand(sqft: number | null | undefined): string {
  const n = Number(sqft) || 0;
  if (n <= 0) return "unknown";
  if (n < 1500) return "under_1500";
  if (n < 2500) return "1500_2500";
  if (n < 3500) return "2500_3500";
  return "3500_plus";
}

/**
 * Pricing-engine value of a re-clean's actual scope, in cents.
 * Targeted = Focused Clean per-area rates. Full = original job value.
 * Returns 0 when a targeted re-clean has no areas — callers must refuse
 * that (unpaid work is prohibited), not invent a number.
 */
export function assessedRecleanValueCents(opts: {
  scope: RecleanScope;
  areas: Array<{ areaId: string; quantity?: number } | string>;
  originalChargeCents: number;
  focusedSettings?: FocusedSameDaySettings;
}): number {
  if (opts.scope === "full") {
    return Math.max(0, Math.round(Number(opts.originalChargeCents) || 0));
  }
  const selections = (opts.areas || [])
    .map((a) =>
      typeof a === "string"
        ? { areaId: a, quantity: 1 }
        : { areaId: a.areaId, quantity: Math.max(1, Number(a.quantity) || 1) },
    )
    .filter((s) => s.areaId);
  if (!selections.length) return 0;
  const priced = calculateFocusedPrice(selections, "normal", false, opts.focusedSettings);
  return Math.max(0, Math.round(priced.total * 100));
}

/** Load admin-tunable window/thresholds; falls back to defaults. */
export async function loadRecleanSettings(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<RecleanSettings> {
  try {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", RECLEAN_SETTINGS_KEY)
      .maybeSingle();
    return mergeRecleanSettings(data?.value);
  } catch {
    return { ...RECLEAN_SETTINGS_DEFAULTS };
  }
}

// ─── Urgent Hire helpers for the edge function (Deno) ───────────────────────
//
// Keep tunables and copy aligned with src/lib/urgent-hire.ts. The Node
// verify script (scripts/verify-urgent-hire.ts) is the behaviour lock.

export const URGENT_HIRE_SETTINGS_KEY = "urgent_hire_settings";
export const URGENT_HIRE_PORTAL_BASE = "https://contractor.novaracleaning.com";

export const URGENT_HIRE_ELIGIBLE_STAGES = ["screening", "onboarding", "agreement_signed"] as const;
export const URGENT_HIRE_EXCLUDED_STAGES = ["applicant", "hold", "rejected", "withdrawn", "active"] as const;

/** Job-needed essentials from src/lib/cleaner-supplies.ts (neededForJob: true). */
export const NEEDED_SUPPLY_IDS = [
  "all_purpose_cleaner",
  "glass_mirror_cleaner",
  "disinfectant_spray",
  "bathroom_cleaner",
  "toilet_bowl_cleaner",
  "kitchen_degreaser",
  "vacuum",
  "mop_bucket",
  "microfiber_cloths",
  "scrub_brush",
  "toilet_brush",
  "white_scrub_pads",
  "spray_bottles",
  "cleaning_tote",
  "rubber_gloves",
] as const;

export const SUPPLY_READY_PERCENT = 70;

export interface UrgentHireSettings {
  radius_miles: number;
  pay_percent: number;
  first_job_only: boolean;
  fill_window_minutes: number;
  checklist_freshness_days: number;
}

export const URGENT_HIRE_DEFAULTS: UrgentHireSettings = {
  radius_miles: 25,
  pay_percent: 45,
  first_job_only: true,
  fill_window_minutes: 90,
  checklist_freshness_days: 30,
};

export function parseUrgentHireSettings(raw: unknown): UrgentHireSettings {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  return {
    radius_miles: num(src.radius_miles, URGENT_HIRE_DEFAULTS.radius_miles, 5, 80),
    pay_percent: num(src.pay_percent, URGENT_HIRE_DEFAULTS.pay_percent, 20, 60),
    first_job_only: src.first_job_only === false ? false : true,
    fill_window_minutes: num(
      src.fill_window_minutes,
      URGENT_HIRE_DEFAULTS.fill_window_minutes,
      15,
      24 * 60,
    ),
    checklist_freshness_days: num(
      src.checklist_freshness_days,
      URGENT_HIRE_DEFAULTS.checklist_freshness_days,
      1,
      365,
    ),
  };
}

export function urgentHirePayCents(jobValueCents: number, payPercent: number): number {
  const value = Math.max(0, Math.round(Number(jobValueCents) || 0));
  const pct = Math.max(0, Number(payPercent) || 0);
  return Math.round((value * pct) / 100);
}

export function isUrgentHirePipelineStage(stage: string | null | undefined): boolean {
  const s = String(stage || "").toLowerCase();
  return (URGENT_HIRE_ELIGIBLE_STAGES as readonly string[]).includes(s);
}

export function isActiveRosterStatus(status: string | null | undefined): boolean {
  return String(status || "").toLowerCase() === "active";
}

export function unfilledStillNeedsCoverage(opts: {
  broadcastStatus: string;
  jobStatus?: string | null;
}): boolean {
  if (String(opts.broadcastStatus || "").toLowerCase() !== "unfilled") return false;
  const s = String(opts.jobStatus || "").toLowerCase();
  if (!s) return true;
  if (/(cancel|complete|invoice)/.test(s)) return false;
  if (/(confirm|assigned|in progress|in_progress)/.test(s)) return false;
  return true;
}

/** Postgres/Postgrest errors are plain objects — String(err) is "[object Object]". */
export function urgentHireErrorMessage(e: unknown, fallback = "Urgent Hire failed."): string {
  if (typeof e === "string" && e.trim() && e !== "[object Object]") return e.slice(0, 400);
  if (e instanceof Error && e.message && e.message !== "[object Object]") return e.message.slice(0, 400);
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown; error?: unknown };
    const parts = [o.message, o.details, o.hint].filter((x) => typeof x === "string" && x.trim()) as string[];
    if (parts.length) {
      const code = typeof o.code === "string" && o.code ? ` (${o.code})` : "";
      return `${parts.join(" — ")}${code}`.slice(0, 400);
    }
    if (typeof o.error === "string" && o.error.trim()) return o.error.slice(0, 400);
    try {
      const s = JSON.stringify(e);
      if (s && s !== "{}" && s !== "[object Object]") return s.slice(0, 400);
    } catch {
      /* fall through */
    }
  }
  const s = String(e ?? "");
  return s && s !== "[object Object]" ? s.slice(0, 400) : fallback;
}

export function screeningQualifiersPass(answers: unknown): boolean {
  const bag = answers && typeof answers === "object" ? (answers as Record<string, unknown>) : {};
  const qualifiers = (bag.qualifiers && typeof bag.qualifiers === "object"
    ? bag.qualifiers
    : {}) as Record<string, unknown>;
  return qualifiers.photo_id === "pass" && qualifiers.own_car === "pass";
}

export function supplyChecklistFresh(
  submittedAt: string | null | undefined,
  freshnessDays: number,
  nowMs = Date.now(),
): boolean {
  if (!submittedAt) return false;
  const at = new Date(submittedAt).getTime();
  if (!Number.isFinite(at)) return false;
  const windowMs = Math.max(1, freshnessDays) * 24 * 60 * 60 * 1000;
  return nowMs - at <= windowMs;
}

export function scoreNeededSupplies(inventory: Record<string, boolean> | null | undefined): {
  ownedNeeded: number;
  totalNeeded: number;
  percent: number;
  ready: boolean;
} {
  const totalNeeded = NEEDED_SUPPLY_IDS.length;
  const threshold = Math.ceil((totalNeeded * SUPPLY_READY_PERCENT) / 100);
  const ownedNeeded = NEEDED_SUPPLY_IDS.filter((id) => inventory?.[id] === true).length;
  const percent = totalNeeded === 0 ? 0 : Math.round((ownedNeeded / totalNeeded) * 100);
  return { ownedNeeded, totalNeeded, percent, ready: ownedNeeded >= threshold };
}

export function supplyChecklistValid(opts: {
  inventory: Record<string, boolean> | null | undefined;
  submittedAt: string | null | undefined;
  freshnessDays: number;
  nowMs?: number;
}): { ready: boolean; fresh: boolean; valid: boolean; percent: number } {
  const score = scoreNeededSupplies(opts.inventory);
  const fresh = supplyChecklistFresh(opts.submittedAt, opts.freshnessDays, opts.nowMs);
  return { ready: score.ready, fresh, valid: score.ready && fresh, percent: score.percent };
}

export function payoutsReady(cleaner: {
  payouts_enabled?: boolean | null;
  ob_payouts_setup?: boolean | null;
  stripe_account_id?: string | null;
}): boolean {
  return Boolean(
    cleaner.payouts_enabled ||
      cleaner.ob_payouts_setup ||
      (cleaner.stripe_account_id && String(cleaner.stripe_account_id).trim()),
  );
}

export type UrgentHireRemainingStep = "supplies" | "agreement" | "payout";

export function remainingUrgentHireSteps(opts: {
  checklistValid: boolean;
  agreementSigned: boolean;
  payoutsReady: boolean;
}): UrgentHireRemainingStep[] {
  const steps: UrgentHireRemainingStep[] = [];
  if (!opts.checklistValid) steps.push("supplies");
  if (!opts.agreementSigned) steps.push("agreement");
  if (!opts.payoutsReady) steps.push("payout");
  return steps;
}

export function urgentHireOfferUrl(token: string): string {
  return `${URGENT_HIRE_PORTAL_BASE}/cleaner/urgent-hire/${encodeURIComponent(token)}`;
}

export function firstJobOnlySentence(firstJobOnly: boolean, payPercent: number): string {
  if (firstJobOnly) {
    return `This ${payPercent}% rate applies to your first job only; standard tier rates apply after.`;
  }
  return `This job pays ${payPercent}% of the job value.`;
}

export interface UrgentHireOfferCopy {
  serviceType: string;
  dateLabel: string;
  timeWindow: string;
  zone: string;
  payPercent: number;
  payDollars: string;
  firstJobOnly: boolean;
  offerUrl: string;
  needsChecklist: boolean;
  miles?: number | null;
  radiusMiles?: number;
}

export const APPLIED_IN_PAST_ACK =
  "You're getting this because you applied to Novara.";

export function formatUrgentHireMileageLine(
  miles: number | null | undefined,
  radiusMiles: number,
): string | null {
  const n = Number(miles);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n <= radiusMiles) return null;
  const rounded = Math.max(1, Math.round(n));
  return `About ${rounded} mile${rounded === 1 ? "" : "s"} from the job.`;
}

export function buildUrgentHireSms(copy: UrgentHireOfferCopy): string {
  const when = copy.timeWindow ? `${copy.dateLabel} · ${copy.timeWindow}` : copy.dateLabel;
  const firstJob = firstJobOnlySentence(copy.firstJobOnly, copy.payPercent);
  const mileage = formatUrgentHireMileageLine(copy.miles, copy.radiusMiles ?? URGENT_HIRE_DEFAULTS.radius_miles);
  const gate = copy.needsChecklist
    ? "Accepting requires finishing remaining steps first (supply checklist, agreement, payout setup) — the job goes to whoever finishes and accepts soonest."
    : "Accepting requires a signed agreement and payout setup if you haven't finished them — the job goes to whoever finishes and accepts soonest.";
  return (
    `Novara — Urgent Hire\n\n` +
    `${APPLIED_IN_PAST_ACK}\n\n` +
    `${copy.serviceType}\n` +
    `${when}\n` +
    `Area: ${copy.zone}\n` +
    (mileage ? `${mileage}\n` : "") +
    `Your pay: $${copy.payDollars} (${copy.payPercent}% of job value)\n` +
    `${firstJob}\n\n` +
    `${gate}\n\n` +
    `${copy.offerUrl}`
  );
}

export function serviceTypeLabel(raw: string | null | undefined): string {
  const s = String(raw || "cleaning").replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Cleaning";
}

export function zoneLabel(city: string | null | undefined, zip: string | null | undefined): string {
  const c = String(city || "").trim();
  const z = String(zip || "").trim();
  if (c && z) return `${c} ${z}`;
  return c || z || "your area";
}

export function dollarsFromCents(cents: number): string {
  return (Math.max(0, cents) / 100).toFixed(2);
}

export function usablePhone(input: string | null | undefined): string | null {
  const digits = String(input || "").replace(/[^0-9]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function mintHexToken(bytes = 20): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Pest (light) / mold (minor) site findings.
//
// Confirmed-minor findings are billable in-scope work. They reuse:
//   • qc_issues (issue_type = site_finding) — QC record + dispute packet
//   • focused_same_day_settings / computeServerQuote — never a guessed amount
//   • bookings.before_photos / after_photos — evidence photos on the job
//   • booking_addon_charges + off-session Stripe — same charge path as add-ons
//   • send-addon-email + send-ghl-sms — customer notice from the QC record
//
// Anything that fails the size/severity gate is NOT handled here — callers
// route to the existing qc-issues field_report (stop-and-report) path.

import Stripe from "https://esm.sh/stripe@18.5.0";
import { resolveSecret } from "./app-secrets.ts";
import {
  FOCUSED_SAME_DAY_DEFAULTS,
  FOCUSED_SAME_DAY_SETTINGS_KEY,
  areaDef,
  calculateFocusedPrice,
  mergeFocusedSameDaySettings,
  type FocusedAreaSelection,
  type FocusedCondition,
  type FocusedSameDaySettings,
} from "./focused-same-day.ts";
import {
  computeServerQuote,
  loadDynamicPricingContext,
  type ConditionLevel,
  type DynamicServiceType,
  type MembershipPlanId,
} from "./dynamic-quote.ts";
import { resolveOffSessionPaymentMethod } from "./resolve-off-session-payment-method.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export const SITE_FINDING_TYPES = ["pest_light", "mold_minor"] as const;
export type SiteFindingType = (typeof SITE_FINDING_TYPES)[number];

export const SITE_FINDING_TEMPLATES_KEY = "site_finding_notice_templates";

export const FINDING_COPY: Record<SiteFindingType, { short: string; email: string; sms: string }> = {
  pest_light: {
    short: "Pest — Light",
    email: "light pest presence",
    sms: "light pest presence",
  },
  mold_minor: {
    short: "Mold — Minor",
    email: "a small area of surface mold",
    sms: "minor surface mold",
  },
};

export type SiteFindingPricingPath = "focused_addon" | "heavy_condition" | "none";
export type SiteFindingStatus = "pending_after" | "priced" | "notified";

export interface SiteFindingDetails {
  finding_type: SiteFindingType;
  location: string;
  area_id: string | null;
  confined: boolean;
  size_confirmation: Record<string, boolean | string>;
  pricing_path: SiteFindingPricingPath;
  pricing_rule_label: string;
  preview_delta_cents: number;
  price_delta_cents: number | null;
  original_total_cents: number;
  new_total_cents: number | null;
  before_photo_urls: string[];
  after_photo_urls: string[];
  recurrence: boolean;
  recurrence_same_spot: boolean;
  prior_issue_ids: string[];
  status: SiteFindingStatus;
  priced_at: string | null;
  notified_at: string | null;
  charge_status: string | null;
  addon_charge_id: string | null;
}

export interface SiteFindingIssue {
  id: string;
  issue_number: number | null;
  booking_id: string;
  title: string;
  description: string | null;
  details: SiteFindingDetails;
  created_at: string;
  cleaner_name: string | null;
}

export const DEFAULT_SITE_FINDING_TEMPLATES = {
  email_subject: "A quick update on today's clean",
  email_body_priced:
    "Hi {name}, during today's visit our team found {finding} in {location} and handled it as part of the clean. This reflects a {adjustment} adjustment to today's total, bringing it to {new_total}. Before and after photos are on file.{recurrence} Thanks!",
  email_body_info:
    "Hi {name}, during today's visit our team found {finding} in {location} and handled it as part of the clean. Today's total is unchanged. Before and after photos are on file.{recurrence} Thanks!",
  sms_priced:
    "Hi {name}, quick note — we found {finding_sms} in {location} during today's clean and handled it. This added {delta} to today's total ({new_total} final). Photos on file. Thanks!",
  sms_info:
    "Hi {name}, quick note — we found {finding_sms} in {location} during today's clean and handled it. No change to today's total. Photos on file. Thanks!",
  mold_recurrence_sentence:
    " If you notice this returning in the same spot, it can sometimes point to a moisture issue worth having looked at.",
};

export function isSiteFindingType(v: unknown): v is SiteFindingType {
  return v === "pest_light" || v === "mold_minor";
}

export function centsMoney(cents: number): string {
  return `$${(Math.round(cents) / 100).toFixed(2)}`;
}

export function httpUrls(raw: unknown, cap = 12): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(String).filter((u) => /^https?:\/\//i.test(u)).slice(0, cap);
}

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function normText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] != null ? vars[k] : ""));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] || ch
  ));
}

export interface ScopeInput {
  findingType: SiteFindingType;
  /** Pest: active infestation or any bed bugs. Mold unused. */
  infestationOrBedBugs?: boolean;
  /** Mold: larger than ~10 sq ft, porous, or musty odor from a hidden source. Pest unused. */
  overThreshold?: boolean;
  /** Confined to one small area? Only meaningful when in-scope. */
  confined?: boolean;
}

export interface ScopeResult {
  inScope: boolean;
  stopReason: "active_infestation" | "mold_over_threshold" | null;
  confined: boolean;
  stopDescription: string | null;
}

export function evaluateSiteFindingScope(input: ScopeInput): ScopeResult {
  if (input.findingType === "pest_light" && input.infestationOrBedBugs === true) {
    return {
      inScope: false,
      stopReason: "active_infestation",
      confined: false,
      stopDescription:
        "STOP — active infestation or bed bugs. Do not proceed with this work. Dispatch has been alerted. Follow the biohazard/pest stop-and-report protocol.",
    };
  }
  if (input.findingType === "mold_minor" && input.overThreshold === true) {
    return {
      inScope: false,
      stopReason: "mold_over_threshold",
      confined: false,
      stopDescription:
        "STOP — mold is beyond the minor surface threshold (size, porosity, or hidden-source odor). Do not attempt that work. Dispatch has been alerted.",
    };
  }
  return {
    inScope: true,
    stopReason: null,
    confined: input.confined === true,
    stopDescription: null,
  };
}

export function buildQcDescription(d: SiteFindingDetails, extra?: { cleanerName?: string; at?: string }): string {
  const copy = FINDING_COPY[d.finding_type];
  const lines = [
    `Site finding: ${copy.short}`,
    `Location/area: ${d.location}${d.area_id ? ` (area id: ${d.area_id})` : ""}`,
    `Size/severity: confirmed in-scope, ${d.confined ? "confined to one small area" : "spread but still surface-level/minor"}.`,
    `Pricing rule: ${d.pricing_rule_label}`,
  ];
  if (d.price_delta_cents != null && d.new_total_cents != null) {
    lines.push(
      `Price impact: ${centsMoney(d.price_delta_cents)} (${d.pricing_path}) · original ${centsMoney(d.original_total_cents)} → ${centsMoney(d.new_total_cents)}`,
    );
  } else {
    lines.push(
      `Previewed price impact: ${centsMoney(d.preview_delta_cents)} (${d.pricing_path}). Not charged until the after photo is on file.`,
    );
  }
  lines.push(`Before photos: ${d.before_photo_urls.length} on file`);
  lines.push(
    d.after_photo_urls.length
      ? `After photos: ${d.after_photo_urls.length} on file`
      : "After photos: pending — finding cannot be priced until an after photo is on file.",
  );
  if (d.recurrence) {
    lines.push(
      d.finding_type === "mold_minor"
        ? `Recurrence: YES — same finding type at this property on a prior visit${d.recurrence_same_spot ? " (same spot)" : ""}. Moisture-issue signal.`
        : `Recurrence: YES — same finding type at this property on a prior visit.`,
    );
  } else {
    lines.push("Recurrence: no prior record of this finding type at this property.");
  }
  if (extra?.cleanerName) lines.push(`Cleaner: ${extra.cleanerName}`);
  if (extra?.at) lines.push(`Timestamp: ${extra.at}`);
  if (d.before_photo_urls[0]) lines.push(`Before: ${d.before_photo_urls[0]}`);
  if (d.after_photo_urls[0]) lines.push(`After: ${d.after_photo_urls[0]}`);
  return lines.join("\n");
}

export async function loadFocusedFindingSettings(supabase: SB): Promise<FocusedSameDaySettings> {
  try {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", FOCUSED_SAME_DAY_SETTINGS_KEY)
      .maybeSingle();
    if (data?.value) return mergeFocusedSameDaySettings(data.value);
  } catch { /* defaults */ }
  return FOCUSED_SAME_DAY_DEFAULTS;
}

async function loadNoticeTemplates(supabase: SB): Promise<typeof DEFAULT_SITE_FINDING_TEMPLATES> {
  try {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", SITE_FINDING_TEMPLATES_KEY)
      .maybeSingle();
    const v = data?.value && typeof data.value === "object" ? data.value as Record<string, unknown> : {};
    return {
      email_subject: String(v.email_subject || DEFAULT_SITE_FINDING_TEMPLATES.email_subject),
      email_body_priced: String(v.email_body_priced || DEFAULT_SITE_FINDING_TEMPLATES.email_body_priced),
      email_body_info: String(v.email_body_info || DEFAULT_SITE_FINDING_TEMPLATES.email_body_info),
      sms_priced: String(v.sms_priced || DEFAULT_SITE_FINDING_TEMPLATES.sms_priced),
      sms_info: String(v.sms_info || DEFAULT_SITE_FINDING_TEMPLATES.sms_info),
      mold_recurrence_sentence: String(
        v.mold_recurrence_sentence || DEFAULT_SITE_FINDING_TEMPLATES.mold_recurrence_sentence,
      ),
    };
  } catch {
    return DEFAULT_SITE_FINDING_TEMPLATES;
  }
}

function bookingTotalCents(booking: Record<string, unknown>): number {
  if (booking.final_charge_cents != null && Number.isFinite(Number(booking.final_charge_cents))) {
    return Math.max(0, Math.round(Number(booking.final_charge_cents)));
  }
  return Math.max(0, Math.round(Number(booking.total_estimate_cents || 0)));
}

function isFocusedService(raw: string): boolean {
  const k = String(raw || "").toLowerCase().replace(/[\s-]/g, "_");
  return k === "focused" || k === "single_area";
}

function toDynamicServiceType(raw: string): DynamicServiceType {
  const k = String(raw || "").toLowerCase().replace(/[\s-]/g, "_");
  if (k === "focused" || k === "single_area") return "focused";
  if (k === "deep") return "deep";
  if (k === "combo") return "combo";
  if (k === "moveinout" || k === "move_in_out") return "moveInOut";
  return "standard";
}

function toQuoteCondition(level: string | null | undefined): ConditionLevel {
  const k = String(level || "").toLowerCase();
  if (k === "light") return "light";
  if (k === "heavy" || k === "severe") return "heavy";
  return "standard";
}

function toFocusedCondition(level: string | null | undefined): FocusedCondition {
  const k = String(level || "").toLowerCase();
  if (k === "light" || k === "heavy" || k === "severe") return k;
  return "normal";
}

function alreadyHeavy(level: string | null | undefined): boolean {
  const k = String(level || "").toLowerCase();
  return k === "heavy" || k === "severe";
}

function clientTypeOf(booking: Record<string, unknown>): string {
  const t = String(booking.booking_type || "");
  if (t === "commercial") return "commercial";
  if (t === "office") return "office";
  if (t === "str_turnover") return "str";
  if (t === "partnership") {
    const pd = booking.partner_details as Record<string, unknown> | null;
    return String(pd?.booking_type || "") === "str_turnover" ? "str" : "commercial";
  }
  return "residential";
}

function bookingRefOf(booking: Record<string, unknown>): string {
  const n = booking.booking_number;
  return n != null ? `NVC-${String(n).padStart(4, "0")}` : `Job ${String(booking.id).slice(0, 8)}`;
}

export function parseFindingDetails(raw: unknown): SiteFindingDetails | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (!isSiteFindingType(d.finding_type)) return null;
  return {
    finding_type: d.finding_type,
    location: String(d.location || "").trim() || "the property",
    area_id: d.area_id ? String(d.area_id) : null,
    confined: d.confined === true,
    size_confirmation: (d.size_confirmation && typeof d.size_confirmation === "object")
      ? d.size_confirmation as Record<string, boolean | string>
      : {},
    pricing_path: d.pricing_path === "focused_addon" || d.pricing_path === "heavy_condition" || d.pricing_path === "none"
      ? d.pricing_path
      : "none",
    pricing_rule_label: String(d.pricing_rule_label || ""),
    preview_delta_cents: Math.max(0, Math.round(Number(d.preview_delta_cents || 0))),
    price_delta_cents: d.price_delta_cents == null ? null : Math.round(Number(d.price_delta_cents)),
    original_total_cents: Math.max(0, Math.round(Number(d.original_total_cents || 0))),
    new_total_cents: d.new_total_cents == null ? null : Math.max(0, Math.round(Number(d.new_total_cents))),
    before_photo_urls: httpUrls(d.before_photo_urls),
    after_photo_urls: httpUrls(d.after_photo_urls),
    recurrence: d.recurrence === true,
    recurrence_same_spot: d.recurrence_same_spot === true,
    prior_issue_ids: Array.isArray(d.prior_issue_ids) ? d.prior_issue_ids.map(String) : [],
    status: d.status === "priced" || d.status === "notified" || d.status === "pending_after"
      ? d.status
      : "pending_after",
    priced_at: d.priced_at ? String(d.priced_at) : null,
    notified_at: d.notified_at ? String(d.notified_at) : null,
    charge_status: d.charge_status ? String(d.charge_status) : null,
    addon_charge_id: d.addon_charge_id ? String(d.addon_charge_id) : null,
  };
}

export interface PricingPreview {
  path: SiteFindingPricingPath;
  ruleLabel: string;
  deltaCents: number;
  originalTotalCents: number;
  newTotalCents: number;
}

export async function previewSiteFindingPrice(
  supabase: SB,
  booking: Record<string, unknown>,
  opts: { confined: boolean; areaId: string | null },
): Promise<PricingPreview> {
  const originalTotalCents = bookingTotalCents(booking);
  const settings = await loadFocusedFindingSettings(supabase);

  if (opts.confined) {
    const areaId = opts.areaId && areaDef(settings, opts.areaId) ? opts.areaId : "other";
    const def = areaDef(settings, areaId) || areaDef(settings, "other");
    const dollars = def?.price ?? settings.minimum_dollars;
    const deltaCents = Math.max(0, Math.round(Number(dollars) * 100));
    const label = def?.label || areaId;
    return {
      path: "focused_addon",
      ruleLabel: `Focused Clean add-on · ${label} · ${centsMoney(deltaCents)} (engine area rate)`,
      deltaCents,
      originalTotalCents,
      newTotalCents: originalTotalCents + deltaCents,
    };
  }

  if (alreadyHeavy(String(booking.condition_level || ""))) {
    return {
      path: "none",
      ruleLabel: "Heavy condition already on this job — no further condition multiplier",
      deltaCents: 0,
      originalTotalCents,
      newTotalCents: originalTotalCents,
    };
  }

  const engine = await quoteHeavyDelta(supabase, booking, originalTotalCents, settings);
  if (engine.deltaCents <= 0) {
    return {
      path: "none",
      ruleLabel: engine.ruleLabel,
      deltaCents: 0,
      originalTotalCents,
      newTotalCents: originalTotalCents,
    };
  }
  return {
    path: "heavy_condition",
    ruleLabel: engine.ruleLabel,
    deltaCents: engine.deltaCents,
    originalTotalCents,
    newTotalCents: originalTotalCents + engine.deltaCents,
  };
}

async function quoteHeavyDelta(
  supabase: SB,
  booking: Record<string, unknown>,
  originalTotalCents: number,
  settings: FocusedSameDaySettings,
): Promise<{ deltaCents: number; ruleLabel: string }> {
  const currentCond = toQuoteCondition(String(booking.condition_level || "normal"));
  if (currentCond === "heavy") {
    return { deltaCents: 0, ruleLabel: "Already Heavy in the pricing engine — $0 delta" };
  }

  try {
    const ctx = await loadDynamicPricingContext(supabase);
    const zip = String(booking.zip_code || "").trim();
    const serviceType = toDynamicServiceType(String(booking.service_type || "standard"));
    const focusedAreas: FocusedAreaSelection[] = Array.isArray(booking.focused_areas)
      ? booking.focused_areas as FocusedAreaSelection[]
      : [];
    const addOns = Array.isArray(booking.add_ons) ? booking.add_ons.map(String) : [];
    const membership = (["monthly", "biweekly", "weekly"].includes(String(booking.membership_plan || ""))
      ? String(booking.membership_plan)
      : "none") as MembershipPlanId;

    const baseParams = {
      zip,
      serviceType,
      homeSizeId: booking.home_size_id ? String(booking.home_size_id) : null,
      focused: serviceType === "focused" ? { selections: focusedAreas } : null,
      addOns,
      serviceDate: booking.service_date ? String(booking.service_date) : null,
      membershipPlan: membership,
      persistDemandState: false,
      audit: true,
      bookingId: String(booking.id),
      quotedBy: "site-finding",
    };

    const current = await computeServerQuote(supabase, ctx, { ...baseParams, condition: currentCond });
    const heavy = await computeServerQuote(supabase, ctx, { ...baseParams, condition: "heavy" });
    if (current.ok && heavy.ok && current.breakdown && heavy.breakdown) {
      const delta = Math.max(0, heavy.breakdown.totalCents - current.breakdown.totalCents);
      return {
        deltaCents: delta,
        ruleLabel: delta > 0
          ? `Heavy condition multiplier (engine ${currentCond} → heavy) · ${centsMoney(delta)}`
          : "Engine Heavy quote equals current quote — $0 delta",
      };
    }
  } catch (e) {
    console.warn("[site-finding] dynamic quote failed, using focused condition fallback", e instanceof Error ? e.message : String(e));
  }

  // Fallback: same focused/same-day condition table the rest of focused pricing uses.
  if (isFocusedService(String(booking.service_type || ""))) {
    const focusedAreas: FocusedAreaSelection[] = Array.isArray(booking.focused_areas)
      ? booking.focused_areas as FocusedAreaSelection[]
      : [];
    const current = calculateFocusedPrice(focusedAreas, toFocusedCondition(String(booking.condition_level || "normal")), false, settings);
    const heavy = calculateFocusedPrice(focusedAreas, "heavy", false, settings);
    const delta = Math.max(0, Math.round((heavy.total - current.total) * 100));
    return {
      deltaCents: delta,
      ruleLabel: `Heavy condition multiplier (focused settings) · ${centsMoney(delta)}`,
    };
  }

  const currentMult = settings.condition_multipliers[toFocusedCondition(String(booking.condition_level || "normal"))] ?? 1;
  const heavyMult = settings.condition_multipliers.heavy ?? 1.25;
  if (currentMult <= 0 || heavyMult <= currentMult) {
    return { deltaCents: 0, ruleLabel: "Heavy condition multiplier would not increase this total" };
  }
  const impliedBase = originalTotalCents / currentMult;
  const delta = Math.max(0, Math.round(impliedBase * heavyMult) - originalTotalCents);
  return {
    deltaCents: delta,
    ruleLabel: `Heavy condition multiplier (settings ${currentMult} → ${heavyMult}) · ${centsMoney(delta)}`,
  };
}

export async function lookupRecurrence(
  supabase: SB,
  booking: Record<string, unknown>,
  findingType: SiteFindingType,
  location: string,
): Promise<{ recurrence: boolean; sameSpot: boolean; priorIssueIds: string[] }> {
  const email = String(booking.email || "").trim().toLowerCase();
  const zip = String(booking.zip_code || "").trim();
  const address = String(booking.address || "").trim();
  const priorIds = new Set<string>();

  if (email && email.includes("@")) {
    const { data } = await supabase.from("bookings").select("id").neq("id", booking.id).ilike("email", email).limit(40);
    for (const row of data || []) priorIds.add(String(row.id));
  }
  if (zip && address) {
    const { data } = await supabase
      .from("bookings")
      .select("id, address")
      .neq("id", booking.id)
      .eq("zip_code", zip)
      .limit(80);
    const want = normText(address);
    for (const row of data || []) {
      if (normText(String(row.address || "")) === want) priorIds.add(String(row.id));
    }
  }
  if (priorIds.size === 0) return { recurrence: false, sameSpot: false, priorIssueIds: [] };

  const { data: issues } = await supabase
    .from("qc_issues")
    .select("id, details")
    .eq("issue_type", "site_finding")
    .in("booking_id", [...priorIds])
    .limit(50);

  const loc = normText(location);
  const priorIssueIds: string[] = [];
  let sameSpot = false;
  for (const iss of issues || []) {
    const d = parseFindingDetails(iss.details);
    if (!d || d.finding_type !== findingType) continue;
    priorIssueIds.push(String(iss.id));
    if (loc && normText(d.location) === loc) sameSpot = true;
  }
  return { recurrence: priorIssueIds.length > 0, sameSpot, priorIssueIds };
}

export async function listSiteFindings(supabase: SB, bookingId: string): Promise<SiteFindingIssue[]> {
  const { data } = await supabase
    .from("qc_issues")
    .select("id, issue_number, booking_id, title, description, details, created_at, cleaner_name")
    .eq("booking_id", bookingId)
    .eq("issue_type", "site_finding")
    .order("created_at", { ascending: true });
  const out: SiteFindingIssue[] = [];
  for (const row of data || []) {
    const details = parseFindingDetails(row.details);
    if (!details) continue;
    out.push({
      id: row.id,
      issue_number: row.issue_number ?? null,
      booking_id: row.booking_id,
      title: row.title,
      description: row.description,
      details,
      created_at: row.created_at,
      cleaner_name: row.cleaner_name || null,
    });
  }
  return out;
}

export function pendingAfterFinding(findings: SiteFindingIssue[]): SiteFindingIssue | null {
  return findings.find((f) => f.details.status === "pending_after") || null;
}

async function mergeFindingPhotosOntoBooking(
  supabase: SB,
  booking: Record<string, unknown>,
  before: string[],
  after: string[],
): Promise<void> {
  const existingBefore = Array.isArray(booking.before_photos) ? booking.before_photos.map(String) : [];
  const existingAfter = Array.isArray(booking.after_photos) ? booking.after_photos.map(String) : [];
  const nextBefore = uniqueUrls([...existingBefore, ...before]);
  const nextAfter = uniqueUrls([...existingAfter, ...after]);
  await supabase.from("bookings").update({
    before_photos: nextBefore,
    after_photos: nextAfter,
  }).eq("id", booking.id);
  booking.before_photos = nextBefore;
  booking.after_photos = nextAfter;
}

function stopFieldReportText(opts: {
  findingType: SiteFindingType;
  location: string;
  stopReason: ScopeResult["stopReason"];
  beforePhotoUrl?: string;
}): string {
  const copy = FINDING_COPY[opts.findingType];
  const why = opts.stopReason === "active_infestation"
    ? "Cleaner indicated an active infestation or bed bugs — existing biohazard/pest stop-and-report. Do not price as a minor finding."
    : "Cleaner indicated mold beyond the ~10 sq ft / non-porous / no-hidden-source threshold — existing mold exclusion. Do not price as a minor finding.";
  return (
    `[STOP-AND-REPORT · ${copy.short}] Location: ${opts.location}. ${why}` +
    (opts.beforePhotoUrl ? ` Before photo: ${opts.beforePhotoUrl}` : "")
  );
}

export async function createSiteFindingQc(
  supabase: SB,
  opts: {
    booking: Record<string, unknown>;
    cleanerId: string | null;
    cleanerName: string;
    findingType: SiteFindingType;
    location: string;
    areaId: string | null;
    confined: boolean;
    sizeConfirmation: Record<string, boolean | string>;
    beforePhotoUrl: string;
    preview: PricingPreview;
    recurrence: { recurrence: boolean; sameSpot: boolean; priorIssueIds: string[] };
  },
): Promise<SiteFindingIssue> {
  const nowIso = new Date().toISOString();
  const copy = FINDING_COPY[opts.findingType];
  const details: SiteFindingDetails = {
    finding_type: opts.findingType,
    location: opts.location,
    area_id: opts.areaId,
    confined: opts.confined,
    size_confirmation: opts.sizeConfirmation,
    pricing_path: opts.preview.path,
    pricing_rule_label: opts.preview.ruleLabel,
    preview_delta_cents: opts.preview.deltaCents,
    price_delta_cents: null,
    original_total_cents: opts.preview.originalTotalCents,
    new_total_cents: null,
    before_photo_urls: [opts.beforePhotoUrl],
    after_photo_urls: [],
    recurrence: opts.recurrence.recurrence,
    recurrence_same_spot: opts.recurrence.sameSpot,
    prior_issue_ids: opts.recurrence.priorIssueIds,
    status: "pending_after",
    priced_at: null,
    notified_at: null,
    charge_status: null,
    addon_charge_id: null,
  };

  const { data: docRow } = await supabase
    .from("job_documentation")
    .select("id")
    .eq("booking_id", opts.booking.id)
    .maybeSingle();

  const involved = opts.cleanerId
    ? [{ id: opts.cleanerId, name: opts.cleanerName, role: null }]
    : [];

  const title = `${copy.short} in ${opts.location}`;
  const description = buildQcDescription(details, { cleanerName: opts.cleanerName, at: nowIso });
  const severity = opts.recurrence.recurrence && opts.findingType === "mold_minor" ? "high" : "medium";

  const { data: issue, error } = await supabase
    .from("qc_issues")
    .insert({
      booking_id: opts.booking.id,
      job_id: opts.booking.job_id || null,
      client_type: clientTypeOf(opts.booking),
      documentation_id: docRow?.id || null,
      cleaner_id: opts.cleanerId,
      cleaner_name: opts.cleanerName,
      cleaners: involved,
      client_name: `${opts.booking.first_name || ""} ${opts.booking.last_name || ""}`.trim() || null,
      client_email: opts.booking.email || null,
      booking_ref: bookingRefOf(opts.booking),
      issue_type: "site_finding",
      severity,
      status: "open",
      title,
      description,
      details,
      reported_via: "cleaner_field",
      reported_by_name: opts.cleanerName,
    })
    .select("id, issue_number, booking_id, title, description, details, created_at, cleaner_name")
    .single();
  if (error) throw error;

  await supabase.from("qc_issue_events").insert({
    issue_id: issue.id,
    action: "created",
    to_status: "open",
    note: description,
    actor_name: opts.cleanerName,
    data: { issue_type: "site_finding", finding_type: opts.findingType, via: "cleaner_field" },
  });

  if (severity === "high") {
    await supabase.from("events").insert({
      event_type: "qc.issue.created",
      booking_id: opts.booking.id,
      job_id: opts.booking.job_id || null,
      cleaner_id: opts.cleanerId,
      source: "site-finding",
      summary:
        `🔴 HIGH QC issue on ${bookingRefOf(opts.booking)} — site_finding: ${title}` +
        ` (cleaner: ${opts.cleanerName}). Recurring minor mold at this property — moisture-issue signal.`,
      data: { issue_id: issue.id, severity, issue_type: "site_finding" },
    }).then(() => undefined, () => undefined);
  }

  await mergeFindingPhotosOntoBooking(supabase, opts.booking, [opts.beforePhotoUrl], []);

  return {
    id: issue.id,
    issue_number: issue.issue_number ?? null,
    booking_id: issue.booking_id,
    title: issue.title,
    description: issue.description,
    details,
    created_at: issue.created_at,
    cleaner_name: issue.cleaner_name,
  };
}

async function applyCharge(
  supabase: SB,
  booking: Record<string, unknown>,
  opts: {
    deltaCents: number;
    path: SiteFindingPricingPath;
    findingType: SiteFindingType;
    location: string;
    ruleLabel: string;
    cleanerId: string | null;
    issueId: string;
  },
): Promise<{ chargeStatus: string; addonChargeId: string | null; paymentIntentId: string | null }> {
  const originalTotalCents = bookingTotalCents(booking);
  const newTotalCents = originalTotalCents + Math.max(0, opts.deltaCents);
  const copy = FINDING_COPY[opts.findingType];
  const noteLine =
    `${copy.short} at ${opts.location}: ${opts.ruleLabel} ` +
    `(${centsMoney(opts.deltaCents)}). QC ${opts.issueId}.`;

  const patch: Record<string, unknown> = {
    total_estimate_cents: Math.max(0, Number(booking.total_estimate_cents || 0) + Math.max(0, opts.deltaCents)),
    team_notes: [String(booking.team_notes || ""), noteLine].filter(Boolean).join("\n"),
  };
  if (booking.final_charge_cents != null || opts.deltaCents > 0) {
    patch.final_charge_cents = newTotalCents;
  }
  if (opts.path === "heavy_condition") {
    patch.condition_level = "heavy";
  }

  if (opts.deltaCents > 0) {
    await supabase.from("bookings").update(patch).eq("id", booking.id);
    booking.total_estimate_cents = patch.total_estimate_cents;
    if (patch.final_charge_cents != null) booking.final_charge_cents = patch.final_charge_cents;
    if (patch.condition_level) booking.condition_level = "heavy";
    booking.team_notes = patch.team_notes;
  } else if (opts.path === "heavy_condition") {
    // Record the Heavy classification even when it doesn't move the dollar amount.
    await supabase.from("bookings").update({
      condition_level: "heavy",
      team_notes: patch.team_notes,
    }).eq("id", booking.id);
    booking.condition_level = "heavy";
    booking.team_notes = patch.team_notes;
  }

  if (opts.deltaCents <= 0) {
    return { chargeStatus: "no_charge", addonChargeId: null, paymentIntentId: null };
  }

  const addedId = opts.findingType === "pest_light" ? "site_finding_pest_light" : "site_finding_mold_minor";
  const { data: auditRow } = await supabase.from("booking_addon_charges").insert({
    booking_id: booking.id,
    added_addons: [addedId],
    removed_addons: [],
    amount_cents: opts.deltaCents,
    status: "pending",
    created_by: opts.cleanerId,
    note: noteLine,
  }).select("id").single();
  const auditId = auditRow?.id || null;

  const stripeKey = await resolveSecret(supabase, "STRIPE_SECRET_KEY");
  if (!stripeKey) {
    if (auditId) await supabase.from("booking_addon_charges").update({ status: "failed" }).eq("id", auditId);
    return { chargeStatus: "failed", addonChargeId: auditId, paymentIntentId: null };
  }

  try {
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    let customerId: string | null = null;
    if (booking.customer_id && String(booking.customer_id).startsWith("cus_")) {
      customerId = String(booking.customer_id);
    }
    if (!customerId && booking.email) {
      const { data: custRow } = await supabase
        .from("customers")
        .select("stripe_customer_id")
        .eq("email", booking.email)
        .maybeSingle();
      if (custRow?.stripe_customer_id?.startsWith("cus_")) customerId = custRow.stripe_customer_id;
    }
    if (!customerId && booking.email) {
      const found = await stripe.customers.list({ email: String(booking.email), limit: 1 });
      customerId = found.data[0]?.id ?? null;
      if (!customerId) {
        const created = await stripe.customers.create({
          email: String(booking.email),
          name: `${booking.first_name || ""} ${booking.last_name || ""}`.trim() || undefined,
        });
        customerId = created.id;
      }
    }
    if (!customerId) {
      if (auditId) await supabase.from("booking_addon_charges").update({ status: "failed" }).eq("id", auditId);
      return { chargeStatus: "failed", addonChargeId: auditId, paymentIntentId: null };
    }

    const pmId = await resolveOffSessionPaymentMethod(stripe, customerId).catch(() => null);
    if (pmId) {
      const pi = await stripe.paymentIntents.create({
        amount: opts.deltaCents,
        currency: "usd",
        customer: customerId,
        payment_method: pmId,
        off_session: true,
        confirm: true,
        description: `${bookingRefOf(booking)} - ${copy.short} (${opts.location})`,
        metadata: {
          booking_id: String(booking.id),
          chargeType: "site_finding",
          finding_type: opts.findingType,
          qc_issue_id: opts.issueId,
        },
      });
      if (pi.status === "succeeded") {
        if (auditId) {
          await supabase.from("booking_addon_charges")
            .update({ status: "paid", stripe_payment_intent_id: pi.id })
            .eq("id", auditId);
        }
        await supabase.from("bookings").update({ customer_id: customerId }).eq("id", booking.id);
        return { chargeStatus: "paid", addonChargeId: auditId, paymentIntentId: pi.id };
      }
    }
    if (auditId) await supabase.from("booking_addon_charges").update({ status: "failed" }).eq("id", auditId);
    await supabase.from("bookings").update({ customer_id: customerId }).eq("id", booking.id);
    return { chargeStatus: "failed", addonChargeId: auditId, paymentIntentId: null };
  } catch (e) {
    console.warn("[site-finding] off-session charge failed", e instanceof Error ? e.message : String(e));
    if (auditId) await supabase.from("booking_addon_charges").update({ status: "failed" }).eq("id", auditId);
    return { chargeStatus: "failed", addonChargeId: auditId, paymentIntentId: null };
  }
}

async function notifyCustomer(
  supabase: SB,
  booking: Record<string, unknown>,
  details: SiteFindingDetails,
): Promise<void> {
  const templates = await loadNoticeTemplates(supabase);
  const copy = FINDING_COPY[details.finding_type];
  const priced = (details.price_delta_cents || 0) > 0;
  const name = String(booking.first_name || "").trim() || "there";
  const location = details.location;
  const delta = centsMoney(details.price_delta_cents || 0);
  const newTotal = centsMoney(details.new_total_cents ?? details.original_total_cents);
  const adjustment = details.pricing_path === "focused_addon"
    ? `${delta} Focused Clean add-on`
    : "Heavy condition";
  const recurrence = details.finding_type === "mold_minor" && details.recurrence
    ? templates.mold_recurrence_sentence
    : "";
  const vars = {
    name,
    finding: copy.email,
    finding_sms: copy.sms,
    location,
    adjustment,
    delta,
    new_total: newTotal,
    recurrence,
  };

  const emailVars = {
    name: escapeHtml(name),
    finding: escapeHtml(copy.email),
    finding_sms: escapeHtml(copy.sms),
    location: escapeHtml(location),
    adjustment: escapeHtml(adjustment),
    delta: escapeHtml(delta),
    new_total: escapeHtml(newTotal),
    recurrence: escapeHtml(recurrence),
  };
  const emailBody = interpolate(priced ? templates.email_body_priced : templates.email_body_info, emailVars);
  const smsBody = interpolate(priced ? templates.sms_priced : templates.sms_info, vars);
  const subject = interpolate(templates.email_subject, vars);
  const email = String(booking.email || "").trim().toLowerCase();

  if (email && email.includes("@")) {
    await supabase.functions.invoke("send-addon-email", {
      body: {
        type: priced ? "site_finding_priced" : "site_finding_info",
        email,
        skipBillingCc: !priced,
        data: {
          name,
          subject,
          bodyText: emailBody,
          finding: copy.email,
          location,
          amount: centsMoney(details.new_total_cents ?? details.original_total_cents),
          originalAmount: centsMoney(details.original_total_cents),
          serviceLabel: details.pricing_rule_label,
          bookingRef: bookingRefOf(booking),
          serviceDate: booking.service_date || "",
          serviceAddress: [booking.address, booking.city, booking.state, booking.zip_code].filter(Boolean).join(", "),
          photoCount: (details.before_photo_urls?.length || 0) + (details.after_photo_urls?.length || 0),
          recurrenceNote: recurrence.trim() || undefined,
        },
      },
    }).then(() => undefined, () => undefined);
  }

  const phone = String(booking.phone || "").trim();
  if (phone) {
    try {
      await supabase.functions.invoke("send-ghl-sms", {
        body: {
          phone,
          email: booking.email || undefined,
          firstName: booking.first_name || undefined,
          message: smsBody,
          type: "addon_update",
        },
      });
    } catch (e) {
      console.warn("[site-finding] SMS failed", e instanceof Error ? e.message : String(e));
    }
  }
}

export async function completeSiteFinding(
  supabase: SB,
  opts: {
    booking: Record<string, unknown>;
    issueId: string;
    afterPhotoUrl: string;
    cleanerId: string | null;
    cleanerName: string;
  },
): Promise<SiteFindingIssue> {
  const { data: row } = await supabase
    .from("qc_issues")
    .select("id, issue_number, booking_id, title, description, details, created_at, cleaner_name")
    .eq("id", opts.issueId)
    .eq("booking_id", opts.booking.id)
    .eq("issue_type", "site_finding")
    .maybeSingle();
  if (!row) throw new Error("Site finding not found on this job.");
  const details = parseFindingDetails(row.details);
  if (!details) throw new Error("Site finding record is missing structured details.");

  const after = uniqueUrls([...details.after_photo_urls, opts.afterPhotoUrl]);
  details.after_photo_urls = after;

  if (details.before_photo_urls.length === 0) {
    throw new Error("A before photo is required before this finding can be priced.");
  }
  if (after.length === 0) {
    throw new Error("An after photo is required before this finding can be priced.");
  }

  await mergeFindingPhotosOntoBooking(supabase, opts.booking, details.before_photo_urls, after);

  const alreadyPriced = details.status === "priced" || details.status === "notified";
  if (alreadyPriced) {
    const description = buildQcDescription(details, { cleanerName: opts.cleanerName, at: new Date().toISOString() });
    await supabase.from("qc_issues").update({
      details,
      description,
      resolution_photos: after,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    await supabase.from("qc_issue_events").insert({
      issue_id: row.id,
      action: "note",
      note: "Additional after photo attached to site finding.",
      actor_name: opts.cleanerName,
      data: { after_photo: opts.afterPhotoUrl },
    });
    return { ...row, details, description };
  }

  const preview = await previewSiteFindingPrice(supabase, opts.booking, {
    confined: details.confined,
    areaId: details.area_id,
  });

  const charge = await applyCharge(supabase, opts.booking, {
    deltaCents: preview.deltaCents,
    path: preview.path,
    findingType: details.finding_type,
    location: details.location,
    ruleLabel: preview.ruleLabel,
    cleanerId: opts.cleanerId,
    issueId: row.id,
  });

  const nowIso = new Date().toISOString();
  details.pricing_path = preview.path;
  details.pricing_rule_label = preview.ruleLabel;
  details.preview_delta_cents = preview.deltaCents;
  details.price_delta_cents = preview.deltaCents;
  details.original_total_cents = preview.originalTotalCents;
  details.new_total_cents = preview.newTotalCents;
  details.status = "priced";
  details.priced_at = nowIso;
  details.charge_status = charge.chargeStatus;
  details.addon_charge_id = charge.addonChargeId;

  const description = buildQcDescription(details, { cleanerName: opts.cleanerName, at: nowIso });
  await supabase.from("qc_issues").update({
    details,
    description,
    title: `${FINDING_COPY[details.finding_type].short} in ${details.location}`,
    resolution_photos: after,
    updated_at: nowIso,
  }).eq("id", row.id);

  await supabase.from("qc_issue_events").insert({
    issue_id: row.id,
    action: "updated",
    note: description,
    actor_name: opts.cleanerName,
    data: {
      priced: true,
      pricing_path: preview.path,
      price_delta_cents: preview.deltaCents,
      charge_status: charge.chargeStatus,
      after_photo: opts.afterPhotoUrl,
    },
  });

  await notifyCustomer(supabase, opts.booking, details);
  details.status = "notified";
  details.notified_at = new Date().toISOString();
  await supabase.from("qc_issues").update({
    details,
    updated_at: details.notified_at,
  }).eq("id", row.id);

  await supabase.from("events").insert({
    event_type: preview.deltaCents > 0 ? "booking.site_finding_priced" : "booking.site_finding_noted",
    booking_id: opts.booking.id,
    job_id: opts.booking.job_id || null,
    cleaner_id: opts.cleanerId,
    source: "site-finding",
    summary:
      `${bookingRefOf(opts.booking)} — ${FINDING_COPY[details.finding_type].short} in ${details.location} ` +
      (preview.deltaCents > 0
        ? `priced ${centsMoney(preview.deltaCents)} via ${preview.path} (charge ${charge.chargeStatus}).`
        : "logged with no price change — informational customer notice sent."),
    data: {
      issue_id: row.id,
      finding_type: details.finding_type,
      pricing_path: preview.path,
      price_delta_cents: preview.deltaCents,
      charge_status: charge.chargeStatus,
      payment_intent_id: charge.paymentIntentId,
    },
  }).then(() => undefined, () => undefined);

  return {
    id: row.id,
    issue_number: row.issue_number ?? null,
    booking_id: row.booking_id,
    title: row.title,
    description,
    details,
    created_at: row.created_at,
    cleaner_name: row.cleaner_name,
  };
}

export { stopFieldReportText };

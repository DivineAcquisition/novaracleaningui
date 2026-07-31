// ─── Focused / Single-Area Clean + Same-Day Service ───────────────────────
//
// Focused cleans price per area (not sqft). Same-day is a $50 upcharge with
// a daily cutoff and an explicit disclosure acknowledgment. Rates live in
// app_settings under FOCUSED_SAME_DAY_SETTINGS_KEY so ops can tune them
// without a deploy; these defaults ship with the code as the fallback.

export const FOCUSED_SAME_DAY_SETTINGS_KEY = "focused_same_day_settings";

export type FocusedAreaId = "bathroom" | "kitchen" | "living" | "other" | "bedroom";
export type FocusedCondition = "light" | "normal" | "heavy" | "severe";

export interface FocusedAreaDef {
  id: FocusedAreaId;
  label: string;
  /** Whole-dollar flat rate. Bedroom stacks per quantity. */
  price: number;
  /** When true, the booking UI lets the customer pick a quantity. */
  quantity: boolean;
}

export interface FocusedAreaSelection {
  areaId: FocusedAreaId | string;
  quantity: number;
}

export interface FocusedSameDaySettings {
  areas: FocusedAreaDef[];
  /** Floor for any focused clean, whole dollars. */
  minimum_dollars: number;
  /** Optional multi-area bundle discount percent (0–100). Default 0. */
  multi_area_bundle_discount_percent: number;
  /** Condition multipliers applied to the focused area total. */
  condition_multipliers: Record<FocusedCondition, number>;
  same_day_upcharge_dollars: number;
  /** Local time "HH:mm" in timezone below — past this, same-day is not offered. */
  same_day_cutoff: string;
  timezone: string;
  /** Minutes from payment until auto-cancel + refund if unassigned. */
  sourcing_deadline_minutes: number;
  /** Whether the $50 upcharge is included in cleaner pay basis. */
  same_day_upcharge_in_pay_basis: boolean;
  disclosure_title: string;
  disclosure_body: string;
}

export const FOCUSED_SAME_DAY_DEFAULTS: FocusedSameDaySettings = {
  areas: [
    { id: "bathroom", label: "Bathroom", price: 65, quantity: false },
    { id: "kitchen", label: "Kitchen", price: 65, quantity: false },
    { id: "living", label: "Living / common area", price: 65, quantity: false },
    { id: "other", label: "Other single area", price: 65, quantity: false },
    { id: "bedroom", label: "Bedroom", price: 50, quantity: true },
  ],
  minimum_dollars: 65,
  multi_area_bundle_discount_percent: 0,
  condition_multipliers: { light: 0.9, normal: 1.0, heavy: 1.25, severe: 1.5 },
  same_day_upcharge_dollars: 50,
  same_day_cutoff: "14:00",
  timezone: "America/New_York",
  sourcing_deadline_minutes: 120,
  same_day_upcharge_in_pay_basis: true,
  disclosure_title: "Same-Day Service — Please Read",
  disclosure_body:
    "Same-day cleans depend on cleaner availability and are **not guaranteed**. We'll do everything we can to staff your clean today. If we're unable to assign a cleaner, your booking will be canceled and you'll receive a **full refund — including the same-day fee — automatically**. Nothing is required from you.",
};

export function mergeFocusedSameDaySettings(
  raw: Partial<FocusedSameDaySettings> | null | undefined,
): FocusedSameDaySettings {
  if (!raw || typeof raw !== "object") return FOCUSED_SAME_DAY_DEFAULTS;
  const areas = Array.isArray(raw.areas) && raw.areas.length > 0
    ? raw.areas.map((a) => ({
        id: a.id,
        label: a.label || a.id,
        price: Number(a.price) || 0,
        quantity: Boolean(a.quantity),
      }))
    : FOCUSED_SAME_DAY_DEFAULTS.areas;
  return {
    ...FOCUSED_SAME_DAY_DEFAULTS,
    ...raw,
    areas,
    condition_multipliers: {
      ...FOCUSED_SAME_DAY_DEFAULTS.condition_multipliers,
      ...(raw.condition_multipliers || {}),
    },
  };
}

export function areaDef(
  settings: FocusedSameDaySettings,
  areaId: string,
): FocusedAreaDef | undefined {
  return settings.areas.find((a) => a.id === areaId);
}

/** Stacked area subtotal before condition / minimum / same-day. Whole dollars. */
export function focusedAreasSubtotal(
  selections: FocusedAreaSelection[],
  settings: FocusedSameDaySettings = FOCUSED_SAME_DAY_DEFAULTS,
): number {
  let sum = 0;
  for (const sel of selections) {
    const def = areaDef(settings, sel.areaId);
    if (!def) continue;
    const qty = Math.max(1, Math.floor(Number(sel.quantity) || 1));
    sum += def.price * (def.quantity ? qty : 1);
  }
  const discountPct = Math.max(0, Math.min(100, Number(settings.multi_area_bundle_discount_percent) || 0));
  if (discountPct > 0 && selections.length > 1) {
    sum = Math.round(sum * (1 - discountPct / 100));
  }
  return sum;
}

export interface FocusedPriceResult {
  areasSubtotal: number;
  conditionMultiplier: number;
  afterCondition: number;
  minimumApplied: boolean;
  serviceTotal: number;
  sameDayUpcharge: number;
  total: number;
  /** Focused always pays in full — deposit equals total. */
  deposit: number;
  balanceDue: number;
  hours: number;
}

export function calculateFocusedPrice(
  selections: FocusedAreaSelection[],
  condition: FocusedCondition = "normal",
  sameDay = false,
  settings: FocusedSameDaySettings = FOCUSED_SAME_DAY_DEFAULTS,
): FocusedPriceResult {
  const areasSubtotal = focusedAreasSubtotal(selections, settings);
  const conditionMultiplier = settings.condition_multipliers[condition] ?? 1;
  const afterCondition = Math.round(areasSubtotal * conditionMultiplier);
  const minimumApplied = afterCondition > 0 && afterCondition < settings.minimum_dollars;
  const serviceTotal = afterCondition === 0
    ? 0
    : Math.max(settings.minimum_dollars, afterCondition);
  const sameDayUpcharge = sameDay && serviceTotal > 0 ? settings.same_day_upcharge_dollars : 0;
  const total = serviceTotal + sameDayUpcharge;
  // Spec clarification: only focused is paid in full — deposit = total.
  return {
    areasSubtotal,
    conditionMultiplier,
    afterCondition,
    minimumApplied,
    serviceTotal,
    sameDayUpcharge,
    total,
    deposit: total,
    balanceDue: 0,
    // Rough labor estimate: ~45 min per area unit.
    hours: Math.max(0.75, selections.reduce((n, s) => {
      const def = areaDef(settings, s.areaId);
      const qty = def?.quantity ? Math.max(1, Math.floor(Number(s.quantity) || 1)) : 1;
      return n + (def ? qty * 0.75 : 0);
    }, 0) * conditionMultiplier),
  };
}

/** Same-day upcharge on a non-focused booking (standard/deep/etc). */
export function withSameDayUpcharge(
  baseTotal: number,
  sameDay: boolean,
  settings: FocusedSameDaySettings = FOCUSED_SAME_DAY_DEFAULTS,
): { total: number; sameDayUpcharge: number; deposit: number; balanceDue: number } {
  const sameDayUpcharge = sameDay && baseTotal > 0 ? settings.same_day_upcharge_dollars : 0;
  const total = Math.max(0, baseTotal) + sameDayUpcharge;
  // Same-day keeps normal 50% deposit rules (focused is the only pay-in-full type).
  const deposit = Math.round(total * 0.5 * 100) / 100;
  return { total, sameDayUpcharge, deposit, balanceDue: Math.max(0, total - deposit) };
}

/** Is same-day still offerable right now, given cutoff + timezone? */
export function isSameDayAvailableNow(
  settings: FocusedSameDaySettings = FOCUSED_SAME_DAY_DEFAULTS,
  now: Date = new Date(),
): boolean {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: settings.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value || "0");
    const minute = Number(parts.find((p) => p.type === "minute")?.value || "0");
    const [cutH, cutM] = settings.same_day_cutoff.split(":").map((n) => Number(n));
    const nowMins = hour * 60 + minute;
    const cutMins = (Number.isFinite(cutH) ? cutH : 14) * 60 + (Number.isFinite(cutM) ? cutM : 0);
    return nowMins < cutMins;
  } catch {
    return false;
  }
}

/** Calendar date string (YYYY-MM-DD) in the ops timezone. */
export function todayInTimezone(
  settings: FocusedSameDaySettings = FOCUSED_SAME_DAY_DEFAULTS,
  now: Date = new Date(),
): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: settings.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function isServiceDateToday(
  serviceDate: string,
  settings: FocusedSameDaySettings = FOCUSED_SAME_DAY_DEFAULTS,
  now: Date = new Date(),
): boolean {
  return Boolean(serviceDate) && serviceDate === todayInTimezone(settings, now);
}

export function formatFocusedAreasLabel(
  selections: FocusedAreaSelection[],
  settings: FocusedSameDaySettings = FOCUSED_SAME_DAY_DEFAULTS,
): string {
  return selections
    .map((s) => {
      const def = areaDef(settings, s.areaId);
      if (!def) return null;
      const qty = def.quantity ? Math.max(1, Math.floor(Number(s.quantity) || 1)) : 1;
      return qty > 1 ? `${qty}× ${def.label}` : def.label;
    })
    .filter(Boolean)
    .join(", ");
}

/** Build contractor checklist sections from the selected areas only. */
export function focusedChecklistSections(
  selections: FocusedAreaSelection[],
  settings: FocusedSameDaySettings = FOCUSED_SAME_DAY_DEFAULTS,
): Array<{ title: string; items: string[] }> {
  const AREA_ITEMS: Record<string, string[]> = {
    bathroom: [
      "Clean and disinfect toilet (inside, outside, base)",
      "Scrub shower / tub and rinse soap scum",
      "Clean sink, faucet, and counter",
      "Wipe mirrors and chrome fixtures",
      "Sweep / mop floor; empty trash",
      "Take BEFORE and AFTER photos of the bathroom",
    ],
    kitchen: [
      "Clean countertops and backsplash",
      "Wipe exterior of appliances",
      "Clean sink and faucet",
      "Wipe cabinet fronts and handles",
      "Sweep / mop floor; empty trash",
      "Take BEFORE and AFTER photos of the kitchen",
    ],
    living: [
      "Dust surfaces, shelves, and electronics",
      "Vacuum / mop floors and rugs",
      "Wipe light switches and door handles",
      "Tidy and straighten common-area furniture",
      "Take BEFORE and AFTER photos of the living / common area",
    ],
    other: [
      "Dust and wipe all surfaces in the selected area",
      "Vacuum / mop the floor",
      "Empty trash if present",
      "Take BEFORE and AFTER photos of the area",
    ],
    bedroom: [
      "Dust surfaces and nightstands",
      "Vacuum / mop floor",
      "Make bed if linens are ready (or tidy bedding)",
      "Wipe light switches and door handles",
      "Take BEFORE and AFTER photos of the bedroom",
    ],
  };

  const sections: Array<{ title: string; items: string[] }> = [];
  for (const sel of selections) {
    const def = areaDef(settings, sel.areaId);
    if (!def) continue;
    const qty = def.quantity ? Math.max(1, Math.floor(Number(sel.quantity) || 1)) : 1;
    const items = AREA_ITEMS[sel.areaId] || AREA_ITEMS.other;
    for (let i = 1; i <= qty; i++) {
      const title = qty > 1 ? `${def.label} ${i}` : def.label;
      sections.push({ title, items: [...items] });
    }
  }
  if (sections.length === 0) {
    sections.push({
      title: "Focused clean",
      items: ["Clean the selected areas only", "Take BEFORE and AFTER photos"],
    });
  }
  sections.push({
    title: "Close-out",
    items: [
      "Confirm only the selected areas were cleaned (do not expand scope)",
      "Report any damage or blocked access before leaving",
      "Lock up / leave as instructed",
    ],
  });
  return sections;
}

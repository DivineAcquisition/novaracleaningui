// ─── Internal booker: extras catalog + quote lines ───────────────────────
//
// Pure helpers behind the VA booking picker and live-quote rail. They never
// price anything themselves: amounts come from the authoritative dynamic
// QuoteBreakdown (the same engine book-as-va charges) when it is available,
// and from the legacy calculator's rules (chargeableAddOnIds) only on the
// fallback path. Display, the copyable summary and tests all read from here
// so the picker, the rail and the saved quote can't drift apart.
//
// The data model stores selected add-on IDs only (no quantities), through
// va_quotes.add_ons, bookings.add_ons and invoices. Quantity controls are
// therefore NOT offered; laundry shows its per-load unit and prices one load.

import {
  ADD_ONS,
  FIRST_CLEAN_DEEP_ID,
  OPS_ONLY_ADD_ON_IDS,
  chargeableAddOnIds,
  type AddOnId,
} from "@/lib/pricing";
import type { QuoteBreakdown } from "@/lib/dynamic-pricing";

export type ExtrasGroupId = "kitchen" | "laundry" | "detail" | "spaces";

export const EXTRAS_GROUPS: { id: ExtrasGroupId; label: string }[] = [
  { id: "kitchen", label: "Kitchen" },
  { id: "laundry", label: "Laundry & linens" },
  { id: "detail", label: "Detail cleaning" },
  { id: "spaces", label: "Additional spaces" },
];

const GROUP_OF: Partial<Record<AddOnId, ExtrasGroupId>> = {
  fridge: "kitchen",
  oven: "kitchen",
  microwave: "kitchen",
  dishwasher: "kitchen",
  dishes: "kitchen",
  cabinets: "kitchen",
  cateringEvent: "kitchen",
  laundry: "laundry",
  changeLinens: "laundry",
  windows: "detail",
  baseboards: "detail",
  blinds: "detail",
  walls: "detail",
  ceilingFans: "detail",
  petHair: "detail",
  deepBathroomDetail: "detail",
  closets: "detail",
  garage: "spaces",
  basement: "spaces",
  patio: "spaces",
  trashHaul: "spaces",
};

/** Unit shown next to the price. Only units the engine really prices by. */
const UNIT_OF: Partial<Record<AddOnId, string>> = {
  laundry: "per load",
  windows: "per visit",
  deepBathroomDetail: "per bathroom",
  ceilingFans: "per home",
  baseboards: "whole home",
};

/** Extras that are free with Move-In/Out. Mirrors move_in_out_free_add_ons. */
export const MOVE_IN_OUT_INCLUDED: ReadonlySet<string> = new Set(["fridge", "oven"]);

export interface ExtraOption {
  id: AddOnId;
  label: string;
  group: ExtrasGroupId;
  listCents: number;
  unit?: string;
  note?: string;
}

/**
 * Per-visit extras a VA may pick. Excludes the Glow first-visit deep clean
 * (its own decision) and ops-only site findings (pest / mold), which belong to
 * the authorized scope-adjustment workflow on the job.
 */
export const EXTRA_OPTIONS: ExtraOption[] = (Object.keys(ADD_ONS) as AddOnId[])
  .filter((id) => id !== FIRST_CLEAN_DEEP_ID && !OPS_ONLY_ADD_ON_IDS.has(id) && GROUP_OF[id])
  .map((id) => ({
    id,
    label: ADD_ONS[id].label,
    group: GROUP_OF[id]!,
    listCents: ADD_ONS[id].price * 100,
    unit: UNIT_OF[id],
    note: ADD_ONS[id].note || undefined,
  }));

export function addOnLabel(id: string): string {
  return (ADD_ONS as Record<string, { label: string }>)[id]?.label || id;
}

export type Applicability =
  | { kind: "charged"; cents: number }
  | { kind: "included"; reason: string }
  | { kind: "not_applied"; reason: string };

/** What an extra will actually do on this service, shown before selection. */
export function extraApplicability(id: string, serviceType: string): Applicability {
  if (serviceType === "moveInOut" && MOVE_IN_OUT_INCLUDED.has(id)) {
    return { kind: "included", reason: "Included on Move-In/Out" };
  }
  const def = (ADD_ONS as Record<string, { price: number }>)[id];
  if (!def) return { kind: "not_applied", reason: "Not in the catalog" };
  return { kind: "charged", cents: def.price * 100 };
}

/**
 * Add-ons for each recurring visit. The first-visit deep clean is decided by
 * the Glow prompt, never by a per-visit add-on, so a legacy or reopened quote
 * carrying it can't charge it on every visit (or twice on the first).
 */
export function perVisitAddOns(addOns: string[]): string[] {
  return (addOns || []).filter((id) => id !== FIRST_CLEAN_DEEP_ID);
}

export interface QuoteLine {
  key: string;
  label: string;
  cents: number;
  detail?: string;
}

export interface QuoteLines {
  source: "engine" | "fallback";
  service: QuoteLine;
  charged: QuoteLine[];
  chargedCents: number;
  included: QuoteLine[];
  surcharges: QuoteLine[];
  surchargesCents: number;
  adjustments: QuoteLine[];
  adjustmentsCents: number;
  /** Selected IDs the active engine does not price (shown, never silently dropped). */
  unpriced: QuoteLine[];
}

/**
 * Separate the quote into service, charged add-ons, included items,
 * surcharges and adjustments. With an engine breakdown, every amount comes
 * from its lines; the fallback mirrors the legacy calculator's rules.
 */
export function deriveQuoteLines(args: {
  breakdown: QuoteBreakdown | null | undefined;
  addOns: string[];
  serviceType: string;
  serviceLabel: string;
  fallbackServiceCents: number;
}): QuoteLines {
  const { breakdown, addOns, serviceType, serviceLabel, fallbackServiceCents } = args;
  const ids = [...new Set((addOns || []).filter(Boolean))];

  if (breakdown?.ok) {
    const charged: QuoteLine[] = [];
    const included: QuoteLine[] = [];
    const surcharges: QuoteLine[] = [];
    const adjustments: QuoteLine[] = [];
    const seen = new Set<string>();
    for (const line of breakdown.lines) {
      if (line.key.startsWith("addon_")) {
        const id = line.key.slice("addon_".length);
        seen.add(id);
        if (line.kind === "info" || line.amountCents === 0) {
          included.push({ key: id, label: addOnLabel(id), cents: 0, detail: line.reason });
        } else {
          charged.push({ key: id, label: addOnLabel(id), cents: line.amountCents, detail: UNIT_OF[id as AddOnId] });
        }
      } else if (line.kind === "surcharge") {
        surcharges.push({ key: line.key, label: line.label, cents: line.amountCents, detail: line.reason });
      } else if (line.kind === "clamp" || line.kind === "minimum") {
        // Service floor/ceiling clamps are already inside serviceTotalCents;
        // only the zone minimum sits on top of the job.
        if (line.kind === "minimum") {
          adjustments.push({ key: line.key, label: line.label, cents: line.amountCents, detail: line.reason });
        }
      }
    }
    const unpriced = ids
      .filter((id) => !seen.has(id))
      .map((id) => ({ key: id, label: addOnLabel(id), cents: 0, detail: "Not priced by the current pricing engine" }));
    const chargedCents = charged.reduce((s, l) => s + l.cents, 0);
    const surchargesCents = surcharges.reduce((s, l) => s + l.cents, 0);
    const adjustmentsCents = adjustments.reduce((s, l) => s + l.cents, 0);
    return {
      source: "engine",
      service: { key: "service", label: serviceLabel, cents: breakdown.serviceTotalCents },
      charged,
      chargedCents,
      included,
      surcharges,
      surchargesCents,
      adjustments,
      adjustmentsCents,
      unpriced,
    };
  }

  // Fallback: the legacy calculator's rules.
  const chargeable = new Set(chargeableAddOnIds(ids, serviceType));
  const charged: QuoteLine[] = [];
  const included: QuoteLine[] = [];
  for (const id of ids) {
    const def = (ADD_ONS as Record<string, { price: number }>)[id];
    if (!def) continue;
    if (chargeable.has(id)) {
      charged.push({ key: id, label: addOnLabel(id), cents: def.price * 100, detail: UNIT_OF[id as AddOnId] });
    } else {
      included.push({
        key: id,
        label: addOnLabel(id),
        cents: 0,
        detail: serviceType === "moveInOut" ? "Included on Move-In/Out" : "Already part of this service",
      });
    }
  }
  return {
    source: "fallback",
    service: { key: "service", label: serviceLabel, cents: fallbackServiceCents },
    charged,
    chargedCents: charged.reduce((s, l) => s + l.cents, 0),
    included,
    surcharges: [],
    surchargesCents: 0,
    adjustments: [],
    adjustmentsCents: 0,
    unpriced: [],
  };
}

export interface RecurringTotals {
  firstVisitCents: number;
  laterVisitsCents: number;
  firstVisitDeepCents: number;
  cadenceLabel: string;
}

/**
 * First visit = one per-visit price + the Glow first-visit deep fee (once).
 * Later visits = the per-visit price. The deep fee is never also counted as a
 * per-visit add-on (see perVisitAddOns).
 */
export function recurringTotals(args: {
  perVisitCents: number;
  includeFirstVisitDeep: boolean;
  firstVisitDeepCents: number;
  cadenceLabel: string;
}): RecurringTotals {
  const deep = args.includeFirstVisitDeep ? args.firstVisitDeepCents : 0;
  return {
    firstVisitCents: args.perVisitCents + deep,
    laterVisitsCents: args.perVisitCents,
    firstVisitDeepCents: deep,
    cadenceLabel: args.cadenceLabel,
  };
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Plain-text quote a VA can paste into an email or SMS. Built only from the
 * calculated lines — nothing re-priced here.
 */
export function quoteSummaryText(args: {
  customerName?: string;
  lines: QuoteLines;
  oneTime?: { totalCents: number; dueTodayCents: number; remainingCents: number };
  recurring?: RecurringTotals;
  serviceDateLabel?: string;
  lockedUntilLabel?: string;
}): string {
  const { lines, oneTime, recurring } = args;
  const out: string[] = [];
  out.push(`Novara Cleaning quote${args.customerName ? ` for ${args.customerName}` : ""}`);
  if (args.serviceDateLabel) out.push(`Date: ${args.serviceDateLabel}`);
  out.push("");
  out.push(`${lines.service.label}: ${money(lines.service.cents)}`);
  for (const l of lines.charged) out.push(`+ ${l.label}${l.detail ? ` (${l.detail})` : ""}: ${money(l.cents)}`);
  for (const l of lines.surcharges) out.push(`+ ${l.label}: ${money(l.cents)}`);
  for (const l of lines.adjustments) out.push(`+ ${l.label}: ${money(l.cents)}`);
  if (lines.included.length) out.push(`Included at no charge: ${lines.included.map((l) => l.label).join(", ")}`);
  out.push("");
  if (recurring) {
    out.push(`First visit: ${money(recurring.firstVisitCents)}${recurring.firstVisitDeepCents ? ` (includes ${money(recurring.firstVisitDeepCents)} first-visit deep clean)` : ""}`);
    out.push(`Later visits: ${money(recurring.laterVisitsCents)} each, ${recurring.cadenceLabel.toLowerCase()}`);
  } else if (oneTime) {
    out.push(`Total: ${money(oneTime.totalCents)}`);
    out.push(`Due today: ${money(oneTime.dueTodayCents)}`);
    out.push(`Remaining balance: ${money(oneTime.remainingCents)}`);
  }
  if (args.lockedUntilLabel) out.push(`Price held until ${args.lockedUntilLabel}.`);
  return out.join("\n");
}

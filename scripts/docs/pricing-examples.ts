// ─── Worked pricing examples for the admin workspace guides ────────────────
//
// The guides published at docs.novaracleaning.com quote real dollar figures.
// Those figures are NOT typed by hand: this script loads the live pricing
// configuration snapshot (docs/admin-workspace/_data/pricing-snapshot.json,
// read straight out of the Supabase project) and runs it through the SAME
// engine that prices a real quote — src/lib/dynamic-pricing.ts, which is kept
// byte-identical to the Deno copy the edge functions use.
//
// Output goes to docs/admin-workspace/_data/pricing-examples.generated.json,
// which the guides render from. So a figure in a guide can only be wrong if
// the engine itself is wrong.
//
// Run:  npm run docs:pricing
//
// It also applies the same overlay the server does at load time
// (app_settings.focused_same_day_settings wins over the config fallback for
// focused rates, the focused minimum, the bundle discount and the same-day
// fee) and reads the floor's pay percentages from the live cleaner_pay_rates
// rows rather than the engine's hardcoded fallback.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  computeFloorCents,
  computeQuote,
  type ConditionLevel,
  type DemandResolution,
  type DynamicPricingConfig,
  type DynamicServiceType,
  type FloorPayRates,
  type MembershipPlanId,
  type QuoteInput,
  type ZoneInfo,
} from "../../src/lib/dynamic-pricing";

const ROOT = resolve(__dirname, "../..");
const SNAPSHOT = resolve(ROOT, "docs/admin-workspace/_data/pricing-snapshot.json");
const OUT = resolve(ROOT, "docs/admin-workspace/_data/pricing-examples.generated.json");

interface Snapshot {
  captured_at: string;
  project_ref: string;
  config_version: number;
  config: DynamicPricingConfig;
  zones: ZoneInfo[];
  cleaner_pay_rates: Array<{
    pay_tier: string;
    rate_percent: number;
    min_crew_size: number;
    max_crew_size: number | null;
  }>;
  focused_same_day_settings: Record<string, unknown>;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Mirror of overlayFocusedSameDaySettings() in
 * supabase/functions/_shared/dynamic-quote.ts. Focused rates, the focused
 * minimum, the bundle discount and the same-day fee live in app_settings —
 * the config row only holds a fallback — so a guide that quoted the config
 * copy could be quoting a number nothing actually charges.
 */
function applyFocusedSameDayOverlay(
  config: DynamicPricingConfig,
  settings: Record<string, unknown>,
): { applied: boolean; changed: string[] } {
  const changed: string[] = [];
  if (!settings || typeof settings !== "object") return { applied: false, changed };

  const toCents = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  };

  const areas = Array.isArray(settings.areas) ? settings.areas : [];
  if (areas.length > 0) {
    const before = JSON.stringify(config.focused_clean.areas);
    config.focused_clean.areas = areas
      .map((a) => {
        const row = a as Record<string, unknown>;
        const cents = toCents(row.price);
        if (!row.id || cents == null) return null;
        return {
          id: String(row.id),
          label: String(row.label || row.id),
          price_cents: cents,
          quantity: Boolean(row.quantity),
        };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);
    if (JSON.stringify(config.focused_clean.areas) !== before) changed.push("focused areas");
  }

  const minimum = toCents(settings.minimum_dollars);
  if (minimum != null && minimum !== config.focused_clean.minimum_cents) {
    config.focused_clean.minimum_cents = minimum;
    changed.push("focused minimum");
  }
  const bundle = Number(settings.multi_area_bundle_discount_percent);
  if (Number.isFinite(bundle) && bundle !== config.focused_clean.bundle_discount_percent) {
    config.focused_clean.bundle_discount_percent = bundle;
    changed.push("bundle discount");
  }
  const sameDay = toCents(settings.same_day_upcharge_dollars);
  if (sameDay != null && sameDay !== config.surcharges.same_day_cents) {
    config.surcharges.same_day_cents = sameDay;
    changed.push("same-day fee");
  }
  return { applied: true, changed };
}

/** Mirror of the floor pay-rate read in loadDynamicPricingContext(). */
function floorPayRates(snapshot: Snapshot): FloorPayRates {
  const rates: FloorPayRates = { soloFoundationPercent: 35, crewFoundationPercent: 40 };
  for (const r of snapshot.cleaner_pay_rates.filter((x) => x.pay_tier === "foundation")) {
    const min = Number(r.min_crew_size);
    const max = r.max_crew_size == null ? Infinity : Number(r.max_crew_size);
    if (min <= 1 && 1 <= max) rates.soloFoundationPercent = Number(r.rate_percent);
    if (min <= 2 && 2 <= max) rates.crewFoundationPercent = Number(r.rate_percent);
  }
  return rates;
}

interface ExampleSpec {
  id: string;
  /** Plain-language scenario a VA would recognise from a phone call. */
  scenario: string;
  zoneCode: string;
  serviceType: DynamicServiceType;
  homeSizeId: string | null;
  condition: ConditionLevel;
  addOns?: string[];
  sameDay?: boolean;
  focused?: Array<{ areaId: string; quantity: number }>;
  membershipPlan?: MembershipPlanId;
  firstMonth?: boolean;
}

const EXAMPLES: ExampleSpec[] = [
  {
    id: "standard-1501-2000-zone-b",
    scenario:
      "A 1,700 sq ft house in Columbia (Zone B), standard condition, Standard Clean, no add-ons, booked for next week.",
    zoneCode: "B",
    serviceType: "standard",
    homeSizeId: "1501_2000",
    condition: "standard",
  },
  {
    id: "deep-2001-2500-zone-a-heavy-addons",
    scenario:
      "A 2,300 sq ft home in Bethesda (Zone A) in heavy condition, Deep Clean, with inside-the-fridge and inside-the-oven add-ons.",
    zoneCode: "A",
    serviceType: "deep",
    homeSizeId: "2001_2500",
    condition: "heavy",
    addOns: ["fridge", "oven"],
  },
  {
    id: "moveinout-1000-1500-zone-c",
    scenario:
      "A 1,200 sq ft rental in Frederick (Zone C), Move-In/Move-Out, standard condition, customer also asks for inside-the-fridge and inside-the-oven.",
    zoneCode: "C",
    serviceType: "moveInOut",
    homeSizeId: "1000_1500",
    condition: "standard",
    addOns: ["fridge", "oven"],
  },
  {
    // Bathroom, kitchen and living are single-select on the screen; only
    // Bedroom takes a quantity. Keep the example to what a VA can actually
    // build so the number matches what they'd see.
    id: "focused-kitchen-bathroom-two-bedrooms-zone-b",
    scenario:
      "A focused clean in Zone B — kitchen, one bathroom and two bedrooms, standard condition.",
    zoneCode: "B",
    serviceType: "focused",
    homeSizeId: null,
    condition: "standard",
    focused: [
      { areaId: "kitchen", quantity: 1 },
      { areaId: "bathroom", quantity: 1 },
      { areaId: "bedroom", quantity: 2 },
    ],
  },
  {
    id: "focused-single-bedroom-same-day-zone-b",
    scenario:
      "One bedroom only, in Zone B, booked for today — shows both the focused minimum and the same-day fee.",
    zoneCode: "B",
    serviceType: "focused",
    homeSizeId: null,
    condition: "standard",
    focused: [{ areaId: "bedroom", quantity: 1 }],
    sameDay: true,
  },
  {
    id: "membership-biweekly-1501-2000-zone-a-first-month",
    scenario:
      "A Glow Bi-Weekly membership on a 1,700 sq ft home in Zone A, first month, with the first-clean deep added.",
    zoneCode: "A",
    serviceType: "standard",
    homeSizeId: "1501_2000",
    condition: "standard",
    membershipPlan: "biweekly",
    firstMonth: true,
  },
  {
    // The floor is derived from projected hours × crew size, and the 2,501–
    // 3,000 band is the first one the engine staffs with two cleaners. That
    // makes it the band where a Standard Clean can price BELOW the floor and
    // get pushed back up — the single most surprising thing on the screen.
    id: "standard-2501-3000-zone-b-floor",
    scenario:
      "A 2,700 sq ft home in Zone B, standard condition, Standard Clean — the case where the floor pushes the price up.",
    zoneCode: "B",
    serviceType: "standard",
    homeSizeId: "2501_3000",
    condition: "standard",
  },
  {
    id: "standard-0-999-zone-c-light",
    scenario:
      "A small 900 sq ft condo in Zone C in light condition — the cheapest Standard Clean the engine will quote, useful for checking the floor.",
    zoneCode: "C",
    serviceType: "standard",
    homeSizeId: "0_999",
    condition: "light",
  },
];

function run() {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot;
  const config = snapshot.config;
  const overlay = applyFocusedSameDayOverlay(
    config,
    snapshot.focused_same_day_settings as Record<string, unknown>,
  );
  const payRates = floorPayRates(snapshot);

  // Demand is resolved by the caller in production. The snapshot records the
  // master switch and shadow flag, so reproduce the mode the same way
  // resolveDemand() does rather than assuming it.
  const demandMode: DemandResolution["mode"] = config.demand.enabled
    ? "live"
    : config.demand.shadow_mode
      ? "shadow"
      : "off";
  const demand: DemandResolution = { mode: demandMode, multiplier: 1, reasons: [] };

  const examples = EXAMPLES.map((spec) => {
    const zone = snapshot.zones.find((z) => z.code === spec.zoneCode);
    if (!zone) throw new Error(`Snapshot has no zone ${spec.zoneCode}`);

    const input: QuoteInput = {
      serviceType: spec.serviceType,
      homeSizeId: spec.homeSizeId,
      focused: spec.focused ? { selections: spec.focused } : null,
      condition: spec.condition,
      addOns: spec.addOns || [],
      sameDay: Boolean(spec.sameDay),
      membershipPlan: spec.membershipPlan || "none",
      firstMonth: spec.firstMonth,
    };

    const breakdown = computeQuote(config, zone, input, demand, payRates);
    if (!breakdown.ok) {
      throw new Error(`Example ${spec.id} did not price: ${breakdown.error}`);
    }
    const floor = computeFloorCents(config, spec.serviceType, spec.homeSizeId, payRates);

    return {
      id: spec.id,
      scenario: spec.scenario,
      zone: { code: zone.code, name: zone.name, multiplier: zone.multiplier },
      input: {
        serviceType: spec.serviceType,
        homeSizeId: spec.homeSizeId,
        bandLabel: spec.homeSizeId ? config.bands[spec.homeSizeId]?.label ?? null : null,
        condition: spec.condition,
        addOns: spec.addOns || [],
        sameDay: Boolean(spec.sameDay),
        membershipPlan: spec.membershipPlan || "none",
        firstMonth: Boolean(spec.firstMonth),
        focused: spec.focused || null,
      },
      // Every layer, in the order the engine applies them, so a guide can
      // narrate the maths line by line without recomputing anything.
      steps: breakdown.lines.map((l) => ({
        key: l.key,
        label: l.label,
        reason: l.reason,
        kind: l.kind,
        multiplier: l.multiplier ?? null,
        amountCents: l.amountCents,
        amount: money(l.amountCents),
      })),
      totals: {
        baseCents: breakdown.baseCents,
        base: money(breakdown.baseCents),
        conditionMultiplier: breakdown.conditionMultiplier,
        zoneMultiplier: breakdown.zoneMultiplier,
        demandMultiplier: breakdown.demandMultiplier,
        demandMode: breakdown.demandMode,
        addOnsCents: breakdown.addOnsCents,
        addOns: money(breakdown.addOnsCents),
        surchargesCents: breakdown.surchargesCents,
        surcharges: money(breakdown.surchargesCents),
        serviceTotalCents: breakdown.serviceTotalCents,
        serviceTotal: money(breakdown.serviceTotalCents),
        totalCents: breakdown.totalCents,
        total: money(breakdown.totalCents),
        floorCents: floor,
        floor: money(floor),
        floorClamped: breakdown.floorClamped,
        ceilingClamped: breakdown.ceilingClamped,
      },
      membership: breakdown.membership
        ? {
            plan: breakdown.membership.plan,
            monthly: money(breakdown.membership.monthlyCents),
            firstMonthFee: money(breakdown.membership.firstMonthFeeCents),
            firstMonthTotal: money(breakdown.membership.firstMonthTotalCents),
          }
        : null,
    };
  });

  // The per-band floor table the Pricing guide publishes — same derivation the
  // engine uses, so the guide never carries a stale floor.
  const floorTable = Object.keys(config.bands)
    .filter((b) => (config.bands[b]?.hours ?? 0) > 0)
    .map((bandId) => ({
      bandId,
      label: config.bands[bandId].label,
      hours: config.bands[bandId].hours,
      crewSize: config.bands[bandId].crew_size,
      // The floor is derived from hours × crew × the minimum hourly, so it is
      // the same for every single-visit service. Combo is two visits.
      singleVisit: money(computeFloorCents(config, "standard", bandId, payRates)),
      combo: money(computeFloorCents(config, "combo", bandId, payRates)),
    }));

  const out = {
    _readme:
      "GENERATED by npm run docs:pricing from docs/admin-workspace/_data/pricing-snapshot.json. Do not edit by hand — re-run the script instead.",
    generatedAt: new Date().toISOString(),
    snapshotCapturedAt: snapshot.captured_at,
    projectRef: snapshot.project_ref,
    configVersion: snapshot.config_version,
    engine: "src/lib/dynamic-pricing.ts (computeQuote)",
    overlay: {
      appliedFromAppSettings: overlay.applied,
      valuesOverlayChanged: overlay.changed,
      note: overlay.applied && overlay.changed.length === 0
        ? "app_settings.focused_same_day_settings currently matches the config fallback exactly, so the overlay changed nothing."
        : "app_settings.focused_same_day_settings overrode the config fallback for the listed values.",
    },
    floorInputs: {
      minEffectiveHourly: money(config.guardrails.min_effective_hourly_cents),
      soloFoundationPercent: payRates.soloFoundationPercent,
      crewFoundationPercent: payRates.crewFoundationPercent,
      note: "Foundation percentages come from the live cleaner_pay_rates rows, not the engine's 35/40 fallback.",
    },
    demand: {
      enabled: config.demand.enabled,
      shadowMode: config.demand.shadow_mode,
      resolvedMode: demandMode,
      appliedMultiplier: 1,
      note: demandMode === "live"
        ? "Reactive pricing is LIVE — the multiplier varies by date and zone, so examples use 1.00 as the neutral case."
        : "Reactive pricing is not charging. Examples apply a demand multiplier of 1.00, which is what the engine does in this mode.",
    },
    floorTable,
    examples,
  };

  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);

  console.log(`Pricing config v${snapshot.config_version} · captured ${snapshot.captured_at}`);
  console.log(
    `Floor inputs: ${out.floorInputs.minEffectiveHourly}/hr · foundation solo ${payRates.soloFoundationPercent}% · crew ${payRates.crewFoundationPercent}%`,
  );
  console.log(`Demand: ${demandMode}\n`);
  for (const ex of examples) {
    console.log(`  ${ex.id.padEnd(46)} ${ex.totals.total.padStart(10)}${ex.totals.floorClamped ? "  (floor applied)" : ""}`);
  }
  console.log(`\nWrote ${OUT}`);
}

run();

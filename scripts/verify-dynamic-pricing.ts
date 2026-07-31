// ─── verify-dynamic-pricing ─────────────────────────────────────────────────
//
// Proves the dynamic pricing engine against the worked examples in the
// Dynamic Zone & Demand-Reactive Pricing spec, plus the guardrails that must
// be enforced in code (floor, ceiling, rate limit, bounds, override band,
// determinism). Run with:  npm run pricing:verify
//
// The config under test is parsed OUT OF THE MIGRATION SEED
// (supabase/migrations/20260731090000_dynamic_zone_demand_pricing.sql), so
// this verifies exactly what ships to the database — the engine itself
// hardcodes no prices.
//
// NOTE on worked example A: the spec lists $360.77, but its own line items
// ($239 + $59.75 + $44.81 + $17.21) contain an arithmetic slip — the demand
// delta of 5% on $343.56 is $17.18, not $17.21. The formula the spec states
// ($239 × 1.25 × 1.15 × 1.05 = $360.7406) rounds to $360.74, which is what
// the engine produces and what this script asserts.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  applyRateLimit,
  checkOverride,
  computeDemandTarget,
  computeFloorCents,
  computeQuote,
  type DemandResolution,
  type DynamicPricingConfig,
  type FloorPayRates,
  type QuoteInput,
  type ZoneInfo,
} from "../src/lib/dynamic-pricing";

const ROOT = join(__dirname, "..");

// ─── Harness ────────────────────────────────────────────────────────────────

let failures = 0;
let passes = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`);
  }
}
function checkTrue(name: string, cond: boolean, detail = "") {
  if (cond) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ─── 0. The Deno and React engine mirrors must be byte-identical ───────────

console.log("\n── Mirror integrity");
const mirrorA = readFileSync(join(ROOT, "src/lib/dynamic-pricing.ts"), "utf8");
const mirrorB = readFileSync(join(ROOT, "supabase/functions/_shared/dynamic-pricing.ts"), "utf8");
checkTrue("src/lib/dynamic-pricing.ts === _shared/dynamic-pricing.ts", mirrorA === mirrorB);

// ─── Load the seeded config from the migration ──────────────────────────────

const migration = readFileSync(
  join(ROOT, "supabase/migrations/20260731090000_dynamic_zone_demand_pricing.sql"),
  "utf8",
);
const jsonMatch = migration.match(/\$json\$\s*([\s\S]*?)\s*\$json\$/);
if (!jsonMatch) {
  console.error("Could not find the $json$ config seed in the migration.");
  process.exit(1);
}
const seededConfig = JSON.parse(jsonMatch[1]) as DynamicPricingConfig;

const zoneA: ZoneInfo = { id: "a", code: "A", name: "Zone A — Premium", multiplier: 1.15, status: "active", is_default: false };
const zoneB: ZoneInfo = { id: "b", code: "B", name: "Zone B — Standard", multiplier: 1.0, status: "active", is_default: true };
const zoneC: ZoneInfo = { id: "c", code: "C", name: "Zone C — Outer", multiplier: 0.9, status: "active", is_default: false };

// Foundation pool percentages, as read from cleaner_pay_rates in production.
const payRates: FloorPayRates = { soloFoundationPercent: 35, crewFoundationPercent: 40 };

const live = (m: number): DemandResolution => ({ mode: "live", multiplier: m, reasons: ["test"] });
const off: DemandResolution = { mode: "off", multiplier: 1, reasons: [] };

const q = (input: Partial<QuoteInput>): QuoteInput => ({
  serviceType: "standard",
  homeSizeId: "1501_2000",
  focused: null,
  condition: "standard",
  addOns: [],
  sameDay: false,
  membershipPlan: "none",
  ...input,
});

// ─── Worked examples ────────────────────────────────────────────────────────

console.log("\n── Worked examples (Current Pricing Reference)");

// A — Standard, 1,750 sqft, Standard condition, Bethesda (Zone A), demand ×1.05
{
  const r = computeQuote(seededConfig, zoneA, q({}), live(1.05), payRates);
  check("A · total $360.74 ($239 × 1.25 × 1.15 × 1.05)", r.totalCents, 36074);
  check("A · base stored separately ($239)", r.baseCents, 23900);
  check("A · condition delta +$59.75", r.conditionDeltaCents, 5975);
  check("A · zone delta +$44.81", r.zoneDeltaCents, 4481);
  check("A · demand delta +$17.18", r.demandDeltaCents, 1718);
  check("A · surcharges $0", r.surchargesCents + r.addOnsCents, 0);
}

// B — Deep, 2,200 sqft, Heavy condition, Towson (Zone C), demand ×1.00
{
  const r = computeQuote(seededConfig, zoneC, q({ serviceType: "deep", homeSizeId: "2001_2500", condition: "heavy" }), live(1.0), payRates);
  check("B · total $603.36 ($419 × 1.6 × 0.90)", r.totalCents, 60336);
}

// C — Move-In/Out, 1,800 sqft, Standard condition, Columbia (Zone B), demand ×1.10
{
  const r = computeQuote(
    seededConfig, zoneB,
    q({ serviceType: "moveInOut", homeSizeId: "1501_2000", addOns: ["fridge", "oven"] }),
    live(1.1), payRates,
  );
  check("C · total $657.25 ($478 × 1.25 × 1.10)", r.totalCents, 65725);
  check("C · fridge + oven included free with Move-In/Out", r.addOnsCents, 0);
}

// D — Focused (1 bathroom + 2 bedrooms), Standard condition, Rockville (Zone A), demand off
{
  const r = computeQuote(
    seededConfig, zoneA,
    q({ serviceType: "focused", homeSizeId: null, focused: { areas: 1, bedrooms: 2 } }),
    live(1.2), // even a live demand spike must not touch a focused clean
    payRates,
  );
  check("D · total $237.19 (($65 + $50 + $50) × 1.25 × 1.15)", r.totalCents, 23719);
  check("D · demand exempt for focused cleans", r.demandMode, "exempt_service");
}

// E — Same-day focused, 1 bathroom, Light condition, Zone B, + interior windows
{
  const r = computeQuote(
    seededConfig, zoneB,
    q({ serviceType: "focused", homeSizeId: null, focused: { areas: 1, bedrooms: 0 }, condition: "light", addOns: ["windows"], sameDay: true }),
    off, payRates,
  );
  check("E · total $155.00 ($65 + $40 windows + $50 same-day)", r.totalCents, 15500);
  check("E · flat charges added last, never multiplied", r.serviceTotalCents, 6500);
}

// F — Membership, bi-weekly, 1,600 sqft, Frederick (Zone C), first month
{
  const r = computeQuote(
    seededConfig, zoneC,
    q({ membershipPlan: "biweekly", firstMonth: true }),
    live(1.25), // demand spike must not touch a member's plan rate
    payRates,
  );
  check("F · monthly $287.10 ($319 × 0.90)", r.membership?.monthlyCents, 28710);
  check("F · first month $362.10 (+$75 deep-clean fee)", r.totalCents, 36210);
  check("F · members exempt from demand uplift", r.demandMode, "exempt_member");
}

// G — Floor clamp. Standard 0–999, Zone C ×0.90, demand ×0.90, floor $130.
{
  const cfg: DynamicPricingConfig = structuredClone(seededConfig);
  cfg.guardrails.floor_cents = { standard: { "0_999": 13000 } };
  const r = computeQuote(cfg, zoneC, q({ homeSizeId: "0_999", condition: "light" }), live(0.9), payRates);
  check("G · computed $121.50 clamps to the $130.00 floor", r.totalCents, 13000);
  check("G · clamp is logged on the breakdown", r.floorClamped, true);
  checkTrue("G · floor line present with reason", r.lines.some((l) => l.key === "floor" && l.reason.includes("cleaner pay")));
}

// ─── Layer independence & fairness ──────────────────────────────────────────

console.log("\n── Layer independence, determinism, zone/demand separation");
{
  const inA = computeQuote(seededConfig, zoneA, q({}), off, payRates);
  const inC = computeQuote(seededConfig, zoneC, q({}), off, payRates);
  // Same job in two zones differs by exactly the zone multiplier.
  check("Zone A vs C differ by exactly ×1.15 vs ×0.90 on the multiplied price",
    [inA.serviceTotalCents, inC.serviceTotalCents],
    [Math.round(29875 * 1.15), Math.round(29875 * 0.9)]);

  // A Zone C (discount) job still carries demand uplift — layers independent.
  const cWithDemand = computeQuote(seededConfig, zoneC, q({}), live(1.1), payRates);
  check("Zone C job still carries demand ×1.10 (never folded into zone)",
    [cWithDemand.zoneMultiplier, cWithDemand.demandMultiplier], [0.9, 1.1]);

  // Determinism: identical requests at the same moment → identical prices.
  const r1 = computeQuote(seededConfig, zoneB, q({ addOns: ["windows"] }), live(1.07), payRates);
  const r2 = computeQuote(seededConfig, zoneB, q({ addOns: ["windows"] }), live(1.07), payRates);
  check("Two identical requests price identically", r1.totalCents, r2.totalCents);

  // Disabling reactive leaves base × condition × zone intact.
  const disabled = computeQuote(seededConfig, zoneA, q({}), off, payRates);
  check("Demand off → base × condition × zone still fully functional",
    disabled.totalCents, Math.round(23900 * 1.25 * 1.15));

  // Shadow mode: charged price ignores demand, would-be multiplier is logged.
  const shadow = computeQuote(seededConfig, zoneA, q({}), { mode: "shadow", multiplier: 1.12, reasons: [] }, payRates);
  check("Shadow mode charges zone-only price", shadow.totalCents, Math.round(23900 * 1.25 * 1.15));
  check("Shadow mode logs the would-be multiplier", shadow.shadowDemandMultiplier, 1.12);
}

// ─── Guardrails under extreme values ────────────────────────────────────────

console.log("\n── Guardrails (floor, ceiling, bounds, rate limit, override band)");
{
  // Ceiling: zone × demand combined may never exceed max_total_uplift (1.35).
  const cfg: DynamicPricingConfig = structuredClone(seededConfig);
  cfg.demand.max_multiplier = 5; // hostile config
  const r = computeQuote(cfg, zoneA, q({}), live(5), payRates);
  const capTotal = Math.round(29875 * 1.35);
  check("Extreme demand ×5 is capped at base×condition ×1.35", r.serviceTotalCents, capTotal);
  check("Ceiling clamp is logged", r.ceilingClamped, true);

  // Floor from cleaner pay: derived from min hourly × hours × crew / pool %.
  const floor = computeFloorCents(seededConfig, "standard", "0_999", payRates);
  check("Derived floor 0_999 standard = $22/h × 2h ÷ 35% = $125.71", floor, 12571);
  const low = computeQuote(cfg, zoneC, q({ homeSizeId: "0_999", condition: "light" }), live(0.5), payRates);
  checkTrue("Extreme discount can never break the derived floor", low.serviceTotalCents >= floor,
    `${low.serviceTotalCents} < ${floor}`);
  // At the floor, per-cleaner hourly stays ≥ the configured minimum.
  const hourlyAtFloor = (floor * 0.35) / 2.0;
  checkTrue("Price at floor keeps per-cleaner hourly ≥ $22", hourlyAtFloor >= 2200 - 1);

  // Demand target is bounded no matter the signals.
  const target = computeDemandTarget(seededConfig, {
    capacityUtilization: 1, leadTimeDays: 0, serviceDate: "2026-08-01", zoneAvailableCleaners: 0,
  });
  checkTrue("All-max signals stay within [0.90, 1.25]", target.target <= 1.25 && target.target >= 0.9);
  const idle = computeDemandTarget(seededConfig, {
    capacityUtilization: 0, leadTimeDays: 30, serviceDate: "2026-08-12", zoneAvailableCleaners: 10,
  });
  checkTrue("Idle capacity DISCOUNTS (target < 1)", idle.target < 1, `target ${idle.target}`);

  // Rate limit: 30 minutes at 0.05/hour allows at most 0.025 of movement.
  const limited = applyRateLimit(seededConfig, 1.25, { multiplier: 1.0, updatedAtMs: Date.now() - 30 * 60_000 }, Date.now());
  check("Rate limit: 1.00 → target 1.25 after 30min moves only to 1.025", Math.round(limited * 1000) / 1000, 1.025);

  // Override band: ±10% self-serve, beyond → approval, below floor → never.
  const within = checkOverride(seededConfig, 30000, 27500, 20000);
  check("Override −8.3% within ±10% band → allowed", [within.allowed, within.requiresApproval], [true, false]);
  const beyond = checkOverride(seededConfig, 30000, 25000, 20000);
  check("Override −16.7% beyond band → requires admin approval", [beyond.allowed, beyond.requiresApproval], [false, true]);
  const below = checkOverride(seededConfig, 30000, 19000, 20000);
  check("Override below floor → refused at any level", [below.allowed, below.belowFloor], [false, true]);
}

// ─── Config-driven values (no hardcodes in the engine) ─────────────────────

console.log("\n── Values come from config, not code");
{
  const cfg: DynamicPricingConfig = structuredClone(seededConfig);
  cfg.base_tables.training_guide["1501_2000"].standard = 99900;
  cfg.condition_multipliers.standard = 2;
  cfg.surcharges.same_day_cents = 1234;
  const r = computeQuote(cfg, zoneB, q({ sameDay: true }), off, payRates);
  check("Changing config alone changes the quote (base, condition, same-day)",
    r.totalCents, Math.round(99900 * 2) + 1234);

  // Membership frequency not offered for the size → explicit failure, not 0.
  const noWeekly = computeQuote(seededConfig, zoneB, q({ homeSizeId: "3001_3500", membershipPlan: "weekly" }), off, payRates);
  check("Weekly plan not offered at 3,001–3,500 sqft → clean error", noWeekly.ok, false);

  // 5,000+ sqft → custom quote, never a $0 price.
  const custom = computeQuote(seededConfig, zoneB, q({ homeSizeId: "5000_plus" }), off, payRates);
  check("5,000+ sqft → custom-quote error, not a wrong price", custom.ok, false);

  // The unreconciled base tables stay surfaced until admin confirms.
  check("Base-table discrepancy flagged (reconciled=false in seed)", seededConfig.base_tables.reconciled, false);
  checkTrue("Both base tables present for the admin comparison view",
    Boolean(seededConfig.base_tables.training_guide && seededConfig.base_tables.later_sqft_model));
}

// ─── Result ─────────────────────────────────────────────────────────────────

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);

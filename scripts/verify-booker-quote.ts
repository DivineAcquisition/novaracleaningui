// ─── verify-booker-quote ────────────────────────────────────────────────────
//
// Acceptance scenarios for the internal booker's picker → rail → saved quote
// path, run against the REAL dynamic engine and the config seeded in the
// migration (same as pricing:verify). Run with:  npm run booker-quote:verify
//
// It also records, as explicit checks, the two first-clean-deep pricing
// conflicts that are escalated rather than silently changed (see the
// "Escalated" block at the bottom).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { computeQuote, type DynamicPricingConfig, type QuoteInput, type ZoneInfo } from "../src/lib/dynamic-pricing";
import { chargeableAddOnIds } from "../src/lib/pricing";
import { calculatePrice } from "../src/lib/pricing-system";
import {
  EXTRA_OPTIONS,
  deriveQuoteLines,
  extraApplicability,
  perVisitAddOns,
  quoteSummaryText,
  recurringTotals,
} from "../src/lib/booker-quote";

const ROOT = join(__dirname, "..");
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${!ok && detail !== undefined ? `  — ${JSON.stringify(detail)}` : ""}`);
}

const migration = readFileSync(join(ROOT, "supabase/migrations/20260731222235_dynamic_zone_demand_pricing.sql"), "utf8");
const config = JSON.parse(migration.match(/\$json\$\s*([\s\S]*?)\s*\$json\$/)![1]) as DynamicPricingConfig;
const zoneB: ZoneInfo = { id: "b", code: "B", name: "Zone B — Standard", multiplier: 1.0, status: "active", is_default: true };
const off = { mode: "off" as const, multiplier: 1, reasons: [] };
const pay = { soloFoundationPercent: 35, crewFoundationPercent: 40 };
const quote = (i: Partial<QuoteInput>) =>
  computeQuote(config, zoneB, { serviceType: "standard", homeSizeId: "1501_2000", focused: null, condition: "standard", addOns: [], sameDay: false, membershipPlan: "none", ...i }, off, pay);

/** Rail totals as VaBooking computes them for a one-time booking. */
function oneTime(total: number, pct = 0.5) {
  const due = Math.round(total * pct);
  return { totalCents: total, dueTodayCents: due, remainingCents: total - due };
}
const sumLines = (l: ReturnType<typeof deriveQuoteLines>) => l.service.cents + l.chargedCents + l.surchargesCents + l.adjustmentsCents;

console.log("\n── Picker catalog");
check("ops-only site findings are not in the per-visit picker", !EXTRA_OPTIONS.some((o) => o.id === "pestLight" || o.id === "moldMinor"));
check("first-visit deep clean is not a per-visit extra", !EXTRA_OPTIONS.some((o) => o.id === "firstCleanDeep"));
check("every picker extra is priced by the dynamic engine", EXTRA_OPTIONS.every((o) => config.add_ons_cents[o.id] === o.listCents),
  EXTRA_OPTIONS.filter((o) => config.add_ons_cents[o.id] !== o.listCents).map((o) => o.id));
check("laundry shows its per-load unit", EXTRA_OPTIONS.find((o) => o.id === "laundry")?.unit === "per load");
check("fridge reads Included on move-in/out", extraApplicability("fridge", "moveInOut").kind === "included");
check("oven reads Included on move-in/out", extraApplicability("oven", "moveInOut").kind === "included");
check("fridge is charged on a standard clean", JSON.stringify(extraApplicability("fridge", "standard")) === JSON.stringify({ kind: "charged", cents: 3000 }));

console.log("\n── One-time standard clean with two extras");
{
  const addOns = ["windows", "laundry"];
  const b = quote({ addOns });
  const lines = deriveQuoteLines({ breakdown: b, addOns, serviceType: "standard", serviceLabel: "Standard", fallbackServiceCents: 0 });
  check("charged add-ons listed separately (2)", lines.charged.length === 2 && lines.chargedCents === 7500, lines.charged);
  check("no surcharges folded into add-ons", lines.surchargesCents === 0);
  check("rail lines sum to the engine total", sumLines(lines) === b.totalCents, { sum: sumLines(lines), total: b.totalCents });
  const t = oneTime(b.totalCents);
  check("Due today + Remaining = Total", t.dueTodayCents + t.remainingCents === t.totalCents);
  const text = quoteSummaryText({ lines, oneTime: t });
  check("copyable summary states Total / Due today / Remaining", /Total: \$/.test(text) && /Due today: \$/.test(text) && /Remaining balance: \$/.test(text));
  check("summary shows laundry per load", /Laundry.*per load/.test(text));
}

console.log("\n── Move-out with oven and fridge");
{
  const addOns = ["oven", "fridge", "baseboards"];
  const b = quote({ serviceType: "moveInOut", addOns });
  const lines = deriveQuoteLines({ breakdown: b, addOns, serviceType: "moveInOut", serviceLabel: "Move-In/Out", fallbackServiceCents: 0 });
  check("oven + fridge shown as included, not charged", lines.included.map((l) => l.key).sort().join() === "fridge,oven", lines.included);
  check("only baseboards charged", lines.charged.length === 1 && lines.charged[0].key === "baseboards");
  check("rail lines sum to the engine total", sumLines(lines) === b.totalCents);
  const fb = deriveQuoteLines({ breakdown: null, addOns, serviceType: "moveInOut", serviceLabel: "Move-In/Out", fallbackServiceCents: 100 });
  check("fallback path agrees on included items", fb.included.map((l) => l.key).sort().join() === "fridge,oven" && fb.chargedCents === 3500);
}

console.log("\n── Surcharge with zero selected add-ons");
{
  const b = quote({ sameDay: true });
  const lines = deriveQuoteLines({ breakdown: b, addOns: [], serviceType: "standard", serviceLabel: "Standard", fallbackServiceCents: 0 });
  check("no add-on lines", lines.charged.length === 0 && lines.included.length === 0);
  check("same-day fee shown as a surcharge line", lines.surcharges.length === 1 && lines.surchargesCents === config.surcharges.same_day_cents, lines.surcharges);
  check("rail lines sum to the engine total", sumLines(lines) === b.totalCents);
}

console.log("\n── Recurring plan with first-visit deep cleaning");
{
  // Reopened legacy quote carrying firstCleanDeep in add_ons must not double-charge.
  const saved = ["windows", "firstCleanDeep"];
  const perVisit = perVisitAddOns(saved);
  check("first-visit deep stripped from per-visit add-ons", perVisit.join() === "windows");
  const perCleanLegacy = Math.round(calculatePrice("1501_2000", "standard", perVisit, "none", false, false, 0).total * 100);
  const perCleanIfNotStripped = Math.round(calculatePrice("1501_2000", "standard", saved, "none", false, false, 0).total * 100);
  check("not stripping would have added $75 to EVERY visit (regression guard)", perCleanIfNotStripped - perCleanLegacy === 7500);
  const r = recurringTotals({ perVisitCents: perCleanLegacy, includeFirstVisitDeep: true, firstVisitDeepCents: 7500, cadenceLabel: "Bi-weekly" });
  check("first visit = per-visit + $75 once", r.firstVisitCents === perCleanLegacy + 7500);
  check("later visits = per-visit only", r.laterVisitsCents === perCleanLegacy);
  const m = quote({ membershipPlan: "biweekly", firstMonth: true, addOns: perVisit });
  check("engine first-month fee is the same $75", m.membership?.firstMonthFeeCents === 7500);
  const declined = recurringTotals({ perVisitCents: perCleanLegacy, includeFirstVisitDeep: false, firstVisitDeepCents: 7500, cadenceLabel: "Bi-weekly" });
  check("declined deep → first visit equals later visits", declined.firstVisitCents === declined.laterVisitsCents);
}

console.log("\n── Escalated (business-rule conflicts recorded, not changed)");
{
  // 1. Comment in pricing.ts says first-clean deep "does not stack on a job
  //    that is already Deep / Combo / Move-In/Out", and ScopeAdjustmentDialog
  //    agrees — but chargeableAddOnIds (client + Deno mirror) still charges it
  //    on Move-In/Out. Recorded here so a decision flips this check visibly.
  const charged = chargeableAddOnIds(["firstCleanDeep"], "moveInOut");
  check("[ESCALATED] legacy calculator still charges firstCleanDeep on Move-In/Out", charged.includes("firstCleanDeep"));
  // 2. The dynamic engine (what book-as-va charges) has no price for
  //    firstCleanDeep, so a one-time job carrying it is charged $0 there and
  //    $75 on the legacy fallback. The booker now surfaces it as "unpriced".
  const b = quote({ addOns: ["firstCleanDeep"] });
  const lines = deriveQuoteLines({ breakdown: b, addOns: ["firstCleanDeep"], serviceType: "standard", serviceLabel: "Standard", fallbackServiceCents: 0 });
  check("[ESCALATED] dynamic engine does not price firstCleanDeep; booker shows it as unpriced", config.add_ons_cents.firstCleanDeep === undefined && lines.unpriced.length === 1);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall booker quote checks passed");
process.exit(failures ? 1 : 0);

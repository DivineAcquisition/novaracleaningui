// Integration-style test of _shared/dynamic-quote.ts with a mock supabase
// client (chainable query builder over in-memory tables). Verifies zone
// resolution paths, shadow demand, rate limiting, and audit writes.
//
// Runs under DENO (the edge-function runtime), from the repo root:
//   npm run pricing:verify:server
import {
  computeServerQuote,
  loadDynamicPricingContext,
  resolveDemand,
  resolveZoneForZip,
} from "../supabase/functions/_shared/dynamic-quote.ts";

// ── Load the seeded config out of the migration ──
const migration = await Deno.readTextFile(
  new URL("../supabase/migrations/20260731090000_dynamic_zone_demand_pricing.sql", import.meta.url),
);
const config = JSON.parse(migration.match(/\$json\$\s*([\s\S]*?)\s*\$json\$/)![1]);

// ── In-memory tables ──
const zones = [
  { id: "za", code: "A", name: "Zone A — Premium", description: null, multiplier: 1.15, status: "active", min_job_value_cents: null, travel_minutes: 20, is_default: false },
  { id: "zb", code: "B", name: "Zone B — Standard", description: null, multiplier: 1.0, status: "active", min_job_value_cents: null, travel_minutes: 35, is_default: true },
  { id: "zc", code: "C", name: "Zone C — Outer", description: null, multiplier: 0.9, status: "active", min_job_value_cents: null, travel_minutes: 55, is_default: false },
  { id: "zx", code: "X", name: "Zone X — Paused", description: null, multiplier: 1.0, status: "not_served", min_job_value_cents: null, travel_minutes: null, is_default: false },
];
const tables: Record<string, Record<string, unknown>[]> = {
  dynamic_pricing_config_versions: [{ version: 1, config, is_active: true }],
  pricing_zones: zones,
  pricing_zone_zips: [
    { zip: "20814", zone_id: "za" },
    { zip: "21045", zone_id: "zb" },
    { zip: "21204", zone_id: "zc" },
    { zip: "20999", zone_id: "zx" },
  ],
  cleaner_pay_rates: [
    { min_crew_size: 1, max_crew_size: 1, rate_percent: 35, pay_tier: "foundation" },
    { min_crew_size: 2, max_crew_size: null, rate_percent: 40, pay_tier: "foundation" },
  ],
  service_coverage_zones: [
    { zip_code: "20874", is_active: true },   // served but unmapped → default B
    { zip_code: "20899", is_active: false },  // inactive → waitlist
  ],
  availability_slots: [
    { service_date: "2026-08-08", max_capacity: 10, current_bookings: 9 }, // busy
    { service_date: "2026-08-11", max_capacity: 10, current_bookings: 1 }, // idle
  ],
  cleaners: [
    { id: "c1", status: "active", available_for_bookings: true, service_zip_codes: ["20814"] },
  ],
  demand_rate_state: [],
  price_quote_audit: [],
  va_quotes: [],
};

// ── Chainable mock query builder ──
function makeClient() {
  return {
    from(table: string) {
      const rows = tables[table] || (tables[table] = []);
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      let head = false;
      let countMode = false;
      const api: Record<string, unknown> = {};
      const chain = (fn?: () => void) => { fn?.(); return api; };
      Object.assign(api, {
        select: (_cols?: string, opts?: { count?: string; head?: boolean }) =>
          chain(() => { head = Boolean(opts?.head); countMode = Boolean(opts?.count); }),
        eq: (col: string, val: unknown) => chain(() => filters.push((r) => r[col] === val)),
        is: (col: string, val: unknown) => chain(() => filters.push((r) => r[col] === val)),
        gte: (col: string, val: unknown) => chain(() => filters.push((r) => String(r[col]) >= String(val))),
        overlaps: (col: string, vals: string[]) =>
          chain(() => filters.push((r) => Array.isArray(r[col]) && (r[col] as string[]).some((v) => vals.includes(v)))),
        limit: (_n: number) => chain(),
        order: (_c: string, _o?: unknown) => chain(),
        maybeSingle: () => {
          const found = rows.filter((r) => filters.every((f) => f(r)));
          return Promise.resolve({ data: found[0] ?? null, error: null });
        },
        single: () => {
          const found = rows.filter((r) => filters.every((f) => f(r)));
          return Promise.resolve({ data: found[0] ?? null, error: found[0] ? null : { message: "no rows" } });
        },
        insert: (row: Record<string, unknown>) => {
          const stored = { id: crypto.randomUUID(), ...row };
          rows.push(stored);
          return {
            select: () => ({ single: () => Promise.resolve({ data: stored, error: null }) }),
            then: (res: (v: unknown) => void) => res({ data: null, error: null }),
          };
        },
        upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => {
          const keys = (opts?.onConflict || "").split(",").filter(Boolean);
          const existing = rows.find((r) => keys.every((k) => r[k] === row[k]));
          if (existing) Object.assign(existing, row);
          else rows.push({ ...row });
          return Promise.resolve({ data: null, error: null });
        },
        update: (patch: Record<string, unknown>) => ({
          eq: (col: string, val: unknown) => {
            rows.filter((r) => r[col] === val).forEach((r) => Object.assign(r, patch));
            return Promise.resolve({ data: null, error: null });
          },
        }),
        then: (resolve: (v: unknown) => void) => {
          const found = rows.filter((r) => filters.every((f) => f(r)));
          resolve(countMode && head ? { count: found.length, error: null } : { data: found, error: null });
        },
      });
      return api;
    },
  };
}

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name} ${detail}`); }
};

const supa = makeClient();
const ctx = (await loadDynamicPricingContext(supa))!;
check("context loads (config v1, 4 zones, pay rates 35/40)",
  ctx.configVersion === 1 && ctx.zones.length === 4 &&
  ctx.payRates.soloFoundationPercent === 35 && ctx.payRates.crewFoundationPercent === 40);

// Zone resolution paths
const rA = await resolveZoneForZip(supa, "20814", ctx.zones);
check("mapped Bethesda zip → Zone A ×1.15", rA.served && rA.zone?.code === "A" && rA.zone?.multiplier === 1.15);
const rDef = await resolveZoneForZip(supa, "20874", ctx.zones);
check("served-but-unmapped zip → default Zone B (flagged)", rDef.served && rDef.zone?.code === "B" && rDef.defaulted);
const rOut = await resolveZoneForZip(supa, "99999", ctx.zones);
check("out-of-area zip → waitlist, no quote", !rOut.served && !!rOut.message);
const rInactive = await resolveZoneForZip(supa, "20899", ctx.zones);
check("inactive-coverage zip → waitlist", !rInactive.served);
const rNotServed = await resolveZoneForZip(supa, "20999", ctx.zones);
check("zip mapped to a not_served zone → waitlist", !rNotServed.served);

// Full server quote (shadow mode ON in seed → demand logged, not charged)
const quote = await computeServerQuote(supa, ctx, {
  zip: "20814", serviceType: "standard", homeSizeId: "1501_2000", condition: "standard",
  addOns: [], serviceDate: "2026-08-08", quotedBy: "test-va",
});
check("quote ok in Zone A", quote.ok && quote.breakdown?.zoneCode === "A");
check("shadow: charged = base×cond×zone only ($343.56)", quote.breakdown?.totalCents === 34356,
  `got ${quote.breakdown?.totalCents}`);
check("shadow multiplier logged on the quote", (quote.breakdown?.shadowDemandMultiplier || 1) !== 1);
check("audit row written", tables.price_quote_audit.length === 1);
check("audit stores breakdown + config version",
  (tables.price_quote_audit[0] as { config_version: number }).config_version === 1);

// Busy vs idle date targets (live demand math)
const busy = await resolveDemand(supa, ctx.config, ctx.zones[0], "2026-08-08", { persist: false });
const idle = await resolveDemand(supa, ctx.config, ctx.zones[0], "2026-08-11", { persist: false });
check("busy Saturday targets higher than idle Tuesday", busy.target > idle.target,
  `busy ${busy.target} vs idle ${idle.target}`);
check("both targets inside [0.90, 1.25]",
  busy.target <= 1.25 && busy.target >= 0.9 && idle.target <= 1.25 && idle.target >= 0.9);

// Rate limiting persists state and constrains movement
tables.demand_rate_state.length = 0;
const first = await resolveDemand(supa, ctx.config, ctx.zones[0], "2026-08-08", { persist: true });
check("rate state persisted", tables.demand_rate_state.length === 1);
// Push the stored state far from target with a 30-minute-old timestamp:
Object.assign(tables.demand_rate_state[0], {
  multiplier: 0.9, updated_at: new Date(Date.now() - 30 * 60_000).toISOString(),
});
const second = await resolveDemand(supa, ctx.config, ctx.zones[0], "2026-08-08", { persist: true });
check("movement limited to ≤ 0.025 per 30min", Math.abs(second.multiplier - 0.9) <= 0.0251,
  `moved to ${second.multiplier}`);
check("identical immediate re-request ≈ same multiplier",
  Math.abs((await resolveDemand(supa, ctx.config, ctx.zones[0], "2026-08-08", { persist: true })).multiplier - second.multiplier) < 0.001);

// Members exempt even when demand is live
const liveCfg = structuredClone(ctx.config);
liveCfg.demand.enabled = true;
const memberQuote = await computeServerQuote(supa, { ...ctx, config: liveCfg }, {
  zip: "21204", serviceType: "standard", homeSizeId: "1501_2000", condition: "standard",
  addOns: [], serviceDate: "2026-08-08", membershipPlan: "biweekly", quotedBy: "test-va",
});
check("member visit: zone applies, demand exempt",
  memberQuote.ok && memberQuote.breakdown?.demandMode === "exempt_member" &&
  memberQuote.breakdown?.membership?.monthlyCents === 28710);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) Deno.exit(1);

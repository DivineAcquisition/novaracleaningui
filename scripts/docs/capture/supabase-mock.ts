// ─── Supabase interception for documentation screenshots ───────────────────
//
// The admin workspace is real code talking to a real database. For the
// documentation screenshots we want the FIRST of those and none of the
// second: the actual admin components, rendered exactly as they ship, with
// invented data.
//
// So the capture harness intercepts every request the browser makes to the
// Supabase project and answers it from scripts/docs/capture/demo-data.ts.
// Two consequences worth being explicit about:
//
//   1. No credential is needed to capture, and no production row can leak
//      into an image — the real project is never reached from the browser.
//   2. What you see IS the current screen. The React components, their
//      labels, their layout and their conditional states are the shipped
//      ones; only the rows behind them are fake.
//
// The one deliberate exception is `quote-dynamic-price`: rather than invent a
// price, the handler runs the REAL pricing engine (src/lib/dynamic-pricing.ts)
// over the live config snapshot, so the numbers in the pricing screenshot are
// the same numbers the guide's worked example quotes.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Route, Request as PWRequest } from "playwright";

import {
  computeQuote,
  type ConditionLevel,
  type DemandResolution,
  type DynamicPricingConfig,
  type DynamicServiceType,
  type FloorPayRates,
  type MembershipPlanId,
  type ZoneInfo,
} from "../../../src/lib/dynamic-pricing";
import * as demo from "./demo-data";

const ROOT = resolve(__dirname, "../../..");
const SNAPSHOT = resolve(ROOT, "docs/admin-workspace/_data/pricing-snapshot.json");

const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as {
  config: DynamicPricingConfig;
  config_version: number;
  zones: ZoneInfo[];
  cleaner_pay_rates: Array<{
    pay_tier: string;
    rate_percent: number;
    min_crew_size: number;
    max_crew_size: number | null;
  }>;
  focused_same_day_settings: Record<string, unknown>;
};

const payRates: FloorPayRates = (() => {
  const r: FloorPayRates = { soloFoundationPercent: 35, crewFoundationPercent: 40 };
  for (const row of snapshot.cleaner_pay_rates.filter((x) => x.pay_tier === "foundation")) {
    const max = row.max_crew_size == null ? Infinity : row.max_crew_size;
    if (row.min_crew_size <= 1 && 1 <= max) r.soloFoundationPercent = row.rate_percent;
    if (row.min_crew_size <= 2 && 2 <= max) r.crewFoundationPercent = row.rate_percent;
  }
  return r;
})();

const ZIP_ZONES: Record<string, string> = {
  "20814": "A",
  "20816": "A",
  "20817": "A",
  "22201": "A",
  "21044": "B",
  "21045": "B",
  "20850": "B",
  "20744": "B",
  "21701": "C",
  "21702": "C",
};

// ─── Table fixtures ────────────────────────────────────────────────────────

/**
 * Enough of PostgREST's query grammar to keep a screen internally consistent.
 * Without it every count query returns the whole table and the tiles
 * contradict each other ("5 bookings today, 5 of them completed"), which
 * would make the screenshots teach the wrong thing.
 */
function applyQuery(rows: any[], url: URL): any[] {
  let out = [...rows];

  for (const [key, raw] of url.searchParams.entries()) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    const [op, ...rest] = raw.split(".");
    const value = rest.join(".");
    const cmp = (r: any) => r?.[key];

    switch (op) {
      case "eq":
        out = out.filter((r) => String(cmp(r)) === value);
        break;
      case "neq":
        out = out.filter((r) => String(cmp(r)) !== value);
        break;
      case "gte":
        out = out.filter((r) => cmp(r) != null && String(cmp(r)) >= value);
        break;
      case "lte":
        out = out.filter((r) => cmp(r) != null && String(cmp(r)) <= value);
        break;
      case "gt":
        out = out.filter((r) => cmp(r) != null && String(cmp(r)) > value);
        break;
      case "lt":
        out = out.filter((r) => cmp(r) != null && String(cmp(r)) < value);
        break;
      case "is":
        out = out.filter((r) => (value === "null" ? cmp(r) == null : Boolean(cmp(r)) === (value === "true")));
        break;
      case "in": {
        const set = value
          .replace(/^\(|\)$/g, "")
          .split(",")
          .map((v) => v.replace(/^"|"$/g, ""));
        out = out.filter((r) => set.includes(String(cmp(r))));
        break;
      }
      case "ilike":
        out = out.filter((r) =>
          String(cmp(r) ?? "").toLowerCase().includes(value.replace(/[%*]/g, "").toLowerCase()),
        );
        break;
      default:
        break; // unknown operators are ignored rather than emptying the screen
    }
  }

  const order = url.searchParams.get("order");
  if (order) {
    const [col, dir] = order.split(".");
    out.sort((a, b) => {
      const av = a?.[col];
      const bv = b?.[col];
      if (av === bv) return 0;
      const res = av == null ? -1 : bv == null ? 1 : av > bv ? 1 : -1;
      return dir === "desc" ? -res : res;
    });
  }

  const limit = url.searchParams.get("limit");
  if (limit) out = out.slice(0, Number(limit));

  return out;
}

/** Thirty days of plausible trend data for the dashboard chart. */
const dailyMetrics = Array.from({ length: 30 }, (_, i) => {
  const day = demo.DEMO_DATES.iso(i - 29);
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  const weekend = dow === 0 || dow === 6;
  const created = weekend ? 2 + (i % 3) : 4 + (i % 5);
  return {
    day,
    bookings_created: created,
    jobs_completed: Math.max(1, created - 1),
    revenue_completed_cents: (created - 1) * 29875,
    new_leads: created + 2,
  };
});

const eventsFeed = [
  {
    id: "ef1",
    event_type: "booking_created",
    occurred_at: demo.DEMO_DATES.ts(0, 14),
    summary: "New booking #10245 — Standard Clean, Rockville",
    contact_name: "Elena Marsh",
    cleaner_name: null,
  },
  {
    id: "ef2",
    event_type: "offer_sent",
    occurred_at: demo.DEMO_DATES.ts(0, 13),
    summary: "Offer sent for booking #10241",
    contact_name: "Jordan Reyes",
    cleaner_name: "Dana Whitfield",
  },
  {
    id: "ef3",
    event_type: "job_accepted",
    occurred_at: demo.DEMO_DATES.ts(0, 12),
    summary: "Offer accepted for booking #10242",
    contact_name: "Priya Anand",
    cleaner_name: "Luis Ortega",
  },
  {
    id: "ef4",
    event_type: "booking_completed",
    occurred_at: demo.DEMO_DATES.ts(-1, 17),
    summary: "Booking #10238 marked complete",
    contact_name: "Marcus Webb",
    cleaner_name: "Dana Whitfield",
  },
  {
    id: "ef5",
    event_type: "sms_out",
    occurred_at: demo.DEMO_DATES.ts(-1, 16),
    summary: "Arrival window reminder sent",
    contact_name: "Jordan Reyes",
    cleaner_name: null,
  },
];

const TABLES: Record<string, unknown[]> = {
  bookings: demo.bookings,
  daily_metrics_v1: dailyMetrics,
  events_feed_v1: eventsFeed,
  dispatch_alerts: [],
  cleaners: demo.cleaners,
  customers: demo.customers,
  crews: demo.crews,
  events: demo.events,
  qc_issues: demo.qcIssues,
  job_documentation: demo.jobDocumentation,
  customer_recurring_schedules: demo.recurringSchedules,
  business_accounts: demo.businessAccounts,
  va_onboarding: demo.vaOnboarding,
  leads: [],
  job_assignments: [],
  availability: [],
  availability_slots: [],
  app_settings: [
    { key: "focused_same_day_settings", value: snapshot.focused_same_day_settings },
    { key: "contractor_addons_enabled", value: false },
    { key: "dispatch_auto_offers_enabled", value: false },
  ],
  pricing_zones: snapshot.zones,
  cleaner_pay_rates: snapshot.cleaner_pay_rates,
  dynamic_pricing_config_versions: [
    {
      version: snapshot.config_version,
      is_active: true,
      config: snapshot.config,
      note: "Condition multipliers → L 1 / S 1.25 / H 1.6",
      created_at: demo.DEMO_DATES.ts(-27),
      created_by: null,
    },
  ],
  pricing_zone_zips: Object.entries(ZIP_ZONES).map(([zip, code]) => ({
    zip,
    zone_id: snapshot.zones.find((z) => z.code === code)?.id,
  })),
  price_overrides: [],
  price_quote_audit: [],
  membership_credits: [],
  geocode_cache: [],
  scope_adjustments: [],
  qc_issue_events: [],
  weekly_reports: [],
  user_roles: demo.teamMembers.flatMap((m) => m.roles.map((role) => ({ user_id: m.user_id, role }))),
};

// ─── RPC fixtures ──────────────────────────────────────────────────────────

const RPCS: Record<string, unknown> = {
  is_admin_or_va: true,
  has_role: true,
  get_customer_credit_balance_by_email: { balance_cents: 5000 },
  airtable_queue_stats: [{ pending: 0, dead: 0, synced_24h: 128 }],
  suggest_coverage_cleaners: [],
  compute_crew_pay: [],
};

// ─── Edge function fixtures ────────────────────────────────────────────────

function quoteDynamicPrice(body: Record<string, any>) {
  const config = JSON.parse(JSON.stringify(snapshot.config)) as DynamicPricingConfig;

  // Mirror the server's load-time overlay so focused rates / the same-day fee
  // come from app_settings, exactly as production does.
  const s = snapshot.focused_same_day_settings as Record<string, any>;
  const toCents = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) : null);
  if (Array.isArray(s.areas) && s.areas.length) {
    config.focused_clean.areas = s.areas.map((a: any) => ({
      id: String(a.id),
      label: String(a.label || a.id),
      price_cents: toCents(a.price)!,
      quantity: Boolean(a.quantity),
    }));
  }
  const min = toCents(s.minimum_dollars);
  if (min != null) config.focused_clean.minimum_cents = min;
  const sameDay = toCents(s.same_day_upcharge_dollars);
  if (sameDay != null) config.surcharges.same_day_cents = sameDay;

  const zip = String(body.zip || "").slice(0, 5);
  const zoneCode = ZIP_ZONES[zip];
  const meta = {
    configVersion: snapshot.config_version,
    demandEnabled: config.demand.enabled,
    shadowMode: config.demand.shadow_mode,
    conditionMultipliers: config.condition_multipliers,
    overrideReasons: config.override_reasons,
    overrideBandPercent: config.guardrails.override_band_percent,
    quoteLockHours: config.guardrails.quote_lock_hours,
    baseTables: {
      authoritative: config.base_tables.authoritative,
      reconciled: config.base_tables.reconciled,
    },
    focusedClean: {
      areas: config.focused_clean.areas,
      minimum_cents: config.focused_clean.minimum_cents,
      bundle_discount_percent: config.focused_clean.bundle_discount_percent,
      demand_enabled: config.focused_clean.demand_enabled,
    },
    sameDayCents: config.surcharges.same_day_cents,
    focusedSettingsLinked: true,
  };

  if (!zoneCode) {
    return {
      waitlist: true,
      message:
        "We don't currently serve this area. Offer the customer the expansion waitlist — they'll be first in line when coverage opens.",
      meta,
    };
  }
  const zone = snapshot.zones.find((z) => z.code === zoneCode)!;

  const demandMode: DemandResolution["mode"] = config.demand.enabled
    ? "live"
    : config.demand.shadow_mode
      ? "shadow"
      : "off";
  const demand: DemandResolution = { mode: demandMode, multiplier: 1, reasons: [] };

  const breakdown = computeQuote(
    config,
    zone,
    {
      serviceType: (body.serviceType || "standard") as DynamicServiceType,
      homeSizeId: body.homeSizeId ?? null,
      focused: body.focused ?? null,
      condition: (body.condition || "standard") as ConditionLevel,
      addOns: body.addOns || [],
      // Never flag same-day in a screenshot run: capture dates are relative
      // and a stray surcharge would make the image disagree with the guide.
      sameDay: false,
      membershipPlan: (body.membershipPlan || "none") as MembershipPlanId,
      firstMonth: Boolean(body.firstMonth),
    },
    demand,
    payRates,
  );

  return {
    ok: breakdown.ok,
    message: breakdown.error,
    zone: {
      code: zone.code,
      name: zone.name,
      multiplier: zone.multiplier,
      travel_minutes: zone.travel_minutes,
      defaulted: false,
    },
    breakdown,
    demand: { mode: demandMode, multiplier: 1, target: 1, reasons: [] },
    alternatives: [],
    meta,
    lock: null,
    reprice: null,
  };
}

const FUNCTIONS: Record<string, (body: any) => unknown> = {
  "quote-dynamic-price": quoteDynamicPrice,
  "admin-list-bookings": () => ({ bookings: demo.bookings, total: demo.bookings.length }),
  "admin-list-jobs": () => ({ jobs: [], bookingsNeedingDispatch: [], addonRequests: [] }),
  "admin-booking-assign": (body) =>
    body?.action === "list_directory"
      ? { cleaners: demo.cleaners }
      : body?.action === "suggest_cleaners"
        ? { suggestions: demo.cleaners.slice(0, 2) }
        : { ok: true },
  "admin-cleaner-jobs": () => ({ offers: [], jobs: [] }),
  "cleaner-scores-admin": (body) =>
    body?.action === "risk_flags"
      ? { flags: [] }
      : {
          weights: { acceptance: 40, workload: 30, volume: 30, reliability: 60, quality: 40 },
        },
  "cleaner-accountability": (body) =>
    body?.action === "dashboard"
      ? { watchlist: [], repeatOffenders: [], settings: { strike_expiry_months: 6 } }
      : { actions: [], settings: { strike_expiry_months: 6 } },
  "admin-memberships": () => ({ members: [] }),
  "payroll-operations": () => ({ cleaners: demo.cleaners.filter((c) => c.status === "active"), jobs: [] }),
  "admin-extra-pay": () => ({ payments: [] }),
  "qc-issues": () => ({ issues: demo.qcIssues }),
  "qc-reclean": () => ({ report: { requests: 0, absorbedCents: 0, qualityMisses: 0, serialRequesters: [] } }),
  "apploye-live-tracking": () => ({ configured: false, cleaners: [] }),
  "admin-create-team-user": () => ({ members: demo.teamMembers }),
  "admin-va-provision": () => ({ records: demo.vaOnboarding }),
};

// ─── API-route fixtures (Next.js server routes need a service-role key) ────

/**
 * Several admin API routes are action-dispatched and return the payload at
 * the top level (the caller does `setSummary(await callApi("summary"))`), so
 * a single canned object per URL is not enough — the fixture has to answer
 * per action or the screen crashes on a missing field.
 */
function demoVa(id: string, name: string, email: string, startOffsetDays: number) {
  return {
    id,
    name,
    email,
    status: "approved",
    performanceStatus: "on_track",
    payType: "hourly",
    rateCents: null,
    startDate: demo.DEMO_DATES.iso(startOffsetDays),
    functionsAssigned: ["operations"],
    apployeMemberId: "demo-apploye-member",
    ghlUserId: "demo-ghl-user",
    workspaceUserId: id,
  };
}

const API_ROUTES: Record<string, unknown | ((body: Record<string, any>) => unknown)> = {
  "/api/payroll/custom": (body) => {
    switch (body.action) {
      case "summary":
        return {
          totals: { week: 41250, month: 186400, year: 1204800 },
          profitTotals: { week: 58900, month: 271300, year: 1742600 },
          revenueTotals: { week: 100150, month: 457700, year: 2947400 },
          pending: { cents: 12800, count: 2 },
          roster: [],
          recent: [
            {
              id: "mp1",
              cleaner_name: "Dana Whitfield",
              created_at: demo.DEMO_DATES.ts(-1),
              revenue_cents: 29875,
              payout_cents: 11054,
              status: "paid",
            },
            {
              id: "mp2",
              cleaner_name: "Luis Ortega",
              created_at: demo.DEMO_DATES.ts(-2),
              revenue_cents: 23625,
              payout_cents: 8741,
              status: "pending",
            },
          ],
        };
      case "jobs":
        return { jobs: [] };
      case "run_preview":
      case "preview":
        return { lines: [], availableCents: 0, owedCents: 0 };
      default:
        return { ok: true };
    }
  },
  "/api/va/performance/admin": (body) => {
    switch (body.action) {
      case "overview":
        return {
          ok: true,
          today: {
            workDate: demo.DEMO_DATES.iso(0),
            cutoffLocalTime: "17:30",
            pastCutoff: false,
            openFlagTotal: 2,
            rows: [
              {
                va: demoVa("va1", "Ops Assistant", "demo.ops.va@novaracleaning.com", -120),
                submission: {
                  id: "sub1",
                  vaId: "va1",
                  workDate: demo.DEMO_DATES.iso(0),
                  status: "submitted",
                  metrics: {
                    leads_contacted: 34,
                    quotes_sent: 6,
                    bookings_created: 3,
                    revenue_booked: 896,
                    jobs_completed: 2,
                  },
                  selects: { focus: "operations", blockers: "none", management: "no", cleaner_issues: "none" },
                  blockers: null,
                  cleanerIssueNotes: null,
                  pdfStatus: "generated",
                  driveUrl: null,
                  priorities: "1. Confirm Friday coverage\n2. Chase two deposits",
                  wins: "Recovered the Bethesda reschedule.",
                  escalations: null,
                  submittedAt: demo.DEMO_DATES.ts(0, 21),
                },
                verified: {
                  vaId: "va1",
                  workDate: demo.DEMO_DATES.iso(0),
                  values: {
                    hours_tracked: 7.5,
                    leads_responded: 32,
                    quotes_sent: 6,
                    bookings_created: 3,
                    revenue_booked_cents: 89625,
                    jobs_completed: 2,
                  },
                  provenance: {
                    hours_tracked: { source: "apploye", syncedAt: demo.DEMO_DATES.ts(0, 22), status: "ok" },
                    leads_responded: { source: "ghl", syncedAt: demo.DEMO_DATES.ts(0, 22), status: "ok" },
                    bookings_created: { source: "workspace", syncedAt: demo.DEMO_DATES.ts(0, 22), status: "ok" },
                  },
                  lastSyncedAt: demo.DEMO_DATES.ts(0, 22),
                },
                openFlags: 0,
                status: "submitted_on_time",
              },
              {
                va: demoVa("va2", "Sales Assistant", "demo.sales.va@novaracleaning.com", -38),
                submission: null,
                verified: null,
                openFlags: 2,
                status: "missing",
              },
            ],
          },
          vas: [
            demoVa("va1", "Ops Assistant", "demo.ops.va@novaracleaning.com", -120),
            demoVa("va2", "Sales Assistant", "demo.sales.va@novaracleaning.com", -38),
          ],
          settings: {
            timezone: "America/New_York",
            backdateDays: 1,
            cutoffLocalTime: "17:30",
            lockAfterHours: 36,
          },
          thresholds: {
            base: { pct: 20, abs: 10 },
            medium: { pct: 40, abs: 25 },
            high: { pct: 75, abs: 50 },
            repeat: { windowDays: 14, count: 3 },
          },
        };
      case "flag_queue":
        return { ok: true, flags: [] };
      default:
        return { ok: true };
    }
  },
};

const API_ROUTES_STATIC: Record<string, unknown> = {
  "/api/admin/schedule-risk": {
    risks: [],
    delayEvents: [],
    backups: [],
    coverage: { board: [], health: [], gaps: [] },
    variance: [],
    lateStarts: [],
    reliability: [],
    overrides: [],
    reassignments: [],
    settings: { timezone: "America/New_York" },
    counts: {
      atRisk: 0,
      notTold: 0,
      noShows: 0,
      sourcing: 0,
      uncovered: 0,
      strDaysExposed: 0,
    },
  },
  "/api/admin/airtable-health": {
    flows: [],
    queue: { pending: 0, dead: 0 },
    runs: [],
    flags: [],
    webhook: { mode: "webhook", healthy: true },
  },
  "/api/admin/crew-pay-rates": { rates: snapshot.cleaner_pay_rates },
  "/api/admin/commercial-pricing": {
    settings: {},
    facilityTypes: [],
    scopeLevels: [],
    sizeTiers: [],
  },
  "/api/admin/walkthroughs": { walkthroughs: [], summary: {} },
  "/api/admin/proposals": { deals: [], summary: {} },
  "/api/admin/scope-adjustment/report": { summary: {}, byReason: [], byCleaner: [], byCustomer: [] },
};

// ─── Route handler ─────────────────────────────────────────────────────────

function json(route: Route, body: unknown, extraHeaders: Record<string, string> = {}) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

function parseBody(request: PWRequest): Record<string, any> {
  try {
    const raw = request.postData();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** True when PostgREST was asked for a single object rather than an array. */
function wantsSingle(request: PWRequest): boolean {
  const accept = request.headers()["accept"] || "";
  return accept.includes("application/vnd.pgrst.object+json");
}

export async function handleSupabase(route: Route, request: PWRequest): Promise<void> {
  const url = new URL(request.url());
  const path = url.pathname;

  if (request.method() === "OPTIONS") {
    return route.fulfill({
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      },
      body: "",
    });
  }

  // ── auth ──
  if (path.startsWith("/auth/v1/")) {
    const user = {
      id: demo.DEMO_ADMIN.id,
      email: demo.DEMO_ADMIN.email,
      aud: "authenticated",
      role: "authenticated",
      app_metadata: { provider: "email" },
      user_metadata: { first_name: "Demo", last_name: "Admin" },
      created_at: new Date(Date.now() - 86_400_000 * 90).toISOString(),
    };
    if (path.includes("/user")) return json(route, user);
    return json(route, {
      access_token: "demo-access-token",
      refresh_token: "demo-refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user,
    });
  }

  // ── rpc ──
  if (path.startsWith("/rest/v1/rpc/")) {
    const name = path.split("/rest/v1/rpc/")[1];
    const value = name in RPCS ? RPCS[name] : null;
    return json(route, value);
  }

  // ── storage (avatars, photos) ──
  if (path.startsWith("/storage/")) {
    return route.fulfill({ status: 404, body: "" });
  }

  // ── edge functions ──
  if (path.startsWith("/functions/v1/")) {
    const name = path.split("/functions/v1/")[1].split("?")[0];
    const handler = FUNCTIONS[name];
    const body = handler ? handler(parseBody(request)) : { ok: true };
    return json(route, body);
  }

  // ── PostgREST tables ──
  if (path.startsWith("/rest/v1/")) {
    const table = path.split("/rest/v1/")[1].split("?")[0];
    const all = TABLES[table] ?? [];
    const rows = applyQuery(all as any[], url);

    if (request.method() !== "GET" && request.method() !== "HEAD") {
      // Writes are no-ops during capture — the screenshots are read-only
      // views, and a stray mutation should never be possible anyway.
      return json(route, wantsSingle(request) ? (rows[0] ?? {}) : []);
    }

    // count=exact / head:true — the client reads content-range, not the body.
    return json(route, wantsSingle(request) ? (rows[0] ?? null) : rows, {
      "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}`,
      "access-control-expose-headers": "content-range",
    });
  }

  return json(route, {});
}

export async function handleApiRoute(route: Route, request: PWRequest): Promise<void> {
  const url = new URL(request.url());
  const dynamic = Object.keys(API_ROUTES).find(
    (p) => url.pathname === p || url.pathname.startsWith(`${p}/`),
  );
  if (dynamic) {
    const entry = API_ROUTES[dynamic];
    const body = typeof entry === "function" ? entry(parseBody(request)) : entry;
    return json(route, body);
  }
  const stat = Object.keys(API_ROUTES_STATIC).find(
    (p) => url.pathname === p || url.pathname.startsWith(`${p}/`),
  );
  if (stat) return json(route, API_ROUTES_STATIC[stat]);
  return route.fallback();
}

export const SUPABASE_HOST_GLOB = "**://*.supabase.co/**";

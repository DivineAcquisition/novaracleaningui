// pl-sheet-sync
//
// Daily one-way mirror: Supabase → the branded P&L Google Sheet. Runs from
// pg_cron at 09:30 UTC (and on demand from the admin P&L page). Supabase is
// the system of record; the sheet is a refreshed view.
//
// Four data sets, four tabs, FIXED code-defined column mapping (no AI ever
// decides where money lands):
//   Jobs (derived from completed bookings + legacy STR turnovers)
//     → "Daily Log"       A:date B:client_type C:service_type D:client/property
//                          E:revenue F:cleaner_pay G:supplies H:other I:notes
//                          (J "Job Profit" is a sheet formula — never written)
//   pl_expenses → "Expenses & Reimb"  A:date B:type C:who D:description
//                          E:amount F:status G:paid_date   (H formula)
//   pl_ad_spend → "Ad Spend"          A:date B:platform C:spend D:leads
//                          E:booked F:notes                (G formula)
//   pl_eod_reports → "EOD"            A:date B:va C..H:counts I:revenue J:notes
//                          (K formula)
//
// Idempotency: full clean rewrite of each tab's DATA RANGE (A2:<lastCol>),
// sorted by date then id — re-running never duplicates; edits update in
// place. Only those ranges are touched: report tabs and formula columns are
// never written. Dates are emitted as literal YYYY-MM-DD text (RAW input) so
// the sheet's month roll-ups keep working. All payloads are built BEFORE any
// write, so an upstream failure leaves the sheet in its last good state.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { clearRange, getSheetsToken, listTabs, writeRange } from "../_shared/google-sheets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}
const log = (m: string, d?: unknown) =>
  console.log(`[pl-sheet-sync] ${m}${d === undefined ? "" : " " + JSON.stringify(d)}`);

// deno-lint-ignore no-explicit-any
type SB = any;

const TABS = {
  jobs: "Daily Log",
  expenses: "Expenses & Reimb",
  adSpend: "Ad Spend",
  eod: "EOD",
} as const;

// Data ranges (row 2 down; formula columns excluded). Generous row ceiling —
// the clear wipes stale rows when the dataset shrinks.
const MAX_ROWS = 10000;
const RANGES = {
  jobs: `'${TABS.jobs}'!A2:I${MAX_ROWS}`,
  expenses: `'${TABS.expenses}'!A2:G${MAX_ROWS}`,
  adSpend: `'${TABS.adSpend}'!A2:F${MAX_ROWS}`,
  eod: `'${TABS.eod}'!A2:J${MAX_ROWS}`,
} as const;

async function resolveSecret(supabase: SB, key: string): Promise<string> {
  try {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
    return ((data?.value as string) || Deno.env.get(key) || "").trim();
  } catch {
    return (Deno.env.get(key) || "").trim();
  }
}

const dollars = (cents: number | null | undefined) =>
  cents != null ? Math.round(Number(cents)) / 100 : 0;
const ymd = (v: string | null | undefined) => String(v || "").slice(0, 10);

// ─── Canonical enum mappings (sheet formulas match on literal text) ──────────

function clientTypeLabel(bookingType: string | null, partnerDetails: Record<string, unknown> | null): string {
  const t = String(bookingType || "");
  if (t === "commercial") return "Commercial";
  if (t === "office") return "Office";
  if (t === "str_turnover") return "STR";
  if (t === "partnership") {
    return String((partnerDetails as Record<string, unknown> | null)?.booking_type || "") === "str_turnover" ? "STR" : "Commercial";
  }
  return "Residential";
}

function serviceTypeLabel(serviceType: string | null, clientType: string): string {
  const s = String(serviceType || "").toLowerCase().replace(/[\s-]/g, "");
  if (s === "turnover" || s === "strturnover") return "Turnover";
  if (s === "deep") return "Deep";
  if (s === "moveinout" || s === "move_in_out") return "Move-In-Out";
  if (s === "recurring" || s === "membership") return "Recurring";
  if (s === "office" || (clientType === "Office")) return "Office Clean";
  if (s === "commercial" || clientType === "Commercial") return "Commercial Visit";
  if (s === "combo") return "Deep";
  return "Standard";
}

// ─── Build the four datasets (all rows computed before any write) ────────────

async function buildJobRows(supabase: SB, sinceYmd: string): Promise<(string | number)[][]> {
  const rows: Array<{ key: string; row: (string | number)[] }> = [];

  // Completed bookings — the primary job log.
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, booking_number, booking_type, partner_details, service_type, service_date, business_name, first_name, last_name, final_charge_cents, total_estimate_cents, cleaner_payout_cents, team_notes")
    .eq("status", "completed")
    .gte("service_date", sinceYmd)
    .order("service_date", { ascending: true })
    .limit(5000);

  const ids = (bookings || []).map((b: { id: string }) => b.id);
  // Real pay ledgers override the tier estimate (same rule as payroll/Airtable).
  const payByBooking = new Map<string, number>();
  const extrasByBooking = new Map<string, number>();
  if (ids.length > 0) {
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const [{ data: payouts }, { data: extras }] = await Promise.all([
        supabase.from("manual_payouts").select("booking_id, amount_cents, status").in("booking_id", chunk).neq("status", "cancelled"),
        supabase.from("job_extra_pay").select("booking_id, total_cents, status").in("booking_id", chunk).neq("status", "failed"),
      ]);
      for (const p of payouts || []) {
        payByBooking.set(p.booking_id, (payByBooking.get(p.booking_id) || 0) + (Number(p.amount_cents) || 0));
      }
      for (const e of extras || []) {
        extrasByBooking.set(e.booking_id, (extrasByBooking.get(e.booking_id) || 0) + (Number(e.total_cents) || 0));
      }
    }
  }

  for (const b of bookings || []) {
    const clientType = clientTypeLabel(b.booking_type, b.partner_details);
    const ref = b.booking_number ? `NOV-${String(b.booking_number).padStart(5, "0")}` : String(b.id).slice(0, 8);
    const client = String(b.business_name || `${b.first_name || ""} ${b.last_name || ""}`.trim() || "Client");
    const basePay = payByBooking.has(b.id) ? payByBooking.get(b.id)! : (Number(b.cleaner_payout_cents) || 0);
    const extras = extrasByBooking.get(b.id) || 0;
    rows.push({
      key: `${ymd(b.service_date)}|${b.id}`,
      row: [
        ymd(b.service_date),
        clientType,
        serviceTypeLabel(b.service_type, clientType),
        client,
        dollars(b.final_charge_cents ?? b.total_estimate_cents),
        dollars(basePay),
        0, // supplies/materials tracked via Expenses & Reimb, not per job
        dollars(extras), // extra pay (surge/OT/etc.) = other job cost
        ref,
      ],
    });
  }

  // Legacy STR turnover silo (completed turnovers not represented as bookings).
  const { data: turns } = await supabase
    .from("turnover_requests")
    .select("id, requested_date, price, property_id, host_id, status")
    .eq("status", "completed")
    .gte("requested_date", sinceYmd)
    .order("requested_date", { ascending: true })
    .limit(3000);
  const propIds = [...new Set((turns || []).map((t: { property_id: string | null }) => t.property_id).filter(Boolean))] as string[];
  const hostIds = [...new Set((turns || []).map((t: { host_id: string | null }) => t.host_id).filter(Boolean))] as string[];
  const [{ data: props }, { data: hosts }] = await Promise.all([
    propIds.length ? supabase.from("properties").select("id, nickname").in("id", propIds) : Promise.resolve({ data: [] }),
    hostIds.length ? supabase.from("hosts").select("id, name").in("id", hostIds) : Promise.resolve({ data: [] }),
  ]);
  const propName = new Map((props || []).map((p: { id: string; nickname: string | null }) => [p.id, p.nickname]));
  const hostName = new Map((hosts || []).map((h: { id: string; name: string | null }) => [h.id, h.name]));

  for (const t of turns || []) {
    rows.push({
      key: `${ymd(t.requested_date)}|${t.id}`,
      row: [
        ymd(t.requested_date),
        "STR",
        "Turnover",
        `${propName.get(t.property_id) || "STR unit"}${hostName.get(t.host_id) ? ` — ${hostName.get(t.host_id)}` : ""}`,
        Math.round((Number(t.price) || 0) * 100) / 100,
        0, // legacy-silo turnover pay is settled via batch payouts, not per-job
        0,
        0,
        `TURN-${String(t.id).slice(0, 8)}`,
      ],
    });
  }

  rows.sort((a, b) => a.key.localeCompare(b.key));
  return rows.map((r) => r.row);
}

async function buildExpenseRows(supabase: SB, sinceYmd: string): Promise<(string | number)[][]> {
  const { data } = await supabase
    .from("pl_expenses")
    .select("id, date, type, who, description, amount_cents, status, paid_date")
    .gte("date", sinceYmd)
    .order("date", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(5000);
  return (data || []).map((e: Record<string, unknown>) => [
    ymd(e.date as string),
    String(e.type),
    String(e.who || ""),
    String(e.description || ""),
    dollars(e.amount_cents as number),
    String(e.status),
    e.status === "Paid" && e.paid_date ? ymd(e.paid_date as string) : "",
  ]);
}

async function buildAdSpendRows(supabase: SB, sinceYmd: string): Promise<(string | number)[][]> {
  const { data } = await supabase
    .from("pl_ad_spend")
    .select("id, date, platform, spend_cents, leads_calls, booked_jobs, campaign_notes")
    .gte("date", sinceYmd)
    .order("date", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(5000);
  return (data || []).map((a: Record<string, unknown>) => [
    ymd(a.date as string),
    String(a.platform),
    dollars(a.spend_cents as number),
    a.leads_calls != null ? Number(a.leads_calls) : "",
    a.booked_jobs != null ? Number(a.booked_jobs) : "",
    String(a.campaign_notes || ""),
  ]);
}

async function buildEodRows(supabase: SB, sinceYmd: string): Promise<(string | number)[][]> {
  const { data } = await supabase
    .from("pl_eod_reports")
    .select("id, date, va_name, inbound_leads, bookings_closed, outbound_calls, apps_reviewed, phone_screens, complaints_issues, revenue_booked_cents, blockers_notes")
    .gte("date", sinceYmd)
    .order("date", { ascending: true })
    .order("va_name", { ascending: true })
    .limit(5000);
  return (data || []).map((r: Record<string, unknown>) => [
    ymd(r.date as string),
    String(r.va_name || ""),
    Number(r.inbound_leads) || 0,
    Number(r.bookings_closed) || 0,
    Number(r.outbound_calls) || 0,
    Number(r.apps_reviewed) || 0,
    Number(r.phone_screens) || 0,
    Number(r.complaints_issues) || 0,
    dollars(r.revenue_booked_cents as number),
    String(r.blockers_notes || ""),
  ]);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const sheetId = await resolveSecret(supabase, "PL_SHEET_ID");
    if (!sheetId) {
      log("skipped — PL_SHEET_ID not configured");
      return json({ ok: true, skipped: "sheet_not_configured" });
    }
    const since = (await resolveSecret(supabase, "PL_SYNC_SINCE")) || "2026-06-01";
    const impersonate = await resolveSecret(supabase, "GOOGLE_DRIVE_IMPERSONATE_EMAIL");

    const token = await getSheetsToken(impersonate || undefined);
    if (!token) return json({ ok: false, error: "sheets_token_failed" }, 200);

    // Fail fast with a clear message if the workbook is missing a tab.
    const tabs = await listTabs(token, sheetId);
    const missing = Object.values(TABS).filter((t) => !tabs.includes(t));
    if (missing.length > 0) {
      log("missing tabs", { missing, found: tabs });
      return json({ ok: false, error: `Workbook is missing tab(s): ${missing.join(", ")}` }, 200);
    }

    // Build ALL payloads before touching the sheet — a failure here leaves
    // the workbook in its last good state.
    const [jobRows, expenseRows, adRows, eodRows] = await Promise.all([
      buildJobRows(supabase, since),
      buildExpenseRows(supabase, since),
      buildAdSpendRows(supabase, since),
      buildEodRows(supabase, since),
    ]);

    // Clean rewrite per tab: clear the data range, then write from A2.
    // RAW keeps YYYY-MM-DD as literal text. Formula columns are outside
    // every range and are never touched.
    const writes: Array<[string, (string | number)[][]]> = [
      [RANGES.jobs, jobRows],
      [RANGES.expenses, expenseRows],
      [RANGES.adSpend, adRows],
      [RANGES.eod, eodRows],
    ];
    for (const [range, values] of writes) {
      await clearRange(token, sheetId, range);
      if (values.length > 0) {
        const startRange = range.split(":")[0]; // e.g. 'Daily Log'!A2
        await writeRange(token, sheetId, startRange, values);
      }
    }

    const summary = {
      jobs: jobRows.length,
      expenses: expenseRows.length,
      ad_spend: adRows.length,
      eod: eodRows.length,
      since,
    };
    log("synced", summary);
    await supabase.from("events").insert({
      event_type: "pl.sheet_synced",
      source: "pl-sheet-sync",
      summary: `P&L sheet mirrored: ${jobRows.length} jobs · ${expenseRows.length} expenses · ${adRows.length} ad spend · ${eodRows.length} EOD (since ${since}).`,
      data: summary,
    }).then(() => undefined, () => undefined);

    return json({ ok: true, ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    return json({ ok: false, error: msg }, 500);
  }
});

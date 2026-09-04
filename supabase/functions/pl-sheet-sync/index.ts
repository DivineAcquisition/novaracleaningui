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
//                          J:job_profit K:month_tag (YYYY-MM, written as values)
//   pl_expenses → "Expenses & Reimb"  A:date B:type C:who D:description
//                          E:amount F:status G:paid_date H:month_tag
//   pl_ad_spend → "Ad Spend"          A:date B:platform C:spend D:leads
//                          E:booked F:notes G:month_tag
//   va_eod_submissions + va_verified_metrics → "EOD"
//                          A:date B:va C..H:counts I:revenue J:notes K:month_tag
//     (legacy pl_eod_reports is retired — the live VA EOD system is the source)
//
// Month Tag and Job Profit used to be sheet formulas. Empty rows evaluated
// DATEVALUE/TEXT on a blank cell (Excel serial 0) and displayed "1899-12".
// Those columns are now written as values, and a wider clear wipes leftover
// formulas so a re-sync heals a busted workbook.
//
// Idempotency: full clean rewrite of each tab's DATA RANGE (A2:P),
// sorted by date then id — re-running never duplicates; edits update in
// place. Report tabs are never written. Dates are emitted as literal
// YYYY-MM-DD text (RAW input). All payloads are built BEFORE any write.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { clearRange, getSheetsToken, listTabs, readRange, writeRange } from "../_shared/google-sheets.ts";

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

// Per-tab data geometry. The branded template keeps its title in row 1 and
// the column headers around row 4 — the sync AUTO-DETECTS the header row
// (the row whose column A reads "Date") and writes data directly beneath it,
// so template redesigns can't get clobbered.
const MAX_ROWS = 10000;
// Wider than lastCol so leftover ARRAYFORMULA / Month Tag cells (the 1899-12
// ghost rows) are wiped even when they sit past the data we write.
const FORMULA_CLEAR_COL = "P";
const TAB_GEOMETRY = {
  jobs: { lastCol: "K", headers: ["Date", "Client Type", "Service Type", "Client / Property", "Revenue (Collected)", "Cleaner Pay", "Supplies / Materials", "Other Job Cost", "Notes", "Job Profit", "Month Tag"] },
  expenses: { lastCol: "H", headers: ["Date", "Type", "Who (Cleaner / VA / Vendor)", "Description", "Amount", "Status", "Paid Date", "Month Tag"] },
  adSpend: { lastCol: "G", headers: ["Date", "Platform", "Spend", "Leads / Calls", "Booked Jobs", "Campaign / Notes", "Month Tag"] },
  eod: { lastCol: "K", headers: ["Date", "VA Name", "Inbound Leads Handled", "Bookings Closed", "Outbound Calls", "Applications Reviewed", "Phone Screens", "Complaints / Issues", "Revenue Booked", "Blockers / Notes", "Month Tag"] },
} as const;

function monthTag(dateYmd: string | number): string {
  const s = ymd(String(dateYmd || ""));
  return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : "";
}

function withDerived(kind: keyof typeof TAB_GEOMETRY, row: (string | number)[]): (string | number)[] {
  const tag = monthTag(row[0]);
  if (kind === "jobs") {
    const profit = Math.round(
      ((Number(row[4]) || 0) - (Number(row[5]) || 0) - (Number(row[6]) || 0) - (Number(row[7]) || 0)) * 100,
    ) / 100;
    return [...row, profit, tag];
  }
  return [...row, tag];
}
const DEFAULT_HEADER_ROW = 4;

/** Find the header row (column A == "Date") within the first 10 rows. */
async function findHeaderRow(token: string, sheetId: string, tab: string): Promise<number> {
  try {
    const rows = await readRange(token, sheetId, `'${tab}'!A1:A10`);
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i]?.[0] ?? "").trim().toLowerCase() === "date") return i + 1;
    }
  } catch { /* fall through */ }
  return DEFAULT_HEADER_ROW;
}

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
    .select("id, booking_number, booking_type, partner_details, service_type, service_date, business_name, first_name, last_name, final_charge_cents, total_estimate_cents, cleaner_payout_cents, team_notes, is_reclean, reclean_of_booking_id")
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
    const ref = b.booking_number ? `NVC-${String(b.booking_number).padStart(4, "0")}` : String(b.id).slice(0, 8);
    const client = String(b.business_name || `${b.first_name || ""} ${b.last_name || ""}`.trim() || "Client");
    const basePay = payByBooking.has(b.id) ? payByBooking.get(b.id)! : (Number(b.cleaner_payout_cents) || 0);
    const extras = extrasByBooking.get(b.id) || 0;
    const recleanNote = b.is_reclean
      ? `RE-CLEAN (Spotless Guarantee)${b.reclean_of_booking_id ? ` of ${String(b.reclean_of_booking_id).slice(0, 8)}` : ""}`
      : "";
    rows.push({
      key: `${ymd(b.service_date)}|${b.id}`,
      row: [
        ymd(b.service_date),
        clientType,
        serviceTypeLabel(b.service_type, clientType),
        client,
        b.is_reclean ? 0 : dollars(b.final_charge_cents ?? b.total_estimate_cents),
        dollars(basePay),
        0, // supplies/materials tracked via Expenses & Reimb, not per job
        dollars(extras), // extra pay (surge/OT/etc.) = other job cost
        [ref, recleanNote].filter(Boolean).join(" · "),
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
  // Live VA EOD system (pl_eod_reports is retired). Counts come from
  // va_verified_metrics; blockers/notes from the submission. Drafts stay out
  // so the sheet only shows days a VA actually closed.
  const { data: submissions, error: sErr } = await supabase
    .from("va_eod_submissions")
    .select(
      "id, va_id, work_date, status, blockers, escalations, cleaner_issues, cleaner_issue_notes, wins, priorities, va:va_onboarding!va_eod_submissions_va_id_fkey(first_name, last_name, email)",
    )
    .gte("work_date", sinceYmd)
    .in("status", ["submitted", "reviewed", "flagged"])
    .order("work_date", { ascending: true })
    .limit(5000);
  if (sErr) throw new Error(`va_eod_submissions: ${sErr.message}`);

  const { data: verifiedRows, error: vErr } = await supabase
    .from("va_verified_metrics")
    .select(
      "va_id, work_date, inbound_leads, bookings_created, calls_placed, applications_reviewed, phone_screens_completed, revenue_booked_cents",
    )
    .gte("work_date", sinceYmd)
    .limit(5000);
  if (vErr) throw new Error(`va_verified_metrics: ${vErr.message}`);

  const verifiedByKey = new Map<string, Record<string, unknown>>();
  for (const v of verifiedRows || []) {
    verifiedByKey.set(`${v.va_id}|${ymd(v.work_date)}`, v as Record<string, unknown>);
  }

  const rows: Array<{ key: string; row: (string | number)[] }> = [];
  for (const r of submissions || []) {
    const vaRaw = r.va;
    const va = (Array.isArray(vaRaw) ? vaRaw[0] : vaRaw || {}) as Record<string, unknown>;
    const verified = verifiedByKey.get(`${r.va_id}|${ymd(r.work_date)}`) || {};
    const name = `${va.first_name || ""} ${va.last_name || ""}`.trim() || String(va.email || "VA");
    const cleanerIssues = String(r.cleaner_issues || "");
    const complaints = cleanerIssues === "Serious" ? 2 : cleanerIssues === "Minor" ? 1 : 0;
    const notes = [
      r.blockers ? `Blockers: ${r.blockers}` : "",
      r.escalations ? `Escalations: ${r.escalations}` : "",
      r.cleaner_issue_notes ? `Cleaner issues: ${r.cleaner_issue_notes}` : "",
      r.priorities ? `Priorities: ${r.priorities}` : "",
      r.wins ? `Wins: ${r.wins}` : "",
    ]
      .filter(Boolean)
      .join(" · ");

    rows.push({
      key: `${ymd(r.work_date)}|${name.toLowerCase()}|${r.id}`,
      row: [
        ymd(r.work_date),
        name,
        Number(verified.inbound_leads) || 0,
        Number(verified.bookings_created) || 0,
        Number(verified.calls_placed) || 0,
        Number(verified.applications_reviewed) || 0,
        Number(verified.phone_screens_completed) || 0,
        complaints,
        dollars(verified.revenue_booked_cents as number),
        notes,
      ],
    });
  }

  rows.sort((a, b) => a.key.localeCompare(b.key));
  return rows.map((r) => r.row);
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

    // Read-back verification: { action: "read" } returns the first rows of
    // each tab so the mirror can be audited without opening the sheet.
    const body = await req.json().catch(() => ({}));
    if (String(body?.action || "") === "read") {
      const out: Record<string, (string | number)[][]> = {};
      for (const [key, tab] of Object.entries(TABS)) {
        out[key] = await readRange(token, sheetId, `'${tab}'!A1:K12`).catch(() => []);
      }
      return json({ ok: true, preview: out });
    }

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

    // Clean rewrite per tab: locate the header row, ensure the header text
    // is intact (self-heals templates), clear the data range beneath it
    // (including leftover formula columns), then write values — Job Profit
    // and Month Tag included, so empty-row DATE formulas cannot resurrect
    // 1899-12. RAW keeps YYYY-MM-DD as literal text.
    const writes: Array<[keyof typeof TABS, (string | number)[][]]> = [
      ["jobs", jobRows],
      ["expenses", expenseRows],
      ["adSpend", adRows],
      ["eod", eodRows],
    ];
    for (const [key, values] of writes) {
      const tab = TABS[key];
      const geo = TAB_GEOMETRY[key];
      const headerRow = await findHeaderRow(token, sheetId, tab);
      // Self-heal: stray SYNCED rows above the header (recognizable by a
      // literal YYYY-MM-DD in column A — template text never looks like
      // that) get cleared so a past mis-write can't linger.
      try {
        const above = await readRange(token, sheetId, `'${tab}'!A2:A${Math.max(2, headerRow - 1)}`);
        for (let i = 0; i < above.length; i++) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(String(above[i]?.[0] ?? ""))) {
            await clearRange(token, sheetId, `'${tab}'!A${i + 2}:${FORMULA_CLEAR_COL}${i + 2}`);
          }
        }
      } catch { /* best-effort */ }
      // Keep the header row itself canonical (repairs any past damage).
      await writeRange(token, sheetId, `'${tab}'!A${headerRow}`, [[...geo.headers]]);
      const dataStart = headerRow + 1;
      await clearRange(token, sheetId, `'${tab}'!A${dataStart}:${FORMULA_CLEAR_COL}${MAX_ROWS}`);
      if (values.length > 0) {
        await writeRange(token, sheetId, `'${tab}'!A${dataStart}`, values.map((row) => withDerived(key, row)));
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

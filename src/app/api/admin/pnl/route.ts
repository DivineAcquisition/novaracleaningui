// ─── /api/admin/pnl ──────────────────────────────────────────────────────────
//
// Admin-only money picture that used to live only in the branded Google Sheet.
// GET  → monthly P&L + jobs + ad spend (same rules as pl-sheet-sync)
// POST { action: "sync_sheet" } → refresh the Google Sheet mirror now

import { NextResponse } from "next/server";

import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { isAdminUser } from "@/lib/va-performance/admin-check";
import {
  PNL_OPERATIONS_START,
  PNL_SHEET_URL_BASE,
  buildPnl,
  monthKey,
  type PnlAdSpend,
  type PnlBooking,
  type PnlExpense,
  type PnlExtra,
  type PnlPayout,
  ymdInZone,
} from "@/lib/pnl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function requireFullAdmin(req: Request) {
  const principal = await requireAdmin(req);
  if (!(await isAdminUser(principal.userId))) throw new AdminAuthError("Admins only.", 403);
  return principal;
}

async function loadPnl() {
  const sb = getAdminSupabase();
  const [{ data: sinceRow }, { data: sheetRow }, bookingsRes, adsRes, expensesRes] = await Promise.all([
    sb.from("app_secrets").select("value").eq("key", "PL_SYNC_SINCE").maybeSingle(),
    sb.from("app_secrets").select("value").eq("key", "PL_SHEET_ID").maybeSingle(),
    sb
      .from("bookings")
      .select(
        "id, booking_number, first_name, last_name, business_name, service_date, service_type, status, final_charge_cents, total_estimate_cents, cleaner_payout_cents, is_reclean, time_slot",
      )
      .gte("service_date", PNL_OPERATIONS_START)
      .in("status", ["completed", "confirmed", "assigned", "pending_payment", "pending_details"])
      .order("service_date", { ascending: true })
      .limit(5000),
    sb
      .from("pl_ad_spend")
      .select("date, platform, spend_cents, leads_calls, booked_jobs, campaign_notes")
      .gte("date", PNL_OPERATIONS_START)
      .order("date", { ascending: true })
      .limit(500),
    sb
      .from("pl_expenses")
      .select("date, type, who, description, amount_cents, status")
      .gte("date", PNL_OPERATIONS_START)
      .order("date", { ascending: true })
      .limit(2000),
  ]);

  const bookings = (bookingsRes.data || []) as PnlBooking[];
  const ids = bookings.map((b) => b.id);
  const payouts: PnlPayout[] = [];
  const extras: PnlExtra[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const [{ data: p }, { data: e }] = await Promise.all([
      chunk.length
        ? sb.from("manual_payouts").select("booking_id, amount_cents, status").in("booking_id", chunk).neq("status", "cancelled")
        : Promise.resolve({ data: [] }),
      chunk.length
        ? sb.from("job_extra_pay").select("booking_id, total_cents, status").in("booking_id", chunk).neq("status", "failed")
        : Promise.resolve({ data: [] }),
    ]);
    payouts.push(...((p || []) as PnlPayout[]));
    extras.push(...((e || []) as PnlExtra[]));
  }

  const since = String(sinceRow?.value || PNL_OPERATIONS_START).slice(0, 10) || PNL_OPERATIONS_START;
  const expenses = (expensesRes.data || []) as PnlExpense[];
  const built = buildPnl({
    bookings,
    payouts,
    extras,
    adSpend: (adsRes.data || []) as PnlAdSpend[],
    expenses,
    since,
    todayYmd: ymdInZone(new Date()),
  });

  const sheetId = String(sheetRow?.value || "").trim();
  return {
    ...built,
    expenses,
    since,
    sheetId,
    sheetUrl: sheetId ? `${PNL_SHEET_URL_BASE}${sheetId}` : null,
  };
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    await requireFullAdmin(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return NextResponse.json({ ok: false, error: e.message }, { status: e.status || 401 });
  }
  try {
    const month = new URL(req.url).searchParams.get("month");
    const data = await loadPnl();
    const all = month === "all";
    const selected =
      all ? "all" : month && data.months.some((m) => m.month === month) ? month : monthKey(data.todayYmd);
    return NextResponse.json({
      ok: true,
      todayYmd: data.todayYmd,
      since: data.since,
      sheetUrl: data.sheetUrl,
      months: data.months,
      selectedMonth: selected,
      jobs: all ? data.jobs : data.jobs.filter((j) => monthKey(j.serviceDate) === selected),
      ads: all ? data.ads : data.ads.filter((a) => monthKey(a.date) === selected),
      expenses: all ? data.expenses : data.expenses.filter((e) => monthKey(e.date) === selected),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Could not load P&L" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    await requireFullAdmin(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return NextResponse.json({ ok: false, error: e.message }, { status: e.status || 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "sync_sheet") {
    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured to sync the sheet." }, { status: 500 });
  }
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/functions/v1/pl-sheet-sync`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ source: "admin-pnl" }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || json.ok === false) {
      return NextResponse.json(
        { ok: false, error: String(json.error || `Sheet sync failed (${res.status})`) },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, ...json });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Sheet sync failed" },
      { status: 500 },
    );
  }
}

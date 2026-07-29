// ─── /api/admin/crew-pay-rates ───────────────────────────────────────────────
//
// Read and edit the crew-size pay rate table (crew-size bracket → tier → rate).
//
//   GET  → every bracket, plus the tiers in use
//   PUT  → update one bracket's rate
//   POST → add a bracket (e.g. splitting "2+" into "2" and "3+")
//   DELETE → remove a bracket
//
// Changing a rate here changes FUTURE calculations everywhere, because
// compute_crew_pay() reads this table at calculation time. Historical pay is
// unaffected: it was locked onto job_assignments at completion
// (pay_percentage_snapshot + crew_size_snapshot + pay_locked_at).
//
// The database refuses overlapping brackets for a tier via a gist exclusion
// constraint, so an ambiguous rate can't be saved — we surface that as a clear
// message rather than a raw constraint error.
//
// Admin/VA only.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS = "id, min_crew_size, max_crew_size, pay_tier, rate_percent, note, updated_at";

function overlapMessage(message: string): string {
  if (/cleaner_pay_rates_no_overlap|exclusion/i.test(message)) {
    return "That bracket overlaps one that already exists for this tier. Two rates could apply to the same crew size, so it was rejected — narrow the existing bracket first.";
  }
  if (/cleaner_pay_rates_rate_chk/i.test(message)) {
    return "A rate has to be between 0 and 100 percent.";
  }
  if (/cleaner_pay_rates_max_chk/i.test(message)) {
    return "The bracket's maximum crew size can't be smaller than its minimum.";
  }
  if (/cleaner_pay_rates_min_chk/i.test(message)) {
    return "The smallest crew size is 1.";
  }
  return message;
}

async function guard(req: Request) {
  try {
    return { principal: await requireAdmin(req), failure: null as NextResponse | null };
  } catch (e) {
    const err = e as AdminAuthError;
    return {
      principal: null,
      failure: NextResponse.json({ error: err.message }, { status: err.status || 401 }),
    };
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  const { failure } = await guard(req);
  if (failure) return failure;

  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("cleaner_pay_rates")
    .select(COLS)
    .order("min_crew_size", { ascending: true })
    .order("rate_percent", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, rates: data || [] });
}

export async function PUT(req: Request): Promise<NextResponse> {
  const { principal, failure } = await guard(req);
  if (failure) return failure;

  let body: { id?: string; ratePercent?: number; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const id = String(body.id || "").trim();
  const rate = Number(body.ratePercent);
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return NextResponse.json({ error: "A rate has to be between 0 and 100 percent." }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("cleaner_pay_rates")
    .update({
      rate_percent: rate,
      ...(body.note !== undefined ? { note: body.note || null } : {}),
      updated_at: new Date().toISOString(),
      updated_by: principal?.userId ?? null,
    })
    .eq("id", id)
    .select(COLS)
    .maybeSingle();
  if (error) return NextResponse.json({ error: overlapMessage(error.message) }, { status: 400 });
  if (!data) return NextResponse.json({ error: "That rate no longer exists." }, { status: 404 });

  return NextResponse.json({ ok: true, rate: data });
}

export async function POST(req: Request): Promise<NextResponse> {
  const { principal, failure } = await guard(req);
  if (failure) return failure;

  let body: {
    minCrewSize?: number;
    maxCrewSize?: number | null;
    payTier?: string;
    ratePercent?: number;
    note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const min = Number(body.minCrewSize);
  const max = body.maxCrewSize === null || body.maxCrewSize === undefined
    ? null
    : Number(body.maxCrewSize);
  const tier = String(body.payTier || "").toLowerCase().trim();
  const rate = Number(body.ratePercent);

  if (!Number.isFinite(min) || min < 1) {
    return NextResponse.json({ error: "The smallest crew size is 1." }, { status: 400 });
  }
  if (max !== null && (!Number.isFinite(max) || max < min)) {
    return NextResponse.json(
      { error: "The bracket's maximum crew size can't be smaller than its minimum." },
      { status: 400 },
    );
  }
  if (!tier) return NextResponse.json({ error: "A tier is required." }, { status: 400 });
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return NextResponse.json({ error: "A rate has to be between 0 and 100 percent." }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("cleaner_pay_rates")
    .insert({
      min_crew_size: min,
      max_crew_size: max,
      pay_tier: tier,
      rate_percent: rate,
      note: body.note || null,
      updated_by: principal?.userId ?? null,
    })
    .select(COLS)
    .maybeSingle();
  if (error) return NextResponse.json({ error: overlapMessage(error.message) }, { status: 400 });

  return NextResponse.json({ ok: true, rate: data });
}

export async function DELETE(req: Request): Promise<NextResponse> {
  const { failure } = await guard(req);
  if (failure) return failure;

  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const supabase = getAdminSupabase();
  // Refuse to leave a tier with no solo rate at all — every cleaner needs a
  // resolvable rate, and the fallback chain shouldn't be load-bearing.
  const { data: row } = await supabase
    .from("cleaner_pay_rates")
    .select("pay_tier, min_crew_size")
    .eq("id", id)
    .maybeSingle();
  if (row) {
    const { count } = await supabase
      .from("cleaner_pay_rates")
      .select("id", { count: "exact", head: true })
      .eq("pay_tier", (row as { pay_tier: string }).pay_tier);
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        {
          error:
            "That's the only bracket left for this tier. Removing it would leave those cleaners with no configured rate — add a replacement first.",
        },
        { status: 409 },
      );
    }
  }

  const { error } = await supabase.from("cleaner_pay_rates").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

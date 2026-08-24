// ─── /api/admin/commercial-pricing ─────────────────────────────────────────
//
// Read and edit the three commercial pricing inputs plus the tunables:
//
//   facility types   base cents per square foot
//   scope levels     multiplier + crew throughput (sqft per cleaner-hour)
//   size tiers       square-footage band -> multiplier
//   settings         walkthrough threshold, estimate range, crew model, zones
//
//   GET    → everything, in one payload
//   PUT    → update one row of one table, or the settings blob
//   POST   → add a facility type or a size tier band
//   DELETE → remove a facility type or a size tier band
//
// Changing a value here changes FUTURE quotes everywhere, because the pricing
// functions read these tables at quote time. Bookings already made are
// unaffected: the full breakdown was recorded on bookings.commercial_pricing,
// so an old job's number stays reproducible after the config moves.
//
// Admin/VA only.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { DEFAULT_COMMERCIAL_SETTINGS } from "@/lib/commercial-pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SETTINGS_KEY = "commercial_pricing_settings";

const TABLES = {
  facility_type: {
    table: "commercial_facility_types",
    cols: "id, key, label, base_rate_cents_per_sqft, description, sort_order, active, updated_at",
  },
  scope_level: {
    table: "commercial_scope_levels",
    cols: "id, key, label, multiplier, summary, sqft_per_cleaner_hour, sort_order, active, updated_at",
  },
  size_tier: {
    table: "commercial_size_tiers",
    cols: "id, label, min_sqft, max_sqft, multiplier, updated_at",
  },
} as const;

type Kind = keyof typeof TABLES;

function friendlyError(message: string): string {
  if (/commercial_size_tiers_no_overlap|exclusion/i.test(message)) {
    return "That band overlaps one that already exists. Two multipliers could apply to the same square footage, so it was rejected — narrow the existing band first.";
  }
  if (/commercial_size_tiers_max_chk/i.test(message)) {
    return "A band's maximum square footage can't be smaller than its minimum.";
  }
  if (/duplicate key|unique/i.test(message)) {
    return "That key is already in use. Pick a different one.";
  }
  if (/_mult_chk|_rate_chk/i.test(message)) {
    return "That value is outside the range the database will accept.";
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
  const [facilities, scopes, tiers, settings] = await Promise.all([
    supabase.from(TABLES.facility_type.table).select(TABLES.facility_type.cols).order("sort_order"),
    supabase.from(TABLES.scope_level.table).select(TABLES.scope_level.cols).order("sort_order"),
    supabase.from(TABLES.size_tier.table).select(TABLES.size_tier.cols).order("min_sqft"),
    supabase.from("app_settings").select("value").eq("key", SETTINGS_KEY).maybeSingle(),
  ]);

  const err = facilities.error || scopes.error || tiers.error;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    facilityTypes: facilities.data || [],
    scopeLevels: scopes.data || [],
    sizeTiers: tiers.data || [],
    settings: { ...DEFAULT_COMMERCIAL_SETTINGS, ...((settings.data?.value as object) || {}) },
  });
}

export async function PUT(req: Request): Promise<NextResponse> {
  const { principal, failure } = await guard(req);
  if (failure) return failure;

  let body: { kind?: string; id?: string; patch?: Record<string, unknown>; settings?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const supabase = getAdminSupabase();

  if (body.kind === "settings") {
    const incoming = body.settings || {};
    const merged: Record<string, number> = { ...DEFAULT_COMMERCIAL_SETTINGS };
    for (const key of Object.keys(DEFAULT_COMMERCIAL_SETTINGS)) {
      const n = Number(incoming[key]);
      if (Number.isFinite(n)) merged[key] = n;
    }
    if (merged.walkthrough_threshold_sqft < 0) {
      return NextResponse.json({ error: "The walkthrough threshold can't be negative." }, { status: 400 });
    }
    if (merged.estimate_range_pct < 0 || merged.estimate_range_pct >= 1) {
      return NextResponse.json(
        { error: "The estimate range is a fraction of the anchor — between 0 and 1 (0.20 is ±20%)." },
        { status: 400 },
      );
    }
    if (merged.min_crew_size < 1 || merged.max_crew_size < merged.min_crew_size) {
      return NextResponse.json({ error: "Crew sizes must start at 1, and the maximum can't be below the minimum." }, { status: 400 });
    }
    const { error } = await supabase.from("app_settings").upsert({
      key: SETTINGS_KEY,
      value: merged,
      updated_at: new Date().toISOString(),
      updated_by: principal?.userId ?? null,
    }, { onConflict: "key" });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, settings: merged });
  }

  const kind = body.kind as Kind;
  const spec = TABLES[kind];
  if (!spec) return NextResponse.json({ error: "Unknown kind." }, { status: 400 });
  const id = String(body.id || "").trim();
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const { data, error } = await supabase
    .from(spec.table)
    .update({
      ...(body.patch || {}),
      updated_at: new Date().toISOString(),
      updated_by: principal?.userId ?? null,
    })
    .eq("id", id)
    .select(spec.cols)
    .maybeSingle();
  if (error) return NextResponse.json({ error: friendlyError(error.message) }, { status: 400 });
  if (!data) return NextResponse.json({ error: "That row no longer exists." }, { status: 404 });

  return NextResponse.json({ ok: true, row: data });
}

export async function POST(req: Request): Promise<NextResponse> {
  const { principal, failure } = await guard(req);
  if (failure) return failure;

  let body: { kind?: string; row?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const kind = body.kind as Kind;
  const spec = TABLES[kind];
  if (!spec) return NextResponse.json({ error: "Unknown kind." }, { status: 400 });

  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from(spec.table)
    .insert({ ...(body.row || {}), updated_by: principal?.userId ?? null })
    .select(spec.cols)
    .maybeSingle();
  if (error) return NextResponse.json({ error: friendlyError(error.message) }, { status: 400 });

  return NextResponse.json({ ok: true, row: data });
}

export async function DELETE(req: Request): Promise<NextResponse> {
  const { failure } = await guard(req);
  if (failure) return failure;

  const url = new URL(req.url);
  const kind = (url.searchParams.get("kind") || "") as Kind;
  const id = url.searchParams.get("id") || "";
  const spec = TABLES[kind];
  if (!spec) return NextResponse.json({ error: "Unknown kind." }, { status: 400 });
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const supabase = getAdminSupabase();

  // Emptying a table would leave the quote engine falling back to shipped
  // defaults that nobody can see or edit — a worse failure than refusing.
  const { count } = await supabase.from(spec.table).select("id", { count: "exact", head: true });
  if ((count ?? 0) <= 1) {
    return NextResponse.json(
      { error: "That's the last row. Removing it would leave pricing with nothing configured — add a replacement first." },
      { status: 409 },
    );
  }

  const { error } = await supabase.from(spec.table).delete().eq("id", id);
  if (error) return NextResponse.json({ error: friendlyError(error.message) }, { status: 400 });

  return NextResponse.json({ ok: true });
}

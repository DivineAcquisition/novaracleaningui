import { NextResponse } from "next/server";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  DEFAULT_PULSE_CHECK_SETTINGS,
  parsePulseCheckSettings,
  PULSE_CHECK_SETTINGS_KEY,
} from "@/lib/pulse-check/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

async function loadSettings(supabase: ReturnType<typeof getAdminSupabase>) {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", PULSE_CHECK_SETTINGS_KEY)
    .maybeSingle();
  return parsePulseCheckSettings(data?.value ?? DEFAULT_PULSE_CHECK_SETTINGS);
}

export async function GET(req: Request): Promise<NextResponse> {
  const { failure } = await guard(req);
  if (failure) return failure;
  const supabase = getAdminSupabase();
  const settings = await loadSettings(supabase);
  const { data: latest } = await (supabase.from as any)("pulse_check_cycles")
    .select("id, started_at, interval_days, followup_days, token_ttl_days, qualifying_count, sent_count, completed_at")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return NextResponse.json({ ok: true, settings, latestCycle: latest || null });
}

export async function PUT(req: Request): Promise<NextResponse> {
  const { failure } = await guard(req);
  if (failure) return failure;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }
  const supabase = getAdminSupabase();
  const current = await loadSettings(supabase);
  const next = parsePulseCheckSettings({
    ...current,
    ...((body.settings && typeof body.settings === "object" ? body.settings : body) as object),
  });
  const { error } = await supabase.from("app_settings").upsert({
    key: PULSE_CHECK_SETTINGS_KEY,
    value: next,
    description:
      "Contractor pulse check. Recurring cycle for active contractors with zero assignments in the lookback.",
    updated_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, settings: next });
}

export async function POST(req: Request): Promise<NextResponse> {
  const { principal, failure } = await guard(req);
  if (failure || !principal) return failure!;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }
  const action = String(body.action || "").toLowerCase();
  const supabase = getAdminSupabase();

  if (action === "review") {
    const entryId = String(body.entryId || "").trim();
    if (!entryId) return NextResponse.json({ error: "Missing entry." }, { status: 400 });
    const note = String(body.note || "").trim().slice(0, 1000);
    const { error } = await (supabase.from as any)("pulse_check_entries")
      .update({
        admin_reviewed_at: new Date().toISOString(),
        admin_reviewed_by: principal.userId,
        admin_note: note || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", entryId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: `Unknown action '${action}'.` }, { status: 400 });
}

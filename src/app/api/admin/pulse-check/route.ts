import { NextResponse } from "next/server";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { sendAdminPulseCheck } from "@/lib/pulse-check/send";
import {
  DEFAULT_PULSE_CHECK_SETTINGS,
  parsePulseCheckSettings,
  PULSE_CHECK_SETTINGS_KEY,
} from "@/lib/pulse-check/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

async function idleCount(
  supabase: ReturnType<typeof getAdminSupabase>,
  lookbackDays: number,
): Promise<number | null> {
  const { data, error } = await (supabase.rpc as any)("pulse_check_idle_cleaner_ids", {
    p_lookback_days: lookbackDays,
  });
  if (error) return null;
  return Array.isArray(data) ? data.length : 0;
}

export async function GET(req: Request): Promise<NextResponse> {
  const { failure } = await guard(req);
  if (failure) return failure;
  const supabase = getAdminSupabase();
  const settings = await loadSettings(supabase);
  const [{ data: latest, error: latestErr }, count] = await Promise.all([
    (supabase.from as any)("pulse_check_cycles")
      .select(
        "id, started_at, interval_days, followup_days, token_ttl_days, qualifying_count, sent_count, completed_at, counts_toward_interval, source",
      )
      .eq("counts_toward_interval", true)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    idleCount(supabase, settings.interval_days),
  ]);
  let latestCycle = latest || null;
  if (latestErr) {
    const { data: fallback } = await (supabase.from as any)("pulse_check_cycles")
      .select("id, started_at, interval_days, followup_days, token_ttl_days, qualifying_count, sent_count, completed_at")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    latestCycle = fallback || null;
  }
  return NextResponse.json({
    ok: true,
    settings,
    latestCycle,
    idleCount: count,
  });
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

async function invokePulseRunner(body: Record<string, unknown>) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { ok: false as const, status: 500, error: "Pulse runner is not configured." };
  }
  const res = await fetch(`${url}/functions/v1/pulse-check-runner`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      apikey: key,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json?.error) {
    return {
      ok: false as const,
      status: res.status >= 400 ? res.status : 502,
      error: String(json?.error || "Pulse check runner failed."),
    };
  }
  return { ok: true as const, json };
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

  if (action === "run_cycle") {
    const dryRun = Boolean(body.dryRun || body.dry_run);
    const invoked = await invokePulseRunner({
      force: !dryRun,
      dryRun,
      source: "admin",
      startedBy: principal.userId,
    });
    if (!invoked.ok) {
      return NextResponse.json({ error: invoked.error }, { status: invoked.status });
    }
    return NextResponse.json({ ok: true, ...invoked.json });
  }

  if (action === "send_one") {
    const cleanerId = String(body.cleanerId || "").trim();
    if (!cleanerId) return NextResponse.json({ error: "Missing cleaner." }, { status: 400 });
    const settings = await loadSettings(supabase);
    const result = await sendAdminPulseCheck({
      supabase,
      cleanerId,
      actorId: principal.userId,
      settings,
      dryRun: Boolean(body.dryRun || body.dry_run),
    });
    if (result.ok === false) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: `Unknown action '${action}'.` }, { status: 400 });
}

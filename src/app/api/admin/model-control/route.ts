// ─── /api/admin/model-control ────────────────────────────────────────────
//
// Read and edit which model answers, per tier. Changes apply on the next
// request — the edge functions read this row at call time, so there is no
// redeploy and no cache to bust.
//
//   GET → settings, recent config versions, recent invocations, health rollup
//   PUT → save settings (writes a version row first)
//
// This endpoint NEVER accepts, stores, or returns an API key. Keys live in the
// secrets manager and are resolved by name at call time. It does report
// whether a key is present, so an operator can tell "not configured" apart
// from "configured but failing" without the value being exposed.
//
// Admin/VA only.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  MODEL_CONTROL_SETTINGS_KEY,
  mergeModelControl,
  type ModelControlSettings,
} from "@/lib/model-control";

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

/** Presence only — the value is never read into a response. */
async function keyPresence(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<{ anthropic: boolean; openai: boolean }> {
  const { data } = await supabase
    .from("app_secrets")
    .select("key, value")
    .in("key", ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
  const has = (k: string) =>
    Boolean((data || []).find((r) => r.key === k)?.value) ||
    Boolean(process.env[k as "ANTHROPIC_API_KEY" | "OPENAI_API_KEY"]);
  return { anthropic: has("ANTHROPIC_API_KEY"), openai: has("OPENAI_API_KEY") };
}

export async function GET(req: Request): Promise<NextResponse> {
  const { failure } = await guard(req);
  if (failure) return failure;

  const supabase = getAdminSupabase();
  const [settingsRow, versions, invocations, keys] = await Promise.all([
    supabase.from("app_settings").select("value").eq(
      "key",
      MODEL_CONTROL_SETTINGS_KEY,
    ).maybeSingle(),
    supabase
      .from("model_control_versions")
      .select("id, version, settings, previous_settings, change_summary, changed_by_name, created_at")
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("ai_model_invocations")
      .select(
        "id, surface, intent, provider, requested_tier, served_tier, served_model, resolved_model, fell_back, fallback_reason, latency_ms, ok, error, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(100),
    keyPresence(supabase),
  ]);

  const settings = mergeModelControl(settingsRow.data?.value);
  const rows = (invocations.data || []) as Array<{
    ok: boolean;
    fell_back: boolean;
    latency_ms: number | null;
  }>;

  return NextResponse.json({
    ok: true,
    settings,
    versions: versions.data || [],
    invocations: invocations.data || [],
    keys,
    health: {
      sampled: rows.length,
      failures: rows.filter((r) => !r.ok).length,
      fallbacks: rows.filter((r) => r.fell_back).length,
      medianLatencyMs: median(rows.map((r) => Number(r.latency_ms) || 0).filter(Boolean)),
    },
  });
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export async function PUT(req: Request): Promise<NextResponse> {
  const { principal, failure } = await guard(req);
  if (failure || !principal) return failure!;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // A key must never arrive here. If one does, refuse loudly rather than
  // quietly dropping it — the caller needs to know it was the wrong channel.
  const flat = JSON.stringify(body);
  if (/sk-ant-|sk-proj-|sk-[A-Za-z0-9]{20,}/.test(flat)) {
    return NextResponse.json(
      {
        error:
          "That looks like an API key. Keys are never stored in model configuration — put it in the deployment secrets store as ANTHROPIC_API_KEY or OPENAI_API_KEY. If it has been pasted anywhere outside a secrets manager, rotate it first.",
      },
      { status: 400 },
    );
  }

  const supabase = getAdminSupabase();
  const { data: currentRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", MODEL_CONTROL_SETTINGS_KEY)
    .maybeSingle();
  const current = mergeModelControl(currentRow?.value);

  const incoming = (body.settings && typeof body.settings === "object" ? body.settings : body) as Partial<ModelControlSettings>;
  const next = mergeModelControl({ ...current, ...incoming });

  for (const tier of ["default", "strongest", "fallback"] as const) {
    if (!next.tiers[tier]) {
      return NextResponse.json({ error: `The ${tier} tier needs a model.` }, { status: 400 });
    }
  }

  const summary = String(body.changeSummary || "").trim();
  if (!summary) {
    return NextResponse.json(
      { error: "Record why the model configuration changed — it is kept in history." },
      { status: 400 },
    );
  }

  // History first: a save that fails halfway leaves the record of intent.
  const { error: versionErr } = await supabase.from("model_control_versions").insert({
    settings: next,
    previous_settings: current,
    change_summary: summary,
    changed_by: principal.userId,
    changed_by_name: principal.email,
  });
  if (versionErr) return NextResponse.json({ error: versionErr.message }, { status: 500 });

  const { error } = await supabase.from("app_settings").upsert(
    {
      key: MODEL_CONTROL_SETTINGS_KEY,
      value: next,
      description:
        "Model routing by tier. default = general assistant, strongest = report and checklist insight generation plus money-adjacent assistant questions, fallback = degraded path when the strongest tier is unavailable. Admin-editable; applies on the next request with no redeploy. API keys are NOT stored here.",
      updated_at: new Date().toISOString(),
      updated_by: principal.userId,
    },
    { onConflict: "key" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await supabase.from("events").insert({
    event_type: "ai.model_control_changed",
    source: "model-control",
    summary: `${principal.email} changed model routing: default ${next.tiers.default}, strongest ${next.tiers.strongest}, fallback ${next.tiers.fallback}.`,
    data: { from: current, to: next, change_summary: summary },
  });

  return NextResponse.json({ ok: true, settings: next });
}

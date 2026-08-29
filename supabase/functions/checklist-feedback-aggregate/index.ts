// ─── checklist-feedback-aggregate ────────────────────────────────────────
//
// Monthly (pg_cron, 06:00 UTC on the 1st). Turns real outcomes into review
// prompts for a human. It does not touch checklist content — the only thing
// it writes is signal rows and insight rows.
//
// Pass 1  collect  — walk the records that already exist (re-cleans, QC cases,
//                    reviews, duration variance, recurrence) and write one
//                    signal row per (record, item). The unique constraint on
//                    (source_type, source_id, item_id) makes re-running safe.
// Pass 2  aggregate — count signal per item over the lookback window.
// Pass 3  gate      — drop anything under the minimum signal threshold. One
//                    bad job is not a pattern, and a queue full of noise is a
//                    queue nobody reads.
// Pass 4  surface   — grounded insights via the strongest configured model,
//                    each citing its own counts.
//
// Scope precision, deliberately:
//   • Re-clean and QC signals attach to a specific item — someone tagged it.
//   • Review keyword matches attach to an AREA (`area:<area>`), because
//     "the bathroom was bad" does not name a line item.
//   • Duration variance attaches to a CHECKLIST (`checklist:<key>`), because
//     a service type that chronically overruns is under-scoped as a whole,
//     not at one line.
// Those last two are carried as labeled context, never as an item's own count.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveSecret } from "../_shared/app-secrets.ts";
import {
  generateChecklistInsights,
  type AggregatedItem,
  type ItemSignalCounts,
} from "../_shared/checklist-insights.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const log = (step: string, detail?: unknown) =>
  console.log(`[checklist-feedback] ${step}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface Settings {
  aggregation_cadence: string;
  min_signal_threshold: number;
  lookback_days: number;
  max_insights: number;
  review_theme_keywords: Record<string, string[]>;
}

const DEFAULTS: Settings = {
  aggregation_cadence: "monthly",
  min_signal_threshold: 2,
  lookback_days: 90,
  max_insights: 12,
  review_theme_keywords: {},
};

function emptyCounts(): ItemSignalCounts {
  return {
    quality_miss: 0,
    scope_confusion: 0,
    qc_case: 0,
    review_theme: 0,
    duration_variance: 0,
    recurrence: 0,
  };
}

const AREA_PREFIX = "area:";
const CHECKLIST_PREFIX = "checklist:";

type SignalRow = {
  item_id: string;
  source_type: "qc_case" | "reclean" | "review_theme" | "duration_variance" | "recurrence";
  classification?: string | null;
  source_id: string | null;
  qc_issue_id?: string | null;
  booking_id?: string | null;
  job_id?: string | null;
  checklist_key?: string | null;
  area?: string | null;
  detail?: Record<string, unknown>;
  occurred_at: string;
};

// deno-lint-ignore no-explicit-any
async function loadSettings(sb: any): Promise<Settings> {
  const { data } = await sb
    .from("app_settings")
    .select("value")
    .eq("key", "checklist_feedback_settings")
    .maybeSingle();
  const raw = (data?.value || {}) as Partial<Settings>;
  return {
    aggregation_cadence: String(raw.aggregation_cadence || DEFAULTS.aggregation_cadence),
    min_signal_threshold: Math.max(1, Number(raw.min_signal_threshold) || DEFAULTS.min_signal_threshold),
    lookback_days: Math.max(7, Number(raw.lookback_days) || DEFAULTS.lookback_days),
    max_insights: Math.max(1, Number(raw.max_insights) || DEFAULTS.max_insights),
    review_theme_keywords: (raw.review_theme_keywords as Record<string, string[]>) || {},
  };
}

/** Re-cleans and QC cases — the tagged, item-specific signal. */
// deno-lint-ignore no-explicit-any
async function collectQcSignals(sb: any, since: string): Promise<SignalRow[]> {
  const { data, error } = await sb
    .from("qc_issues")
    .select(
      "id, booking_id, job_id, issue_type, details, created_at, checklist_item_ids, " +
        "reclean_checklist_item_ids, reclean_status, reclean_classification, reclean_verified_at",
    )
    .gte("created_at", since)
    .limit(2000);
  if (error) {
    log("qc read failed", error.message);
    return [];
  }

  const rows: SignalRow[] = [];
  for (const issue of (data || []) as Record<string, any>[]) {
    const occurred = String(issue.reclean_verified_at || issue.created_at);

    // Re-clean signal. Classification is carried verbatim — a scope-confusion
    // re-clean is never folded into the quality-miss count.
    const cls = issue.reclean_classification as string | null;
    const recleanItems: string[] = Array.isArray(issue.reclean_checklist_item_ids)
      ? issue.reclean_checklist_item_ids
      : [];
    if (
      cls && cls !== "pending" &&
      String(issue.reclean_status || "none") !== "none" &&
      recleanItems.length > 0
    ) {
      for (const itemId of recleanItems) {
        rows.push({
          item_id: itemId,
          source_type: "reclean",
          classification: cls,
          source_id: issue.id,
          qc_issue_id: issue.id,
          booking_id: issue.booking_id,
          job_id: issue.job_id,
          detail: { reclean_status: issue.reclean_status },
          occurred_at: occurred,
        });
      }
    }

    // QC case signal, for cases a reviewer tied to specific items.
    const caseItems: string[] = Array.isArray(issue.checklist_item_ids) ? issue.checklist_item_ids : [];
    for (const itemId of caseItems) {
      rows.push({
        item_id: itemId,
        source_type: "qc_case",
        source_id: issue.id,
        qc_issue_id: issue.id,
        booking_id: issue.booking_id,
        job_id: issue.job_id,
        detail: { issue_type: issue.issue_type },
        occurred_at: String(issue.created_at),
      });
    }

    // Recurrence: the same condition came back at the same property. That
    // points at an item's STANDARD being insufficient, not its absence.
    const details = (issue.details || {}) as Record<string, unknown>;
    const recurred = details.recurrence === true ||
      String(details.recurrence || "").toLowerCase() === "true" ||
      details.recurring === true;
    if (recurred && caseItems.length > 0) {
      for (const itemId of caseItems) {
        rows.push({
          item_id: itemId,
          source_type: "recurrence",
          source_id: issue.id,
          qc_issue_id: issue.id,
          booking_id: issue.booking_id,
          job_id: issue.job_id,
          detail: { issue_type: issue.issue_type, finding: details.finding_type ?? null },
          occurred_at: String(issue.created_at),
        });
      }
    }
  }
  return rows;
}

/**
 * Review themes. Keyword matched to an AREA and recorded as such — surfaced
 * for human interpretation, never auto-mapped to a specific item.
 */
// deno-lint-ignore no-explicit-any
async function collectReviewThemeSignals(
  sb: any,
  since: string,
  keywords: Record<string, string[]>,
): Promise<SignalRow[]> {
  const themes = Object.entries(keywords);
  if (themes.length === 0) return [];

  const { data, error } = await sb
    .from("qc_issues")
    .select("id, booking_id, job_id, description, title, created_at, reported_via")
    .in("reported_via", ["feedback", "customer", "review"])
    .gte("created_at", since)
    .limit(1000);
  if (error) {
    log("review read failed", error.message);
    return [];
  }

  const rows: SignalRow[] = [];
  for (const issue of (data || []) as Record<string, any>[]) {
    const blob = `${issue.title || ""} ${issue.description || ""}`.toLowerCase();
    if (!blob.trim()) continue;
    for (const [theme, words] of themes) {
      const hit = (words || []).some((w) => blob.includes(String(w).toLowerCase()));
      if (!hit) continue;
      rows.push({
        item_id: `${AREA_PREFIX}${theme}`,
        source_type: "review_theme",
        source_id: issue.id,
        qc_issue_id: issue.id,
        booking_id: issue.booking_id,
        job_id: issue.job_id,
        area: theme,
        detail: { theme, via: issue.reported_via },
        occurred_at: String(issue.created_at),
      });
    }
  }
  return rows;
}

/**
 * Duration variance, at CHECKLIST scope. A service type that chronically
 * overruns its projection is usually under-scoped as a whole; pinning that on
 * one line item would be invented precision.
 */
// deno-lint-ignore no-explicit-any
async function collectDurationSignals(sb: any, since: string): Promise<SignalRow[]> {
  const { data, error } = await sb
    .from("job_duration_actuals")
    .select("id, booking_id, job_id, service_type, variance_pct, recorded_at")
    .gte("recorded_at", since)
    .limit(3000);
  if (error) {
    log("duration read failed", error.message);
    return [];
  }

  const CHECKLIST_BY_SERVICE: Record<string, string> = {
    commercial: "commercial_standard",
    office: "office",
    turnover: "str_turnover",
    str_turnover: "str_turnover",
  };

  const rows: SignalRow[] = [];
  for (const rec of (data || []) as Record<string, any>[]) {
    const variance = Number(rec.variance_pct);
    // Only a material overrun counts. Coming in under projection is a pricing
    // question, not a checklist one.
    if (!Number.isFinite(variance) || variance < 15) continue;
    const key = CHECKLIST_BY_SERVICE[String(rec.service_type || "").toLowerCase()];
    if (!key) continue;
    rows.push({
      item_id: `${CHECKLIST_PREFIX}${key}`,
      source_type: "duration_variance",
      source_id: rec.id,
      booking_id: rec.booking_id,
      job_id: rec.job_id,
      checklist_key: key,
      detail: { variance_pct: variance, service_type: rec.service_type },
      occurred_at: String(rec.recorded_at),
    });
  }
  return rows;
}

// deno-lint-ignore no-explicit-any
async function persistSignals(sb: any, rows: SignalRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  let written = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error, count } = await sb
      .from("checklist_item_signals")
      .upsert(chunk, { onConflict: "source_type,source_id,item_id", ignoreDuplicates: true, count: "exact" });
    if (error) log("signal upsert failed", error.message);
    else written += count ?? chunk.length;
  }
  return written;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const cronSecret = await resolveSecret(sb, "CRON_SECRET");
    const headerSecret = req.headers.get("x-cron-secret") || "";
    if (cronSecret && headerSecret && headerSecret !== cronSecret) {
      return json({ ok: false, error: "Bad cron secret" }, 401);
    }

    const settings = await loadSettings(sb);
    const now = new Date();
    const since = new Date(now.getTime() - settings.lookback_days * 86400000).toISOString();
    const cycleStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const cycleEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    const cycleStartStr = cycleStart.toISOString().slice(0, 10);
    const cycleEndStr = cycleEnd.toISOString().slice(0, 10);
    const dryRun = body?.dryRun === true;

    // ── Pass 1: collect ───────────────────────────────────────────────────
    const [qc, reviews, durations] = await Promise.all([
      collectQcSignals(sb, since),
      collectReviewThemeSignals(sb, since, settings.review_theme_keywords),
      collectDurationSignals(sb, since),
    ]);
    const collected = [...qc, ...reviews, ...durations];
    const written = dryRun ? 0 : await persistSignals(sb, collected);
    log("collected", { candidates: collected.length, written });

    // ── Pass 2: aggregate ─────────────────────────────────────────────────
    const { data: signalRows, error: signalErr } = await sb
      .from("checklist_item_signals")
      .select("id, item_id, source_type, classification, booking_id, area, checklist_key, occurred_at")
      .gte("occurred_at", since)
      .limit(20000);
    if (signalErr) return json({ ok: false, error: signalErr.message }, 500);

    const { data: itemRows, error: itemErr } = await sb
      .from("checklist_items")
      .select("item_id, item_text, area, checklists, active")
      .eq("active", true);
    if (itemErr) return json({ ok: false, error: itemErr.message }, 500);

    const items = (itemRows || []) as Array<{
      item_id: string;
      item_text: string;
      area: string;
      checklists: string[];
    }>;
    if (items.length === 0) {
      return json({
        ok: true,
        skipped: "no checklist items synced yet — open Commercial → Checklists to seed the catalog",
      });
    }

    // Context buckets: area-level review themes, checklist-level duration.
    const areaThemes = new Map<string, number>();
    const checklistDuration = new Map<string, number>();
    const perItem = new Map<string, { counts: ItemSignalCounts; ids: string[]; bookings: Set<string> }>();

    for (const s of (signalRows || []) as Record<string, any>[]) {
      const id = String(s.item_id || "");
      if (id.startsWith(AREA_PREFIX)) {
        const area = id.slice(AREA_PREFIX.length);
        areaThemes.set(area, (areaThemes.get(area) || 0) + 1);
        continue;
      }
      if (id.startsWith(CHECKLIST_PREFIX)) {
        const key = id.slice(CHECKLIST_PREFIX.length);
        checklistDuration.set(key, (checklistDuration.get(key) || 0) + 1);
        continue;
      }
      let entry = perItem.get(id);
      if (!entry) {
        entry = { counts: emptyCounts(), ids: [], bookings: new Set() };
        perItem.set(id, entry);
      }
      entry.ids.push(String(s.id));
      if (s.booking_id) entry.bookings.add(String(s.booking_id));
      if (s.source_type === "reclean") {
        if (s.classification === "quality_miss") entry.counts.quality_miss += 1;
        else if (s.classification === "scope_confusion") entry.counts.scope_confusion += 1;
      } else if (s.source_type === "qc_case") entry.counts.qc_case += 1;
      else if (s.source_type === "recurrence") entry.counts.recurrence += 1;
    }

    // ── Pass 3: threshold gate ────────────────────────────────────────────
    //
    // The gate is per SIGNAL KIND, not the sum. Two quality-miss re-cleans is a
    // pattern; one quality-miss plus one unrelated QC case is two coincidences.
    const threshold = settings.min_signal_threshold;
    const aggregated: AggregatedItem[] = [];

    for (const item of items) {
      const entry = perItem.get(item.item_id);
      if (!entry) continue;
      const c = entry.counts;
      const crosses =
        c.quality_miss >= threshold ||
        c.scope_confusion >= threshold ||
        c.qc_case >= threshold ||
        c.recurrence >= threshold;
      if (!crosses) continue;

      // Labeled context — not part of the gate, and never presented as this
      // item's own count.
      const themeCount = areaThemes.get(item.area) || 0;
      const durationCount = (item.checklists || []).reduce(
        (n, key) => n + (checklistDuration.get(key) || 0),
        0,
      );

      aggregated.push({
        item_id: item.item_id,
        item_text: item.item_text,
        area: item.area,
        checklists: item.checklists || [],
        counts: { ...c, review_theme: themeCount, duration_variance: durationCount },
        total: c.quality_miss + c.scope_confusion + c.qc_case + c.recurrence,
        signal_ids: entry.ids,
        distinct_bookings: entry.bookings.size,
      });
    }

    aggregated.sort((a, b) =>
      b.counts.quality_miss - a.counts.quality_miss ||
      b.counts.scope_confusion - a.counts.scope_confusion ||
      b.total - a.total
    );

    if (aggregated.length === 0) {
      log("nothing crossed threshold", { threshold, items_with_signal: perItem.size });
      return json({
        ok: true,
        cycle: { start: cycleStartStr, end: cycleEndStr },
        signals_written: written,
        surfaced: 0,
        note: `No item reached ${threshold} signals of a single kind — isolated incidents are not surfaced.`,
      });
    }

    // ── Pass 4: surface ───────────────────────────────────────────────────
    const cycleLabel = `${cycleStartStr} → ${cycleEndStr}`;
    const result = await generateChecklistInsights(sb, aggregated, {
      cycleLabel,
      maxInsights: settings.max_insights,
    });

    if (dryRun) {
      return json({
        ok: true,
        dryRun: true,
        cycle: { start: cycleStartStr, end: cycleEndStr },
        candidates: aggregated.length,
        insights: result.insights,
        model: result.model,
      });
    }

    const byId = new Map(aggregated.map((a) => [a.item_id, a]));
    const payload = result.insights
      .filter((i) => byId.has(i.item_id))
      .map((i) => {
        const a = byId.get(i.item_id)!;
        return {
          item_id: a.item_id,
          cycle_start: cycleStartStr,
          cycle_end: cycleEndStr,
          checklist_keys: a.checklists,
          area: a.area,
          item_text_at_surface: a.item_text,
          counts: a.counts,
          quality_miss_count: a.counts.quality_miss,
          scope_confusion_count: a.counts.scope_confusion,
          qc_case_count: a.counts.qc_case,
          review_theme_count: a.counts.review_theme,
          duration_variance_count: a.counts.duration_variance,
          recurrence_count: a.counts.recurrence,
          signal_ids: a.signal_ids,
          observation: i.observation,
          numbers: i.numbers,
          hypothesis: i.hypothesis,
          model: result.model,
          model_version: result.model_version,
          status: "open",
        };
      });

    // Re-running the same cycle refreshes counts on rows nobody has acted on
    // yet, and leaves resolved rows alone.
    const { error: upsertErr } = await sb
      .from("checklist_insights")
      .upsert(payload, { onConflict: "item_id,cycle_start", ignoreDuplicates: false });
    if (upsertErr) return json({ ok: false, error: upsertErr.message }, 500);

    await sb.from("events").insert({
      event_type: "checklist.review_cycle_surfaced",
      source: "checklist-feedback",
      summary: `${payload.length} checklist item(s) surfaced for review — cycle ${cycleLabel}.`,
      data: {
        cycle_start: cycleStartStr,
        cycle_end: cycleEndStr,
        surfaced: payload.length,
        threshold,
        model: result.model,
      },
    });

    return json({
      ok: true,
      cycle: { start: cycleStartStr, end: cycleEndStr },
      signals_written: written,
      candidates: aggregated.length,
      surfaced: payload.length,
      model: result.model,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("failed", message);
    return json({ ok: false, error: message }, 500);
  }
});

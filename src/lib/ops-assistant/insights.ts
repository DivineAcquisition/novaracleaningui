// ─── Aggregate / insight reads from existing stored outputs ───────────────
//
// No new analytics pipeline. Admins get figures from the latest
// weekly_reports row (the same snapshot the weekly PDF used). VAs get
// operational counts from the live tables they already see (bookings, QC).
// Financial aggregates are never queried for a VA — the scope gate fires
// first.

import type { LiveFact } from "./types";
import type { AssistantRole } from "./types";
import {
  ADMIN_ONLY_METRIC_KEYS,
  classifyInsightTopic,
  insightMetricKeysFor,
  wantsInsightData,
} from "./insight-access";

type SB = { from: (t: string) => any };

interface StoredMetric {
  key: string;
  label?: string;
  unit?: string;
  section?: string;
  current?: { available?: boolean; value?: number | null; source?: string; unavailable_reason?: string };
  prior?: { available?: boolean; value?: number | null };
  wow_pct?: number | null;
}

interface StoredSnapshot {
  period_start?: string;
  period_end?: string;
  metrics?: StoredMetric[];
  cities?: Array<{ city: string; jobs: number; revenue_cents?: number; source?: string }>;
  insights?: Array<{ observation?: string; numbers?: string; hypothesis?: string }>;
}

export interface InsightLoad {
  facts: LiveFact[];
  hypotheses: string[];
  periodLabel: string | null;
}

function formatMetric(unit: string | undefined, value: number): string {
  if (unit === "cents") return `$${(value / 100).toFixed(2)}`;
  if (unit === "pct") return `${value.toFixed(1)}%`;
  if (unit === "seconds") {
    if (value >= 60) return `${Math.round(value / 60)} min`;
    return `${Math.round(value)} sec`;
  }
  if (unit === "score") return value.toFixed(1);
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

function monthStartIso(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mondayOf(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay(); // 0 Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function windowFor(message: string): { start: string; end: string; label: string } {
  const text = (message || "").toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  if (/\blast week\b/.test(text)) {
    const thisMon = mondayOf();
    const start = addDays(thisMon, -7);
    return { start, end: thisMon, label: `${start} → ${addDays(thisMon, -1)}` };
  }
  if (/\bthis week\b/.test(text)) {
    const start = mondayOf();
    return { start, end: addDays(start, 7), label: `week of ${start}` };
  }
  if (/\blast month\b/.test(text)) {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
    const end = monthStartIso(now);
    return { start, end, label: start.slice(0, 7) };
  }
  const start = monthStartIso();
  return { start, end: addDays(today, 1), label: `since ${start}` };
}

function pickMetrics(snapshot: StoredSnapshot, keys: string[]): StoredMetric[] {
  const list = Array.isArray(snapshot.metrics) ? snapshot.metrics : [];
  if (!keys.length) return list.slice(0, 8);
  const wanted = new Set(keys);
  const picked = list.filter((m) => wanted.has(m.key));
  return picked.length ? picked : list.slice(0, 6);
}

async function loadLatestWeeklyReport(sb: SB): Promise<{
  snapshot: StoredSnapshot;
  insights: Array<{ observation?: string; numbers?: string; hypothesis?: string }>;
  periodStart: string;
  periodEnd: string;
} | null> {
  const { data, error } = await sb
    .from("weekly_reports")
    .select("period_start, period_end, metrics, insights, executive_summary, status")
    .in("status", ["generated", "drive_pending"])
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const snapshot = (data.metrics && typeof data.metrics === "object" ? data.metrics : {}) as StoredSnapshot;
  const insights = Array.isArray(data.insights) ? data.insights : Array.isArray(snapshot.insights) ? snapshot.insights : [];
  return {
    snapshot,
    insights,
    periodStart: String(data.period_start || snapshot.period_start || ""),
    periodEnd: String(data.period_end || snapshot.period_end || ""),
  };
}

function factsFromWeekly(
  report: NonNullable<Awaited<ReturnType<typeof loadLatestWeeklyReport>>>,
  keys: string[],
  role: AssistantRole,
): InsightLoad {
  const facts: LiveFact[] = [];
  const periodLabel = report.periodStart && report.periodEnd ? `${report.periodStart} → ${report.periodEnd}` : null;
  if (periodLabel) {
    facts.push({
      label: "Weekly report period",
      value: periodLabel,
      source: "weekly_reports.period_start / period_end",
    });
  }
  for (const m of pickMetrics(report.snapshot, keys)) {
    if (role !== "admin" && ADMIN_ONLY_METRIC_KEYS.has(m.key)) continue;
    const current = m.current;
    if (!current || current.available === false || current.value == null) {
      facts.push({
        label: m.label || m.key,
        value: current?.unavailable_reason ? `unavailable (${current.unavailable_reason})` : "unavailable",
        source: current?.source || `weekly_reports.metrics.${m.key}`,
      });
      continue;
    }
    const wow =
      m.wow_pct == null || !Number.isFinite(m.wow_pct)
        ? ""
        : ` (${m.wow_pct >= 0 ? "+" : ""}${m.wow_pct.toFixed(1)}% vs prior week)`;
    facts.push({
      label: m.label || m.key,
      value: `${formatMetric(m.unit, Number(current.value))}${wow}`,
      source: current.source || `weekly_reports.metrics.${m.key} (stored weekly snapshot, not re-computed)`,
    });
  }

  if (/\bzone|city\b/i.test(keys.join(" ")) || keys.includes("bookings_made")) {
    const cities = Array.isArray(report.snapshot.cities) ? report.snapshot.cities : [];
    const top = [...cities].sort((a, b) => b.jobs - a.jobs).slice(0, 5);
    for (const c of top) {
      const revenue =
        role === "admin" && c.revenue_cents != null
          ? ` · ${formatMetric("cents", Number(c.revenue_cents))} booked`
          : "";
      facts.push({
        label: `Zone/city volume — ${c.city || "unknown"}`,
        value: `${c.jobs} jobs${revenue}`,
        source: c.source || "weekly_reports.metrics.cities (job counts; revenue omitted for non-admins)",
      });
    }
  }

  const recleans = report.snapshot.metrics?.find((m) => m.key === "recleans_completed");
  const jobs = report.snapshot.metrics?.find((m) => m.key === "jobs_completed");
  if (
    recleans?.current?.available &&
    jobs?.current?.available &&
    recleans.current.value != null &&
    jobs.current.value != null &&
    Number(jobs.current.value) > 0
  ) {
    const rate = (Number(recleans.current.value) / Number(jobs.current.value)) * 100;
    facts.push({
      label: "Re-clean rate",
      value: `${rate.toFixed(1)}% (${recleans.current.value} re-cleans / ${jobs.current.value} completed jobs)`,
      source: "weekly_reports recleans_completed ÷ jobs_completed (derived from stored counts, not a new pipeline)",
    });
  }

  const hypotheses: string[] = [];
  for (const ins of report.insights || []) {
    const h = String(ins.hypothesis || "").trim();
    const n = String(ins.numbers || "").trim();
    const o = String(ins.observation || "").trim();
    if (h) hypotheses.push([o, n, h].filter(Boolean).join(" — "));
  }
  return { facts, hypotheses, periodLabel };
}

async function loadLiveOperational(sb: SB, message: string): Promise<InsightLoad> {
  const win = windowFor(message);
  const facts: LiveFact[] = [];
  const topic = classifyInsightTopic(message);

  try {
    const { data, error } = await sb
      .from("bookings")
      .select("id, zone_code, city, is_reclean, status, service_date")
      .gte("service_date", win.start)
      .lt("service_date", win.end)
      .limit(5000);
    if (!error && Array.isArray(data)) {
      const rows = data as Array<{
        zone_code?: string | null;
        city?: string | null;
        is_reclean?: boolean | null;
        status?: string | null;
      }>;
      const completed = rows.filter((b) => String(b.status || "").toLowerCase() === "completed");
      const recleans = rows.filter((b) => b.is_reclean === true);
      facts.push({
        label: "Bookings in window",
        value: String(rows.length),
        source: `bookings.service_date ${win.label} (live table, permission-scoped count)`,
      });
      facts.push({
        label: "Completed in window",
        value: String(completed.length),
        source: "bookings.status = completed",
      });
      if (/\bre-?clean|reclean|operational/.test(message) || topic === "operational") {
        const denom = completed.length || rows.length;
        const rate = denom > 0 ? (recleans.length / denom) * 100 : 0;
        facts.push({
          label: "Re-cleans in window",
          value: String(recleans.length),
          source: "bookings.is_reclean",
        });
        facts.push({
          label: "Re-clean rate",
          value: denom > 0 ? `${rate.toFixed(1)}% (${recleans.length} / ${denom})` : "unavailable (no jobs in window)",
          source: "bookings.is_reclean ÷ bookings in window (live table)",
        });
      }
      if (/\bzone\b/.test(message) || /which zone/.test(message.toLowerCase())) {
        const byZone = new Map<string, number>();
        for (const b of rows) {
          const key = String(b.zone_code || b.city || "unassigned");
          byZone.set(key, (byZone.get(key) || 0) + 1);
        }
        const ranked = [...byZone.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        for (const [zone, count] of ranked) {
          facts.push({
            label: `Bookings in ${zone}`,
            value: String(count),
            source: "bookings.zone_code / city (volume only — no revenue)",
          });
        }
      }
    }
  } catch (err) {
    console.warn("[ops-assistant] live booking aggregates failed", err);
  }

  if (/\bqc\b|quality control/i.test(message)) {
    try {
      const { count } = await sb
        .from("qc_issues")
        .select("id", { count: "exact", head: true })
        .gte("created_at", `${win.start}T00:00:00.000Z`);
      facts.push({
        label: "QC cases opened in window",
        value: count == null ? "unavailable" : String(count),
        source: `qc_issues.created_at ${win.label}`,
      });
    } catch (err) {
      console.warn("[ops-assistant] qc aggregate failed", err);
    }
  }

  return { facts, hypotheses: [], periodLabel: win.label };
}

export async function loadInsightFacts(args: {
  supabase: SB | null;
  role: AssistantRole;
  message: string;
}): Promise<InsightLoad> {
  const empty: InsightLoad = { facts: [], hypotheses: [], periodLabel: null };
  if (!args.supabase || !wantsInsightData(args.message)) return empty;

  const topic = classifyInsightTopic(args.message);
  // Financial / admin-ops for a VA must never reach a query — the caller
  // should have gated already. Belt and braces: refuse here too.
  if (args.role !== "admin" && (topic === "financial" || topic === "admin_ops")) {
    return empty;
  }

  if (args.role === "admin") {
    try {
      const report = await loadLatestWeeklyReport(args.supabase);
      if (report) {
        const loaded = factsFromWeekly(report, insightMetricKeysFor(args.message), args.role);
        if (loaded.facts.length) return loaded;
      }
    } catch (err) {
      console.warn("[ops-assistant] weekly_reports read failed", err);
    }
  }

  if (topic === "operational" || args.role === "admin") {
    return loadLiveOperational(args.supabase, args.message);
  }
  return empty;
}

export { wantsInsightData };

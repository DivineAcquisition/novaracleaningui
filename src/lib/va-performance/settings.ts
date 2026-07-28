// ─── Admin-configurable settings + secret priming (server only) ───────────────
//
// Thresholds and the EOD window are configuration, not code. They live in
// app_settings so Malik can tune them from the workspace without a deploy, and
// every reader here falls back to the same defaults the migration seeded.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";

export interface EodSettings {
  timezone: string;
  /** How many days back a VA may still open/edit. 1 = today + yesterday. */
  backdateDays: number;
  /** Local on-time cutoff, "HH:MM". Submissions after this are marked late. */
  cutoffLocalTime: string;
  /** Hours after the work date before the day locks to the VA. */
  lockAfterHours: number;
}

export const DEFAULT_EOD_SETTINGS: EodSettings = {
  timezone: "America/New_York",
  backdateDays: 1,
  cutoffLocalTime: "17:30",
  lockAfterHours: 36,
};

export interface ThresholdBand {
  pct: number;
  abs: number;
}

export interface DiscrepancyThresholds {
  /** Below this, no flag at all. */
  base: ThresholdBand;
  medium: ThresholdBand;
  high: ThresholdBand;
  repeat: { windowDays: number; count: number };
}

export const DEFAULT_THRESHOLDS: DiscrepancyThresholds = {
  base: { pct: 20, abs: 10 },
  medium: { pct: 40, abs: 25 },
  high: { pct: 75, abs: 50 },
  repeat: { windowDays: 14, count: 3 },
};

type Json = Record<string, unknown>;

const num = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

async function readSetting(key: string): Promise<Json | null> {
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    const value = (data as { value?: unknown } | null)?.value;
    return value && typeof value === "object" ? (value as Json) : null;
  } catch {
    return null;
  }
}

export async function getEodSettings(): Promise<EodSettings> {
  const raw = await readSetting("va_eod_settings");
  if (!raw) return DEFAULT_EOD_SETTINGS;
  const cutoff = String(raw.cutoff_local_time || "");
  return {
    timezone: String(raw.timezone || DEFAULT_EOD_SETTINGS.timezone),
    backdateDays: Math.min(14, num(raw.backdate_days, DEFAULT_EOD_SETTINGS.backdateDays)),
    cutoffLocalTime: /^\d{2}:\d{2}$/.test(cutoff) ? cutoff : DEFAULT_EOD_SETTINGS.cutoffLocalTime,
    lockAfterHours: num(raw.lock_after_hours, DEFAULT_EOD_SETTINGS.lockAfterHours),
  };
}

function band(raw: unknown, fallback: ThresholdBand): ThresholdBand {
  const b = (raw || {}) as Json;
  return { pct: num(b.pct, fallback.pct), abs: num(b.abs, fallback.abs) };
}

export async function getDiscrepancyThresholds(): Promise<DiscrepancyThresholds> {
  const raw = await readSetting("va_discrepancy_thresholds");
  if (!raw) return DEFAULT_THRESHOLDS;
  const repeat = (raw.repeat || {}) as Json;
  return {
    base: band(raw.base, DEFAULT_THRESHOLDS.base),
    medium: band(raw.medium, DEFAULT_THRESHOLDS.medium),
    high: band(raw.high, DEFAULT_THRESHOLDS.high),
    repeat: {
      windowDays: num(repeat.window_days, DEFAULT_THRESHOLDS.repeat.windowDays),
      count: Math.max(2, num(repeat.count, DEFAULT_THRESHOLDS.repeat.count)),
    },
  };
}

// ─── Secret priming ───────────────────────────────────────────────────────────
//
// Same contract as primeAirtablePat: app_secrets is the single source of truth,
// env wins when explicitly set (Vercel override). Never memoized on failure so
// a warm lambda picks up a key stored after it booted. Never logged.

const PRIMED_KEYS = [
  "APPLOYE_API_KEY",
  "APPLOYE_API_BASE",
  "AIRTABLE_TEAM_PERF_BASE_ID",
  "AIRTABLE_WORKSPACE_ID",
] as const;

export async function primePerformanceSecrets(): Promise<void> {
  const missing = PRIMED_KEYS.filter((k) => !(process.env[k] || "").trim());
  if (missing.length === 0) return;
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase
      .from("app_secrets")
      .select("key, value")
      .in("key", missing as unknown as string[]);
    for (const row of (data || []) as { key: string; value: string | null }[]) {
      const value = (row.value || "").trim();
      if (value) process.env[row.key] = value;
    }
  } catch {
    /* callers treat an unset key as "not configured", not as an outage */
  }
}

/** Persist a resolved secret back to app_secrets (used when we create the base). */
export async function saveSecret(key: string, value: string): Promise<void> {
  const supabase = getAdminSupabase();
  await supabase
    .from("app_secrets")
    .upsert({ key, value }, { onConflict: "key" });
  process.env[key] = value;
}

// ─── Date helpers in the configured business timezone ─────────────────────────

/** "YYYY-MM-DD" for `at` rendered in `timezone`. */
export function localDate(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Minutes past local midnight for `at` in `timezone`. */
export function localMinutes(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export function cutoffMinutes(settings: EodSettings): number {
  const [h, m] = settings.cutoffLocalTime.split(":").map(Number);
  return h * 60 + m;
}

/** Inclusive list of dates a VA may still open, newest first. */
export function allowedWorkDates(settings: EodSettings, now = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i <= settings.backdateDays; i++) {
    const d = new Date(now.getTime() - i * 86400000);
    out.push(localDate(d, settings.timezone));
  }
  return [...new Set(out)];
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inclusive [start, end] as an array of YYYY-MM-DD. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard++ < 400) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

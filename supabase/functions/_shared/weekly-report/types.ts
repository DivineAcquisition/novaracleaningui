// Shared types for the weekly sales / retention / growth report.
// A metric is either a real pulled number (including legitimate zeros) or
// unavailable — never a guessed stand-in.

export type Metric = {
  available: boolean;
  value: number | null;
  source: string;
  unit?: "count" | "cents" | "seconds" | "pct" | "score";
  unavailable_reason?: string;
};

export type ComparedMetric = {
  key: string;
  label: string;
  section: "sales" | "retention" | "growth" | "ops";
  unit: Metric["unit"];
  current: Metric;
  prior: Metric;
  trailing4: Metric;
  wow_pct: number | null;
  vs_trailing4_pct: number | null;
};

export type Insight = {
  observation: string;
  numbers: string;
  hypothesis: string;
  watch?: boolean;
};

export type SourceStatus = {
  id: string;
  label: string;
  available: boolean;
  reason?: string;
};

export type CityRow = {
  city: string;
  jobs: number;
  revenue_cents: number;
  source: string;
};

export type SpendRow = {
  platform: string;
  spend_cents: number;
  leads: number | null;
  booked_jobs: number | null;
  cac_cents: number | null;
  source: string;
};

export type WeeklySnapshot = {
  period_start: string;
  period_end: string;
  timezone: string;
  sources: SourceStatus[];
  metrics: ComparedMetric[];
  cities: CityRow[];
  ad_spend: SpendRow[];
  rating_high: Metric;
  rating_low: Metric;
};

export type WeeklyReportSettings = {
  enabled: boolean;
  timezone: string;
  run_weekday: number;
  run_hour: number;
  recipients: string[];
  retention_weeks: number | null;
  max_insights: number;
  drive_root_folder_id: string;
  drive_folder_name: string;
};

export const DEFAULT_SETTINGS: WeeklyReportSettings = {
  enabled: true,
  timezone: "America/New_York",
  run_weekday: 1,
  run_hour: 8,
  recipients: ["contact@novaracleaning.com", "dispatch@novaracleaning.com"],
  retention_weeks: null,
  max_insights: 8,
  drive_root_folder_id: "1ZyfiAEaqb63DDE3gYfzUsk688i35j4fK",
  drive_folder_name: "NVC WeekLt Report & Forcast",
};

export function parseSettings(raw: unknown): WeeklyReportSettings {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const recipients = Array.isArray(v.recipients)
    ? v.recipients.map((x) => String(x).trim()).filter(Boolean)
    : DEFAULT_SETTINGS.recipients;
  return {
    enabled: v.enabled !== false,
    timezone: String(v.timezone || DEFAULT_SETTINGS.timezone),
    run_weekday: clampInt(v.run_weekday, 0, 6, DEFAULT_SETTINGS.run_weekday),
    run_hour: clampInt(v.run_hour, 0, 23, DEFAULT_SETTINGS.run_hour),
    recipients: recipients.length ? recipients : DEFAULT_SETTINGS.recipients,
    retention_weeks: v.retention_weeks == null || v.retention_weeks === ""
      ? null
      : clampInt(v.retention_weeks, 1, 520, 52),
    max_insights: clampInt(v.max_insights, 3, 12, DEFAULT_SETTINGS.max_insights),
    drive_root_folder_id: String(v.drive_root_folder_id || DEFAULT_SETTINGS.drive_root_folder_id),
    drive_folder_name: String(v.drive_folder_name || DEFAULT_SETTINGS.drive_folder_name),
  };
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function okMetric(value: number, source: string, unit: Metric["unit"] = "count"): Metric {
  return { available: true, value, source, unit };
}

export function missingMetric(source: string, reason: string, unit: Metric["unit"] = "count"): Metric {
  return { available: false, value: null, source, unit, unavailable_reason: reason };
}

export function wowPct(current: Metric, prior: Metric): number | null {
  if (!current.available || !prior.available || current.value == null || prior.value == null) return null;
  if (prior.value === 0) return current.value === 0 ? 0 : null;
  return ((current.value - prior.value) / Math.abs(prior.value)) * 100;
}

export function avgMetric(items: Metric[], source: string, unit: Metric["unit"]): Metric {
  const nums = items.filter((m) => m.available && m.value != null).map((m) => m.value as number);
  if (!nums.length) {
    return missingMetric(source, "not enough prior weeks with this source to average", unit);
  }
  return okMetric(nums.reduce((a, b) => a + b, 0) / nums.length, `${source} (trailing ${nums.length}-week avg)`, unit);
}

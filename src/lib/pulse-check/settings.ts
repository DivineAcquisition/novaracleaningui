export const PULSE_CHECK_SETTINGS_KEY = "pulse_check_settings";

export const PULSE_CHECK_PORTAL_HOST = "https://contractor.novaracleaning.com";

export interface PulseCheckSettings {
  enabled: boolean;
  /** Days between cycle runs. Default 14. */
  interval_days: number;
  /** Days after the initial send before the single in-cycle follow-up. Default 2 (always before silence close). */
  followup_days: number;
  /** Days of silence after send before we terminate. Default 3. */
  no_response_terminate_days: number;
  /** Token lifetime in days. Default 14 (the cycle window). */
  token_ttl_days: number;
}

export const DEFAULT_PULSE_CHECK_SETTINGS: PulseCheckSettings = {
  enabled: true,
  interval_days: 14,
  followup_days: 2,
  no_response_terminate_days: 3,
  token_ttl_days: 14,
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function parsePulseCheckSettings(raw: unknown): PulseCheckSettings {
  const src = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const interval = clampInt(src.interval_days, DEFAULT_PULSE_CHECK_SETTINGS.interval_days, 1, 90);
  const ttl = clampInt(src.token_ttl_days, DEFAULT_PULSE_CHECK_SETTINGS.token_ttl_days, 1, 90);
  let terminate = clampInt(
    src.no_response_terminate_days,
    DEFAULT_PULSE_CHECK_SETTINGS.no_response_terminate_days,
    1,
    30,
  );
  if (terminate > ttl) terminate = ttl;
  let followup = clampInt(src.followup_days, DEFAULT_PULSE_CHECK_SETTINGS.followup_days, 1, 30);
  if (terminate > 1 && followup >= terminate) followup = terminate - 1;
  if (followup >= ttl) followup = Math.max(1, ttl - 1);
  return {
    enabled: src.enabled !== false,
    interval_days: interval,
    followup_days: followup,
    no_response_terminate_days: terminate,
    token_ttl_days: ttl,
  };
}

export function pulseCheckLink(token: string): string {
  return `${PULSE_CHECK_PORTAL_HOST}/cleaner/pulse/${encodeURIComponent(token)}`;
}

export function cycleIsDue(
  lastStartedAt: string | Date | null | undefined,
  intervalDays: number,
  now: Date = new Date(),
): boolean {
  if (!lastStartedAt) return true;
  const started = lastStartedAt instanceof Date ? lastStartedAt : new Date(lastStartedAt);
  if (Number.isNaN(started.getTime())) return true;
  const elapsedMs = now.getTime() - started.getTime();
  return elapsedMs >= intervalDays * 86_400_000;
}

/** Full idle cycles (cron / admin force) move the clock. One-off admin sends do not. */
export function cycleCountsTowardInterval(cycle: {
  counts_toward_interval?: boolean | null;
  source?: string | null;
}): boolean {
  if (cycle.counts_toward_interval === false) return false;
  const source = String(cycle.source || "").toLowerCase();
  if (source === "admin-one" || source === "manual") return false;
  return true;
}

export function latestIntervalStartedAt(
  cycles: Array<{
    started_at: string;
    counts_toward_interval?: boolean | null;
    source?: string | null;
  }>,
): string | null {
  const counting = cycles.filter(cycleCountsTowardInterval);
  if (counting.length === 0) return null;
  return [...counting].sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
  )[0].started_at;
}

export function pulseSendBlockedReason(status: string | null | undefined): string | null {
  if (String(status || "").toLowerCase() === "terminated") {
    return "Cannot send a pulse check to a terminated contractor.";
  }
  return null;
}

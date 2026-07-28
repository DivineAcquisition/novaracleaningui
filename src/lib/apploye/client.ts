// ─── Apploye API client — HOURS AND TIME ENTRIES ONLY ─────────────────────────
//
// SCOPE LIMIT (deliberate, and enforced structurally below).
//
// Apploye is used for one thing: how many hours a VA tracked on a given date.
// Time worked is a legitimate pay basis and output measure for an hourly
// contractor. Behavioural surveillance is not, and it undermines the
// independent-contractor relationship — so this client:
//
//   * calls ONLY /members and /timesheets. No screenshot, activity, app-usage
//     or URL endpoint is ever requested, even if the account exposes one.
//   * projects every response through an explicit allowlist (`pickMember`,
//     `pickTimesheet`) before it leaves this module, so an API that starts
//     returning activity percentages tomorrow still cannot leak them into the
//     rest of the system.
//   * has no type, field or storage anywhere downstream that could hold that
//     data even if someone tried.
//
// If you are extending this file: adding a monitoring endpoint is not a
// feature request, it's a change to how we treat contractors. Don't.
//
// Auth: Organization API Key in the X-APPLOYE-API-KEY header. The key is read
// at call time from the environment (primed from app_secrets) and is never
// logged and never sent to the browser.

const DEFAULT_API_BASE = "https://public-api.apploye.com";

/** Endpoints this integration is permitted to call. Nothing else, ever. */
const ALLOWED_PATHS = ["/members", "/timesheets"] as const;
type AllowedPath = (typeof ALLOWED_PATHS)[number];

export class ApployeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApployeError";
  }
}

/** Thrown when no API key is configured — treated as "not_configured", not an outage. */
export class ApployeNotConfiguredError extends ApployeError {
  constructor() {
    super("Apploye is not connected (APPLOYE_API_KEY is unset).");
    this.name = "ApployeNotConfiguredError";
  }
}

function apiBase(): string {
  return (process.env.APPLOYE_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, "");
}

export function isApployeConfigured(): boolean {
  return Boolean((process.env.APPLOYE_API_KEY || "").trim());
}

function apiKey(): string {
  const key = (process.env.APPLOYE_API_KEY || "").trim();
  if (!key) throw new ApployeNotConfiguredError();
  return key;
}

interface ApployeEnvelope<T> {
  success?: boolean;
  page?: number;
  per_page?: number;
  total?: number;
  response?: T[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function request<T>(
  path: AllowedPath,
  query: Record<string, string | number | undefined> = {},
): Promise<T[]> {
  if (!ALLOWED_PATHS.includes(path)) {
    throw new ApployeError(`Refusing to call a non-allowlisted Apploye endpoint: ${path}`);
  }
  const url = new URL(`${apiBase()}${path}/`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  const headers = { "X-APPLOYE-API-KEY": apiKey(), Accept: "application/json" };

  let attempt = 0;
  const maxRetries = 3;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let res: Response;
    try {
      res = await fetch(url.toString(), { headers, cache: "no-store" });
    } catch (err) {
      if (attempt >= maxRetries) {
        throw new ApployeError(`Network error calling Apploye: ${(err as Error).message}`);
      }
      await sleep(400 * 2 ** attempt++);
      continue;
    }

    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      if (attempt >= maxRetries) {
        throw new ApployeError(`Apploye ${res.status} after ${attempt} retries`, res.status);
      }
      await sleep(400 * 2 ** attempt++);
      continue;
    }

    if (!res.ok) {
      throw new ApployeError(`Apploye ${res.status} ${res.statusText}`, res.status);
    }

    const body = (await res.json()) as ApployeEnvelope<T> | T[];
    if (Array.isArray(body)) return body;
    return body.response ?? [];
  }
}

// ─── Allowlist projections ────────────────────────────────────────────────────
//
// Everything returned by this module passes through one of these. They are the
// structural guarantee that only identity and duration ever escape.

export interface ApployeMember {
  id: string;
  userName: string | null;
  email: string | null;
  timezone: string | null;
}

function pickMember(raw: Record<string, unknown>): ApployeMember | null {
  const id = raw.id ?? raw.user_id;
  if (!id) return null;
  return {
    id: String(id),
    userName: raw.user_name ? String(raw.user_name) : null,
    email: raw.email ? String(raw.email).toLowerCase() : null,
    timezone: raw.timezone ? String(raw.timezone) : null,
  };
}

/** A day of tracked time for one member. Duration only — nothing else. */
export interface ApployeTimeEntry {
  userId: string;
  /** Local calendar date the time was tracked on (YYYY-MM-DD). */
  date: string;
  /** Seconds tracked. */
  durationSeconds: number;
}

function pickTimesheet(raw: Record<string, unknown>): ApployeTimeEntry | null {
  const userId = raw.user_id ?? raw.userId ?? raw.id;
  const date = raw.dates ?? raw.date;
  const duration = raw.duration ?? raw.duration_seconds ?? raw.total_duration;
  if (!userId || !date) return null;
  const seconds = Number(duration);
  return {
    userId: String(userId),
    date: String(date).slice(0, 10),
    durationSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0,
  };
}

// ─── Public surface ───────────────────────────────────────────────────────────

/** Organization members — used to resolve a VA's Apploye user id from their email. */
export async function listMembers(): Promise<ApployeMember[]> {
  const rows = await request<Record<string, unknown>>("/members");
  return rows.map(pickMember).filter((m): m is ApployeMember => m !== null);
}

/**
 * Tracked time per member per day for an inclusive date range.
 *
 * The API takes ISO datetimes; we widen the window by a day on each side and
 * then filter by the returned calendar date, so a member in a different
 * timezone still lands on the right day.
 */
export async function listTimeEntries(
  startDate: string,
  endDate: string,
): Promise<ApployeTimeEntry[]> {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - 1);
  end.setUTCDate(end.getUTCDate() + 1);

  const rows = await request<Record<string, unknown>>("/timesheets", {
    start_date: start.toISOString(),
    end_date: end.toISOString(),
  });

  return rows
    .map(pickTimesheet)
    .filter((e): e is ApployeTimeEntry => e !== null)
    .filter((e) => e.date >= startDate && e.date <= endDate);
}

/**
 * Hours tracked per Apploye user id for a single date, keyed by user id.
 * A user with no entry is simply absent from the map — the caller decides
 * whether that means "zero hours" (source reachable) or "unverified".
 */
export async function hoursByUserForDate(date: string): Promise<Map<string, number>> {
  const entries = await listTimeEntries(date, date);
  const out = new Map<string, number>();
  for (const e of entries) {
    out.set(e.userId, (out.get(e.userId) || 0) + e.durationSeconds / 3600);
  }
  for (const [k, v] of out) out.set(k, Math.round(v * 100) / 100);
  return out;
}

/** Connection check for the admin surface. Never exposes the key. */
export async function ping(): Promise<{ ok: boolean; members: number; message: string }> {
  if (!isApployeConfigured()) {
    return { ok: false, members: 0, message: "No APPLOYE_API_KEY configured." };
  }
  try {
    const members = await listMembers();
    return { ok: true, members: members.length, message: `Connected — ${members.length} members.` };
  } catch (err) {
    return { ok: false, members: 0, message: (err as Error).message };
  }
}

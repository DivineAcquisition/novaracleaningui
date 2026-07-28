// ─── Apploye API client (Node/Next side) — HOURS ONLY ─────────────────────────
//
// The Deno mirror of this lives at supabase/functions/_shared/apploye-client.ts
// and is used by apploye-invite-cleaner / apploye-live-tracking. Same API, same
// credentials (APPLOYE_API_KEY + optional APPLOYE_API_BASE in app_secrets) —
// this is the Next.js runtime's copy, following the same split the Airtable
// integration already uses.
//
// SCOPE LIMIT (deliberate, and enforced structurally below).
//
// Apploye is used for one thing: how many hours a VA tracked on a given date.
// Time worked is a legitimate pay basis and output measure for an hourly
// contractor. Behavioural surveillance is not, and it undermines the
// independent-contractor relationship — so this client:
//
//   * calls ONLY /members and /timesheets. Apploye's public API doesn't expose
//     screenshots, activity levels or app usage at all, and if that ever
//     changes this client still cannot reach them.
//   * projects every response through an explicit allowlist (`pickMember`,
//     `pickDayTotal`) before it leaves this module.
//   * has no type, field or storage anywhere downstream that could hold that
//     data even if someone tried.
//
// If you are extending this file: adding a monitoring endpoint is not a
// feature request, it's a change to how we treat contractors. Don't.
//
// ─── The shape of /timesheets (verified against the live API) ────────────────
//
// The published docs show `dates` as a single string. It is NOT. The endpoint
// returns ONE ROW PER USER for the WHOLE requested range:
//
//   { "user_id": "…", "duration": 167972, "dates": ["2026-05-30", … 9 dates] }
//
// `duration` is the TOTAL across every date in `dates`, so a multi-day query
// cannot be attributed to a single day — there is no per-day breakdown in the
// response. We therefore query ONE DAY AT A TIME, and refuse to attribute a
// row whose `dates` isn't exactly the day we asked for. Guessing a split would
// invent hours nobody worked.

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

/** Thrown when no API key is configured — "not_configured", not an outage. */
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
  error?: string;
  total_count?: number;
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
    if (body.success === false && body.error) {
      throw new ApployeError(`Apploye rejected the request: ${body.error}`);
    }
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
  // The live API returns `username`; the published docs say `user_name`.
  const name = raw.username ?? raw.user_name;
  return {
    id: String(id),
    userName: name ? String(name) : null,
    email: raw.email ? String(raw.email).toLowerCase() : null,
    timezone: raw.timezone ? String(raw.timezone) : null,
  };
}

/** One member's tracked total for one specific date. Duration only. */
export interface ApployeDayTotal {
  memberId: string;
  /** The calendar date this total belongs to (YYYY-MM-DD). */
  date: string;
  hours: number;
}

/**
 * Project a /timesheets row onto a single requested day.
 *
 * Returns null unless the row's `dates` is exactly the day we asked for. The
 * endpoint aggregates `duration` across every date in `dates`, so any other
 * shape has no honest per-day answer and must resolve to "unverified".
 */
function pickDayTotal(raw: Record<string, unknown>, requestedDate: string): ApployeDayTotal | null {
  const memberId = raw.user_id ?? raw.userId ?? raw.id;
  if (!memberId) return null;

  const rawDates = raw.dates ?? raw.date;
  const dates = (Array.isArray(rawDates) ? rawDates : [rawDates])
    .filter((d) => d !== null && d !== undefined)
    .map((d) => String(d).slice(0, 10));

  if (dates.length !== 1 || dates[0] !== requestedDate) return null;

  const seconds = Number(raw.duration ?? raw.duration_seconds ?? raw.total_duration);
  if (!Number.isFinite(seconds) || seconds < 0) return null;

  return {
    memberId: String(memberId),
    date: requestedDate,
    hours: Math.round((seconds / 3600) * 100) / 100,
  };
}

/** Exposed for the offline verification script — not part of the API surface. */
export const __test__pickDayTotal = pickDayTotal;

// ─── Public surface ───────────────────────────────────────────────────────────

/** Organization members — used to resolve a VA's Apploye member id by email. */
export async function listMembers(): Promise<ApployeMember[]> {
  const rows = await request<Record<string, unknown>>("/members");
  return rows.map(pickMember).filter((m): m is ApployeMember => m !== null);
}

/**
 * Hours tracked per member for ONE date, keyed by Apploye member id.
 *
 * Queried a single day at a time because the endpoint has no per-day
 * breakdown (see the note at the top of this file). A member with no entry is
 * simply absent from the map — the caller decides whether that means "zero
 * hours" (source reachable) or "unverified".
 */
export async function hoursByMemberForDate(date: string): Promise<Map<string, number>> {
  const rows = await request<Record<string, unknown>>("/timesheets", {
    start_date: `${date}T00:00:00Z`,
    end_date: `${date}T23:59:59Z`,
  });

  const out = new Map<string, number>();
  for (const raw of rows) {
    const total = pickDayTotal(raw, date);
    if (!total) continue;
    out.set(total.memberId, (out.get(total.memberId) || 0) + total.hours);
  }
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

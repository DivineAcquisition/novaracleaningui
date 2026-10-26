// Time-only projections for Apploye's MCP.
//
// Identity, clock-in/out, and tracked duration. Nothing in this file reads
// screenshots, keystrokes, app usage, URLs, idle breakdowns, or activity
// scores — those tools are refused by name before a request is sent.

export const APPLOYE_ORG_TIMEZONE = "America/New_York";

/** Tools this integration is allowed to call. Anything else is refused. */
export const APPLOYE_TIME_TOOLS = [
  "health_check",
  "list_members",
  "list_clockinouts",
  "list_timesheets",
  "list_timesheet_totals",
  "list_live_tracking_members",
] as const;

export type ApployeTimeTool = (typeof APPLOYE_TIME_TOOLS)[number];

export function assertTimeTool(name: string): asserts name is ApployeTimeTool {
  if (!(APPLOYE_TIME_TOOLS as readonly string[]).includes(name)) {
    throw new Error(
      `Refusing Apploye tool ${name}. This integration reads identity and tracked time only.`,
    );
  }
}

export interface ApployeMember {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  timezone: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

export function projectMember(raw: unknown): ApployeMember | null {
  const row = asRecord(raw);
  if (!row) return null;
  const nested = asRecord(row.user) || asRecord(row.member) || row;
  const id = asText(nested.user_id) || asText(nested.id) || asText(row.user_id) || asText(row.id);
  if (!id) return null;
  const email = asText(nested.email) || asText(row.email);
  return {
    id,
    email: email ? email.toLowerCase() : null,
    firstName: asText(nested.first_name) || asText(row.first_name),
    lastName: asText(nested.last_name) || asText(row.last_name),
    timezone: asText(nested.timezone) || asText(row.timezone),
  };
}

export function memberName(member: Pick<ApployeMember, "firstName" | "lastName" | "email">): string | null {
  const name = `${member.firstName || ""} ${member.lastName || ""}`.trim();
  return name || member.email;
}

export function matchMemberByEmail(members: ApployeMember[], email: string | null | undefined): ApployeMember | null {
  const needle = (email || "").trim().toLowerCase();
  if (!needle) return null;
  return members.find((member) => member.email === needle) || null;
}

export function manualInviteUrl(email: string, name?: string | null): string {
  const params = new URLSearchParams({ email: email.trim() });
  const clean = (name || "").trim();
  if (clean) params.set("name", clean);
  return `https://app.apploye.com/members/invite?${params.toString()}`;
}

export interface ClockPunch {
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  durationSeconds: number | null;
}

export function projectClockins(payload: unknown): ClockPunch[] {
  const body = asRecord(payload);
  const results = Array.isArray(body?.results) ? body.results : [];
  const punches: ClockPunch[] = [];
  for (const row of results) {
    const record = asRecord(row);
    const attendance = Array.isArray(record?.attendance) ? record.attendance : [];
    for (const entry of attendance) {
      const punch = asRecord(entry);
      if (!punch) continue;
      const seconds = Number(punch.duration_seconds);
      punches.push({
        date: (asText(punch.date) || "").slice(0, 10),
        clockIn: asText(punch.clock_in),
        clockOut: asText(punch.clock_out),
        durationSeconds: Number.isFinite(seconds) && seconds >= 0 ? seconds : null,
      });
    }
  }
  return punches;
}

export interface ArrivalMatch {
  clockIn: string | null;
  clockOut: string | null;
  durationSeconds: number | null;
  open: boolean;
}

/**
 * The punch that belongs to this arrival, on that business-calendar day.
 * An open punch (no clock-out) wins. Otherwise a punch that covers the
 * arrival instant, otherwise the clock-in closest to it.
 */
export function matchArrivalPunch(
  punches: ClockPunch[],
  day: string,
  arrivalIso: string,
): ArrivalMatch | null {
  const sameDay = punches.filter((punch) => punch.date === day && punch.clockIn);
  if (!sameDay.length) return null;
  const open = sameDay.find((punch) => !punch.clockOut);
  const chosen = open || coveringPunch(sameDay, arrivalIso) || closestPunch(sameDay, arrivalIso);
  return {
    clockIn: chosen.clockIn,
    clockOut: chosen.clockOut,
    durationSeconds: chosen.durationSeconds,
    open: !chosen.clockOut,
  };
}

function coveringPunch(punches: ClockPunch[], arrivalIso: string): ClockPunch | null {
  const arrival = new Date(arrivalIso).getTime();
  if (!Number.isFinite(arrival)) return null;
  return punches.find((punch) => {
    const start = new Date(punch.clockIn || "").getTime();
    const end = new Date(punch.clockOut || "").getTime();
    return Number.isFinite(start) && Number.isFinite(end) && start <= arrival && arrival <= end;
  }) || null;
}

function closestPunch(punches: ClockPunch[], arrivalIso: string): ClockPunch {
  const arrival = new Date(arrivalIso).getTime();
  return punches.slice().sort((a, b) => {
    const da = Math.abs(new Date(a.clockIn || "").getTime() - arrival);
    const db = Math.abs(new Date(b.clockIn || "").getTime() - arrival);
    return da - db;
  })[0];
}

export type ArrivalApployeStatus =
  | "unavailable"
  | "unlinked"
  | "tracking"
  | "not_tracking"
  | "clocked_out";

export function arrivalStatus(args: {
  configured: boolean;
  memberId: string | null;
  live: boolean;
  punch: ArrivalMatch | null;
}): ArrivalApployeStatus {
  if (!args.configured) return "unavailable";
  if (!args.memberId) return "unlinked";
  if (args.live || args.punch?.open) return "tracking";
  if (args.punch) return "clocked_out";
  return "not_tracking";
}

/** Sum of tracked seconds per member. Idle and active seconds are ignored. */
export function trackedSecondsByMember(payload: unknown): Map<string, number> {
  const body = asRecord(payload);
  const results = Array.isArray(body?.results) ? body.results : [];
  const out = new Map<string, number>();
  for (const row of results) {
    const record = asRecord(row);
    const member = projectMember(row);
    if (!record || !member) continue;
    const seconds = Number(record.tracked_seconds);
    if (!Number.isFinite(seconds) || seconds < 0) continue;
    out.set(member.id, (out.get(member.id) || 0) + seconds);
  }
  return out;
}

/**
 * Hours from individual timesheet rows, using start/end timestamps only.
 * Rows whose local start_time is not on `day` are skipped. idle_times is
 * never read.
 */
export function timesheetSecondsByMember(payload: unknown, day: string): Map<string, number> {
  const body = asRecord(payload);
  const results = Array.isArray(body?.results) ? body.results : [];
  const out = new Map<string, number>();
  for (const row of results) {
    const record = asRecord(row);
    const member = projectMember(row);
    if (!record || !member) continue;
    const sheets = Array.isArray(record.timesheets) ? record.timesheets : [];
    let seconds = 0;
    for (const sheet of sheets) {
      const entry = asRecord(sheet);
      if (!entry) continue;
      const startIso = asText(entry.start_time);
      if (!startIso || startIso.slice(0, 10) !== day) continue;
      const start = Number(entry.start_timestamp);
      const end = Number(entry.end_timestamp);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
      seconds += end - start;
    }
    if (seconds > 0) out.set(member.id, (out.get(member.id) || 0) + seconds);
  }
  return out;
}

export function hoursFromTrackedSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return Math.round((seconds / 3600) * 100) / 100;
}

export function hoursByMember(secondsByMember: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, seconds] of secondsByMember) {
    out.set(id, hoursFromTrackedSeconds(seconds));
  }
  return out;
}

export interface LiveSession {
  memberId: string;
  email: string | null;
  name: string | null;
  startedAt: string | null;
}

export function projectLiveSessions(payload: unknown): LiveSession[] {
  const body = asRecord(payload);
  const results = Array.isArray(body?.results) ? body.results : [];
  const sessions: LiveSession[] = [];
  for (const row of results) {
    const record = asRecord(row);
    const member = projectMember(row);
    if (!record || !member) continue;
    const nested = asRecord(record.timesheet);
    sessions.push({
      memberId: member.id,
      email: member.email,
      name: memberName(member),
      startedAt:
        asText(record.start_time) ||
        asText(record.started_at) ||
        asText(record.clock_in) ||
        asText(nested?.start_time),
    });
  }
  return sessions;
}

/** YYYY-MM-DD for an instant in the business timezone. */
export function businessDay(iso: string, timeZone = APPLOYE_ORG_TIMEZONE): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function arrivalKey(args: { jobId?: string | null; bookingId?: string | null; cleanerId: string }): string {
  if (args.jobId) return `job:${args.jobId}:cleaner:${args.cleanerId}`;
  if (args.bookingId) return `booking:${args.bookingId}:cleaner:${args.cleanerId}`;
  throw new Error("arrivalKey needs a jobId or bookingId");
}

/**
 * Turn an MCP HTTP body into the tool's JSON payload.
 * Accepts a raw JSON-RPC envelope or an SSE stream. A non-JSON error string
 * is thrown so callers record "unavailable" instead of inventing a clock-in.
 */
export function parseMcpPayload(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty Apploye response");

  let jsonText = trimmed;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    const dataLines = trimmed
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    if (!dataLines.length) throw new Error(trimmed.slice(0, 300));
    jsonText = dataLines[dataLines.length - 1];
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(jsonText);
  } catch {
    throw new Error(jsonText.slice(0, 300));
  }

  const record = asRecord(envelope);
  if (!record) return envelope;
  if (record.error) {
    const err = asRecord(record.error);
    throw new Error(asText(err?.message) || asText(record.error) || "Apploye MCP error");
  }

  const result = asRecord(record.result) || record;
  if (result.isError) {
    const content = Array.isArray(result.content) ? result.content : [];
    const first = asRecord(content[0]);
    throw new Error(asText(first?.text) || "Apploye MCP tool error");
  }

  const content = Array.isArray(result.content) ? result.content : null;
  if (content) {
    const first = asRecord(content[0]);
    const inner = asText(first?.text);
    if (!inner) return {};
    try {
      return JSON.parse(inner);
    } catch {
      throw new Error(inner.slice(0, 300));
    }
  }
  return result;
}

// ─── Apploye API client ──────────────────────────────────────────────────
//
// Thin Deno wrapper over Apploye's Public REST API (X-APPLOYE-API-KEY
// header auth, base URL https://public-api.apploye.com).
//
// Endpoint reference (as of 2026-05): https://apploye-com.s3.amazonaws.com/time-tracking-api/index.html
//
//   GET /members/                            — list org members
//   GET /timesheets/?start_date=&end_date=   — list timesheets
//   GET /project/                            — list projects
//   GET /project/{id}/assignees/             — list project assignees
//   GET /project/{id}/tasks/                 — list project tasks
//
// The public API is INTENTIONALLY read-only — Apploye does not expose
// invite / clock-in / live-GPS endpoints publicly. We work around that
// by:
//   * "Linking" a cleaner to an Apploye member by email match (no
//     invite endpoint — the admin invites them inside the Apploye
//     dashboard first, then this code resolves the apploye_member_id).
//   * Deriving "currently active" cleaners from today's timesheets
//     (rows with no end_time and started_at within the last few hours
//     count as clocked in).

const DEFAULT_BASE = "https://public-api.apploye.com";

export interface ApployeConfig {
  apiKey: string;
  base: string;
}

export async function getApployeConfig(supabase: any): Promise<ApployeConfig | null> {
  const read = async (key: string): Promise<string> => {
    let value = "";
    try {
      const { data } = await supabase
        .from("app_secrets")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      if (data?.value) value = String(data.value).trim();
    } catch (_) { /* ignore */ }
    if (!value) value = (Deno.env.get(key) || "").trim();
    return value;
  };
  const apiKey = await read("APPLOYE_API_KEY");
  const base = (await read("APPLOYE_API_BASE")) || DEFAULT_BASE;
  if (!apiKey) return null;
  return { apiKey, base: base.replace(/\/+$/, "") };
}

export async function apployeFetch(
  cfg: ApployeConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = `${cfg.base}${path}`;
  const headers: Record<string, string> = {
    "X-APPLOYE-API-KEY": cfg.apiKey,
    Accept: "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(url, { ...init, headers });
}

export interface ApployeMember {
  id: string;
  username: string | null;
  email: string | null;
  timezone: string | null;
}

export async function listMembers(cfg: ApployeConfig): Promise<ApployeMember[]> {
  try {
    const r = await apployeFetch(cfg, `/members/`);
    if (!r.ok) return [];
    const j = await r.json();
    const list = (j.response || []) as Array<Record<string, unknown>>;
    return list.map((m) => ({
      id: String(m.id || ""),
      username: (m.username as string) || null,
      email: (m.email as string) || null,
      timezone: (m.timezone as string) || null,
    }));
  } catch (_) {
    return [];
  }
}

export interface ApployeProject {
  id: string;
  name: string | null;
  status: string | null;
  startDate: string | null;
  deadline: string | null;
}

export async function listProjects(cfg: ApployeConfig): Promise<ApployeProject[]> {
  try {
    const r = await apployeFetch(cfg, `/project/`);
    if (!r.ok) return [];
    const j = await r.json();
    const list = (j.response || []) as Array<Record<string, unknown>>;
    return list.map((p) => ({
      id: String(p.id || ""),
      name: (p.name as string) || null,
      status: (p.status as string) || null,
      startDate: (p.start_date as string) || null,
      deadline: (p.deadline as string) || null,
    }));
  } catch (_) {
    return [];
  }
}

export interface ApployeTimesheet {
  id: string;
  userId: string | null;
  userEmail: string | null;
  projectId: string | null;
  taskId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  /** True when there's a `started_at` but no `ended_at` AND
   *  started within the last 12 hours — our heuristic for "clocked in
   *  right now" since the public API doesn't expose a clock-in state
   *  field directly. */
  isActive: boolean;
}

export async function listTimesheets(
  cfg: ApployeConfig,
  startIso: string,
  endIso: string,
): Promise<ApployeTimesheet[]> {
  try {
    const r = await apployeFetch(
      cfg,
      `/timesheets/?start_date=${encodeURIComponent(startIso)}&end_date=${encodeURIComponent(endIso)}`,
    );
    if (!r.ok) return [];
    const j = await r.json();
    const list = (j.response || []) as Array<Record<string, any>>;
    const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
    return list.map((t) => {
      const startedAt = (t.started_at || t.start_time || null) as string | null;
      const endedAt = (t.ended_at || t.end_time || null) as string | null;
      const isActive = !!startedAt && !endedAt &&
        new Date(startedAt).getTime() > twelveHoursAgo;
      return {
        id: String(t.id || ""),
        userId: (t.user_id as string) || null,
        userEmail: (t.user_email || t.email) as string || null,
        projectId: (t.project_id as string) || null,
        taskId: (t.task_id as string) || null,
        startedAt,
        endedAt,
        durationSec: typeof t.duration === "number"
          ? t.duration
          : typeof t.duration_sec === "number"
          ? t.duration_sec
          : null,
        isActive,
      };
    });
  } catch (_) {
    return [];
  }
}

// ─── Apploye API client ──────────────────────────────────────────────────
//
// Thin Deno wrapper over the Apploye Public API (Bearer token auth).
// Reads `APPLOYE_API_KEY` and `APPLOYE_WORKSPACE_ID` from `app_secrets`
// first, falling back to Edge Function env vars. Soft-fails the whole
// way down — every helper returns null / [] when credentials are
// missing so callers don't have to special-case the "not configured
// yet" state.
//
// Apploye API reference: https://www.apploye.com/api-documentation
// Versioned through the base URL (no Accept-Version header required).
//
// NOTE: Apploye's exact endpoint shapes differ by plan. The wrappers
// here use the endpoints documented as of 2025-Q2; ops can override
// the base URL via `APPLOYE_API_BASE` if Apploye reshapes.

const DEFAULT_BASE = "https://www.apploye.com/api/v1";

export interface ApployeConfig {
  token: string;
  workspaceId: string;
  base: string;
}

export async function getApployeConfig(supabase: any): Promise<ApployeConfig | null> {
  const fetch1 = async (key: string): Promise<string> => {
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
  const token = await fetch1("APPLOYE_API_KEY");
  const workspaceId = await fetch1("APPLOYE_WORKSPACE_ID");
  const base = (await fetch1("APPLOYE_API_BASE")) || DEFAULT_BASE;
  if (!token || !workspaceId) return null;
  return { token, workspaceId, base: base.replace(/\/+$/, "") };
}

export async function apployeFetch(
  cfg: ApployeConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = `${cfg.base}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.token}`,
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
  name: string | null;
  email: string | null;
  invitedAt?: string;
  lastSeenAt?: string;
  active?: boolean;
}

/** List every member in the workspace. */
export async function listMembers(cfg: ApployeConfig): Promise<ApployeMember[]> {
  try {
    const r = await apployeFetch(
      cfg,
      `/workspaces/${encodeURIComponent(cfg.workspaceId)}/members`,
    );
    if (!r.ok) return [];
    const j = await r.json();
    const list = (j.members || j.data || []) as Array<Record<string, unknown>>;
    return list.map((m) => ({
      id: String(m.id || m.member_id || ""),
      name: (m.name || m.full_name || null) as string | null,
      email: (m.email || null) as string | null,
      active: Boolean(m.active ?? true),
    }));
  } catch (_) {
    return [];
  }
}

/**
 * Invite a cleaner into the workspace. Apploye emails them a download
 * link for the desktop / mobile app. Returns the resulting member id
 * (so we can store it on cleaners.apploye_member_id) or null on failure.
 */
export async function inviteMember(
  cfg: ApployeConfig,
  args: { name: string; email: string; phone?: string; role?: string },
): Promise<{ memberId: string | null; inviteUrl: string | null; raw: unknown }> {
  try {
    const r = await apployeFetch(
      cfg,
      `/workspaces/${encodeURIComponent(cfg.workspaceId)}/members/invite`,
      {
        method: "POST",
        body: JSON.stringify({
          name: args.name,
          email: args.email,
          phone: args.phone,
          role: args.role || "employee",
        }),
      },
    );
    const raw = await r.json().catch(() => ({}));
    if (!r.ok) return { memberId: null, inviteUrl: null, raw };
    return {
      memberId: String((raw as any)?.member?.id || (raw as any)?.id || ""),
      inviteUrl: String((raw as any)?.invite_url || (raw as any)?.url || "") || null,
      raw,
    };
  } catch (err) {
    return { memberId: null, inviteUrl: null, raw: { error: (err as Error).message } };
  }
}

/**
 * Return the latest GPS pings for every member in the workspace. Used
 * by the admin map to plot live cleaner positions.
 */
export interface ApployeGpsPing {
  memberId: string;
  memberName: string | null;
  lat: number | null;
  lng: number | null;
  pingedAt: string | null;
  status: "clocked_in" | "clocked_out" | "on_break" | "unknown";
}

export async function fetchLiveGps(cfg: ApployeConfig): Promise<ApployeGpsPing[]> {
  try {
    const r = await apployeFetch(
      cfg,
      `/workspaces/${encodeURIComponent(cfg.workspaceId)}/live-tracking`,
    );
    if (!r.ok) return [];
    const j = await r.json();
    const list = (j.tracking || j.data || []) as Array<Record<string, any>>;
    return list.map((row) => ({
      memberId: String(row.member_id || row.id || ""),
      memberName: (row.member_name || row.name || null) as string | null,
      lat: typeof row.lat === "number" ? row.lat : Number(row.lat) || null,
      lng: typeof row.lng === "number" ? row.lng : Number(row.lng) || null,
      pingedAt: (row.timestamp || row.updated_at || null) as string | null,
      status: ((row.status || "unknown") as ApployeGpsPing["status"]),
    }));
  } catch (_) {
    return [];
  }
}

/**
 * Start a tracked task (= clock in to a specific job). Apploye logs the
 * timestamp + GPS automatically once the cleaner has the app open.
 */
export async function startTask(
  cfg: ApployeConfig,
  args: { memberId: string; taskName: string; projectId?: string },
): Promise<{ taskId: string | null; raw: unknown }> {
  try {
    const r = await apployeFetch(cfg, `/tasks/start`, {
      method: "POST",
      body: JSON.stringify({
        workspace_id: cfg.workspaceId,
        member_id: args.memberId,
        project_id: args.projectId,
        name: args.taskName,
      }),
    });
    const raw = await r.json().catch(() => ({}));
    if (!r.ok) return { taskId: null, raw };
    return { taskId: String((raw as any)?.task?.id || (raw as any)?.id || ""), raw };
  } catch (err) {
    return { taskId: null, raw: { error: (err as Error).message } };
  }
}

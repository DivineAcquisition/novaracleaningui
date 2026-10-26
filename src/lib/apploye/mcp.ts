// Node client for the Apploye MCP. Hours, members, clock-ins, and who is
// tracking. The allowlist in attendance.ts is what keeps screenshots, app
// usage, and URL reports from ever being requested.

import {
  APPLOYE_ORG_TIMEZONE,
  assertTimeTool,
  hoursByMember,
  parseMcpPayload,
  projectMember,
  trackedSecondsByMember,
  type ApployeMember,
  type ApployeTimeTool,
} from "@/lib/apploye/attendance";

const DEFAULT_URL = "https://mcp.apploye.com/mcp";

type SecretReader = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{ data: { value?: string | null } | null }>;
      };
    };
  };
};

export function isApployeMcpConfigured(): boolean {
  return Boolean((process.env.APPLOYE_MCP_API_KEY || "").trim());
}

/** Load the MCP key from app_secrets when the process env doesn't have it. */
export async function ensureApployeMcpKey(supabase: unknown): Promise<boolean> {
  if (isApployeMcpConfigured()) return true;
  try {
    const { data } = await (supabase as SecretReader)
      .from("app_secrets")
      .select("value")
      .eq("key", "APPLOYE_MCP_API_KEY")
      .maybeSingle();
    const value = String(data?.value || "").trim();
    if (!value) return false;
    process.env.APPLOYE_MCP_API_KEY = value;
    return true;
  } catch {
    return false;
  }
}

function mcpUrl(): string {
  return (process.env.APPLOYE_MCP_URL || DEFAULT_URL).replace(/\/+$/, "");
}

export async function callApployeTool(
  name: ApployeTimeTool,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  assertTimeTool(name);
  const apiKey = (process.env.APPLOYE_MCP_API_KEY || "").trim();
  if (!apiKey) throw new Error("APPLOYE_MCP_API_KEY is not set");

  const response = await fetch(mcpUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "x-apploye-api-key": apiKey,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Apploye MCP ${response.status}`);
  }
  return parseMcpPayload(text);
}

export async function listMcpMembers(): Promise<ApployeMember[]> {
  const members: ApployeMember[] = [];
  for (let page = 1; page <= 20; page++) {
    const payload = await callApployeTool("list_members", { page, limit: 100 }) as {
      results?: unknown[];
      has_more?: boolean;
    };
    for (const row of payload.results || []) {
      const member = projectMember(row);
      if (member) members.push(member);
    }
    if (!payload.has_more) break;
  }
  return members;
}

/** Tracked hours for one business day, keyed by Apploye member id. */
export async function hoursByMemberForDateFromMcp(
  date: string,
  timezone = APPLOYE_ORG_TIMEZONE,
): Promise<Map<string, number>> {
  const seconds = new Map<string, number>();
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const payload = await callApployeTool("list_timesheet_totals", {
      start_date: date,
      end_date: date,
      timezone,
      limit: 20,
      ...(cursor ? { cursor } : {}),
    }) as { has_more?: boolean; next_cursor?: string | null };
    for (const [id, tracked] of trackedSecondsByMember(payload)) {
      seconds.set(id, (seconds.get(id) || 0) + tracked);
    }
    cursor = payload.next_cursor || null;
    if (!payload.has_more || !cursor) break;
  }
  return hoursByMember(seconds);
}

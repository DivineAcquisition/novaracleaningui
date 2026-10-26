// Deno MCP client. Same allowlist as the Next.js client: identity and time.

import {
  assertTimeTool,
  parseMcpPayload,
  projectMember,
  type ApployeMember,
  type ApployeTimeTool,
} from "./apploye-attendance.ts";

const DEFAULT_URL = "https://mcp.apploye.com/mcp";

export interface McpConfig {
  apiKey: string;
  url: string;
}

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

async function readSecret(supabase: SupabaseLike, key: string): Promise<string> {
  try {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
    if (data?.value) return String(data.value).trim();
  } catch { /* fall through */ }
  return (Deno.env.get(key) || "").trim();
}

export async function getMcpConfig(supabase: SupabaseLike): Promise<McpConfig | null> {
  const apiKey = await readSecret(supabase, "APPLOYE_MCP_API_KEY");
  if (!apiKey) return null;
  const url = (await readSecret(supabase, "APPLOYE_MCP_URL") || DEFAULT_URL).replace(/\/+$/, "");
  return { apiKey, url };
}

export async function callApployeTool(
  cfg: McpConfig,
  name: ApployeTimeTool,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  assertTimeTool(name);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "x-apploye-api-key": cfg.apiKey,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Apploye MCP ${response.status}`);
    return parseMcpPayload(text);
  } finally {
    clearTimeout(timer);
  }
}

export async function listMcpMembers(cfg: McpConfig): Promise<ApployeMember[]> {
  const members: ApployeMember[] = [];
  for (let page = 1; page <= 20; page++) {
    const payload = await callApployeTool(cfg, "list_members", { page, limit: 100 }) as {
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

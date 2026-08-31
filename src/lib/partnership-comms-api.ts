import { supabase } from "@/integrations/supabase/client";
import type { PartnershipCommsSettings, PartnershipTemplate } from "@/lib/partnership-comms/types";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function call(path: string, method: string, body?: unknown): Promise<Record<string, any>> {
  const res = await fetch(path, {
    method,
    headers: await authHeaders(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out?.ok === false) throw new Error(out?.error || `Request failed (${res.status})`);
  return out;
}

export const partnershipCommsApi = {
  load: (query = "") => call(`/api/admin/partnership-comms${query}`, "GET"),
  saveSettings: (settings: PartnershipCommsSettings) =>
    call("/api/admin/partnership-comms", "PUT", { settings }),
  publishTemplate: (template: Partial<PartnershipTemplate> & { key: string }) =>
    call("/api/admin/partnership-comms", "POST", { action: "publish_template", template }),
  drain: () => call("/api/admin/partnership-comms", "POST", { action: "drain" }),
};

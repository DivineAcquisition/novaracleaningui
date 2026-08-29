import { supabase } from "@/integrations/supabase/client";

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

export const proposalApi = {
  list: (query = "") => call(`/api/admin/proposal-requests${query}`, "GET"),
  get: (id: string) => call(`/api/admin/proposal-requests/${id}`, "GET"),
  create: (body: unknown) => call("/api/admin/proposal-requests", "POST", body),
  cancel: (id: string, reason?: string) => call(`/api/admin/proposal-requests/${id}`, "PATCH", { action: "cancel", reason }),
  resendDocs: (id: string) => call(`/api/admin/proposal-requests/${id}`, "PATCH", { action: "resend_docs" }),
  candidates: (id: string) => call(`/api/admin/proposal-requests/${id}/assign`, "GET"),
  assign: (id: string, body: unknown) => call(`/api/admin/proposal-requests/${id}/assign`, "POST", body),
  checklists: () => call("/api/admin/proposal-checklists", "GET"),
  saveChecklists: (body: unknown) => call("/api/admin/proposal-checklists", "PUT", body),
  settings: () => call("/api/admin/proposal-settings", "GET"),
  saveSettings: (body: unknown) => call("/api/admin/proposal-settings", "PUT", body),
};

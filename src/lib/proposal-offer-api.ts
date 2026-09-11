import { supabase } from "@/integrations/supabase/client";

export async function proposalOfferApi(
  method: "GET" | "POST",
  body?: unknown,
  query = "",
): Promise<Record<string, any>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`/api/admin/proposal-offers${query}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out?.ok === false) {
    throw new Error(out?.error || out?.message || `Request failed (${res.status})`);
  }
  return out;
}

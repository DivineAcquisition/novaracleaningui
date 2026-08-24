// ─── Admin commercial proposal API client ──────────────────────────────────
//
// One fetch helper so the send workspace, the pipeline board, and the
// overview cards all talk to /api/admin/proposals the same way. Auth is the
// caller's session — the route refuses anyone who is not an admin or VA.

import { supabase } from "@/integrations/supabase/client";

export async function commercialProposalApi(
  method: "GET" | "POST",
  body?: unknown,
  query = "",
): Promise<Record<string, any>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`/api/admin/proposals${query}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out?.ok === false) {
    throw new Error(out?.error || `Request failed (${res.status})`);
  }
  return out;
}

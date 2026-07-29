// ─── Schedule guard: browser-side call helper ────────────────────────────────
//
// Kept apart from schedule-risk.ts because that file is pure types and is
// imported by the API route — pulling the browser Supabase client in there
// would drag client code into a server bundle.

import { supabase } from "@/integrations/supabase/client";

export interface ScheduleRiskResponse<T> {
  ok: boolean;
  data: T & { error?: string; code?: string; bufferConflict?: unknown };
}

/** POST an action to /api/admin/schedule-risk with the admin's own session. */
export async function callScheduleRisk<T = Record<string, unknown>>(
  body: Record<string, unknown>,
): Promise<ScheduleRiskResponse<T>> {
  const { data: session } = await supabase.auth.getSession();
  const res = await fetch("/api/admin/schedule-risk", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.session?.access_token || ""}`,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  return { ok: res.ok && json.ok !== false, data: json };
}

// Browser helper for the Urgent Hire edge function.

import { supabase } from "@/integrations/supabase/client";

export interface UrgentHireResponse<T> {
  ok: boolean;
  data: T & { error?: string; code?: string };
}

export async function callUrgentHire<T = Record<string, unknown>>(
  body: Record<string, unknown>,
): Promise<UrgentHireResponse<T>> {
  const { data: session } = await supabase.auth.getSession();
  const { data, error } = await supabase.functions.invoke("urgent-hire", {
    body,
    headers: session.session?.access_token
      ? { Authorization: `Bearer ${session.session.access_token}` }
      : undefined,
  });
  if (error) {
    let message = error.message || "Urgent Hire request failed.";
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        const parsed = (await ctx.json()) as { error?: string };
        if (parsed?.error) message = parsed.error;
      }
    } catch {
      /* keep message */
    }
    return { ok: false, data: { error: message } as T & { error?: string } };
  }
  const json = (data || {}) as T & { ok?: boolean; error?: string };
  return { ok: json.ok !== false && !json.error, data: json };
}

// Browser helper for the Urgent Hire edge function.

import { supabase } from "@/integrations/supabase/client";
import { asErrorMessage, describeEdgeError } from "@/lib/edge-invoke";

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
  const json = (data && typeof data === "object" ? data : {}) as T & {
    ok?: boolean;
    error?: unknown;
    code?: string;
  };
  if (error || json.ok === false || json.error) {
    const fromBody = asErrorMessage(json.error, "");
    const message =
      fromBody ||
      (await describeEdgeError(error, data)) ||
      "Urgent Hire request failed.";
    return {
      ok: false,
      data: { ...json, error: asErrorMessage(message, "Urgent Hire request failed.") },
    };
  }
  return { ok: true, data: json as T & { error?: string; code?: string } };
}

// ─── Termination SMS copy ───────────────────────────────────────────────────
//
// Keep this file in lock-step with supabase/functions/_shared/termination-sms.ts.
// Sent once when a cleaner first flips to status=terminated (admin terminate,
// status change, accountability removal, pulse-check leave / silence).

export const TERMINATION_SMS_HR = "hr@novaracleaning.com";

/** Short account-closed notice. No reason line — the email letter covers that. */
export function buildTerminationSms(): string {
  return (
    `Novara: Your contractor engagement has ended. ` +
    `Portal access and new jobs are closed. ` +
    `Questions: ${TERMINATION_SMS_HR}`
  );
}

type InvokeClient = {
  functions: {
    invoke: (
      name: string,
      args: { body: unknown },
    ) => Promise<{ data?: unknown; error?: unknown }>;
  };
};

/**
 * Best-effort termination SMS from the Next.js app (pulse self-serve leave).
 * Honors STOP via GHL. Telnyx is only a fallback. Never throws.
 */
export async function notifyContractorTerminated(
  supabase: InvokeClient,
  phone?: string | null,
): Promise<boolean> {
  const to = String(phone || "").trim();
  if (!to) return false;
  const message = buildTerminationSms();
  try {
    const { data, error } = await supabase.functions.invoke("send-ghl-sms", {
      body: { phone: to, message, type: "confirmation" },
    });
    const ghlError = error || (data as { error?: string } | null)?.error;
    if (!ghlError) return true;
    const errText = typeof ghlError === "string"
      ? ghlError
      : String((ghlError as { message?: string })?.message || ghlError);
    if (/unsubscrib/i.test(errText)) return true;
    const fallback = await supabase.functions.invoke("send-sms-notification", {
      body: { toPhone: to, message, type: "confirmation" },
    });
    return !fallback.error;
  } catch {
    return false;
  }
}

// ─── SMS helper (Telnyx via send-sms-notification) ─────────────────────────
//
// Thin wrapper over the existing `send-sms-notification` Edge Function so
// other functions can fire SMS without duplicating boilerplate. Failures are
// swallowed and logged — callers should treat SMS as best-effort.

// deno-lint-ignore no-explicit-any
type SupabaseClientLike = { functions: { invoke: (name: string, opts: any) => Promise<any> } };

export type SmsType = "job_offer" | "reminder" | "confirmation" | "verification";

export interface SendSmsArgs {
  toPhone: string | null | undefined;
  message: string;
  type?: SmsType;
  jobAssignmentId?: string;
}

const SUPPORTED_TYPES: SmsType[] = ["job_offer", "reminder", "confirmation", "verification"];

/**
 * Fire a Telnyx SMS via the `send-sms-notification` Edge Function.
 * Never throws — returns true if the invocation succeeded, false otherwise.
 */
export async function sendSms(
  supabase: SupabaseClientLike,
  args: SendSmsArgs,
): Promise<boolean> {
  const phone = (args.toPhone || "").toString().trim();
  if (!phone) {
    console.log("[sendSms] Skipped — no phone");
    return false;
  }
  if (!args.message || !args.message.trim()) {
    console.log("[sendSms] Skipped — no message");
    return false;
  }

  const type: SmsType = args.type && SUPPORTED_TYPES.includes(args.type) ? args.type : "confirmation";

  try {
    const { error } = await supabase.functions.invoke("send-sms-notification", {
      body: {
        toPhone: phone,
        message: args.message,
        type,
        jobAssignmentId: args.jobAssignmentId,
      },
    });
    if (error) {
      console.error("[sendSms] invoke error", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[sendSms] threw", err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * Build a friendly "Mon, Jan 5" style label for a YYYY-MM-DD date string.
 * Falls back to the raw string if parsing fails.
 */
export function formatServiceDate(dateStr?: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(`${dateStr}T12:00:00`);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

/**
 * Build a "8:00 AM – 12:00 PM" style label for a stored time-slot id.
 */
export function formatTimeSlot(slot?: string | null): string {
  if (!slot) return "";
  const map: Record<string, string> = {
    "8-12": "8:00 AM – 12:00 PM",
    "12-16": "12:00 PM – 4:00 PM",
    "16-20": "4:00 PM – 8:00 PM",
  };
  return map[slot] || slot;
}

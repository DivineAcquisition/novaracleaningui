// ─── Termination SMS copy ───────────────────────────────────────────────────
//
// Keep this file in lock-step with src/lib/termination-sms.ts.
// Sent once when a cleaner first flips to status=terminated (admin terminate,
// status change, accountability removal, pulse-check leave / silence).

import { sendSms } from "./sms.ts";

export const TERMINATION_SMS_HR = "hr@novaracleaning.com";

/** Short account-closed notice. No reason line — the email letter covers that. */
export function buildTerminationSms(): string {
  return (
    `Novara: Your contractor engagement has ended. ` +
    `Portal access and new jobs are closed. ` +
    `Questions: ${TERMINATION_SMS_HR}`
  );
}

// deno-lint-ignore no-explicit-any
type SupabaseClientLike = { functions: { invoke: (name: string, opts: any) => Promise<any> } };

/** Best-effort SMS. Honors STOP via sendSms. Skips empty phones. Never throws. */
export async function notifyContractorTerminated(
  admin: SupabaseClientLike,
  cleaner: { phone?: string | null },
): Promise<boolean> {
  try {
    return await sendSms(admin, {
      toPhone: cleaner.phone,
      message: buildTerminationSms(),
      type: "confirmation",
    });
  } catch (err) {
    console.warn(
      "[termination-sms] send failed",
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

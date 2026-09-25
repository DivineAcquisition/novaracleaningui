// ─── Applicant received email ─────────────────────────────────────────────────
//
// Sent when a new applicant row is created (hiring site, manual intake, or a
// recent Airtable import). Tells them we have the application and that a phone
// call or text to set up a phone screen happens only if they are selected.
// Best-effort: a missing Resend key or a bounce must never block intake.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { applicantReceivedEmail } from "@/lib/talent/received-email-copy";

const FROM = "Novara Cleaning Team <team@novaracleaning.com>";

export interface ReceivedEmailResult {
  sent: boolean;
  error: string | null;
}

export { applicantReceivedEmail };

async function resolveResendKey(): Promise<string> {
  const fromEnv = (process.env.RESEND_API_KEY || "").trim();
  if (fromEnv) return fromEnv;
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase.from("app_secrets").select("value").eq("key", "RESEND_API_KEY").maybeSingle();
    return String(data?.value || "").trim();
  } catch {
    return "";
  }
}

/**
 * Email a new applicant that we received their application and that a phone
 * screen is scheduled by call or text only if they are selected.
 * Does not throw — callers treat delivery as informational.
 */
export async function sendApplicantReceivedEmail(args: {
  email: string | null | undefined;
  firstName?: string | null;
  fullName?: string | null;
}): Promise<ReceivedEmailResult> {
  const to = String(args.email || "").trim().toLowerCase();
  if (!to || !to.includes("@")) {
    return { sent: false, error: "No email on the applicant record." };
  }

  const key = await resolveResendKey();
  if (!key) {
    return { sent: false, error: "RESEND_API_KEY is not configured." };
  }

  const content = applicantReceivedEmail(args);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject: content.subject,
        html: content.html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { sent: false, error: `Resend ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}` };
    }
    return { sent: true, error: null };
  } catch (err) {
    return { sent: false, error: (err as Error).message || "Failed to send application email" };
  }
}

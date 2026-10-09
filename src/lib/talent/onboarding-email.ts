// ─── Cleaner onboarding invite email ──────────────────────────────────────────
//
// Launch and resend used to ask the send-cleaner-email edge function for the
// branded invite. That function treated a Resend error object as success, so
// the hub could report "email sent" while the cleaner only received the text.
// This sender talks to Resend directly — the same path as the rejection email —
// and only reports sent when the API accepts the message.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { buildOnboardingInviteEmail, usableInviteEmail } from "@/lib/talent/onboarding-invite";

const FROM = "NVC Operations <operations@novaracleaning.com>";
const REPLY_TO = "operations@novaracleaning.com";

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

export async function sendOnboardingInviteEmail(args: {
  email: string | null | undefined;
  firstName?: string | null;
  onboardingUrl: string;
}): Promise<{ sent: boolean; error: string | null }> {
  const to = usableInviteEmail(args.email);
  if (!to) {
    const raw = String(args.email || "").trim();
    if (!raw) return { sent: false, error: "No email on the applicant record." };
    if (raw.toLowerCase().endsWith("@pending.novara")) {
      return { sent: false, error: "Placeholder email address on file." };
    }
    return { sent: false, error: `"${raw}" isn't a sendable email address.` };
  }

  const url = String(args.onboardingUrl || "").trim();
  if (!url.startsWith("https://") || !url.includes("invite=")) {
    return { sent: false, error: "Onboarding link was not ready to email." };
  }

  const key = await resolveResendKey();
  if (!key) return { sent: false, error: "RESEND_API_KEY is not configured." };

  const { subject, html } = buildOnboardingInviteEmail({
    firstName: args.firstName,
    onboardingUrl: url,
  });

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        reply_to: REPLY_TO,
        to: [to],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { sent: false, error: `Resend ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}` };
    }
    return { sent: true, error: null };
  } catch (err) {
    return { sent: false, error: (err as Error).message || "Failed to send onboarding email" };
  }
}

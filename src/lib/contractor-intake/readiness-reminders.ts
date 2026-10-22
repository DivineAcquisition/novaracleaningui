// Sends the existing reminder hours (24 and 48 by default) after "Not yet".
// Text only when the applicant agreed to texts. A yes answer or a passed deadline stops them.

import type { SupabaseClient } from "@supabase/supabase-js";
import { dueReminderHours, fillBeforeCopy, parseReadiness } from "./before-you-start";
import { applicantMessage } from "./messages";
import { INTAKE_SETTINGS_KEY, mergeIntakeSettings } from "./settings";
import { deliverCompliantEmail } from "@/lib/email-compliance/deliver";
import { beforeYouStartUrl } from "@/lib/site-hosts";

export async function sendDueReadinessReminders(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<{ sent: number }> {
  const { data: settingsRow } = await supabase.from("app_settings").select("value").eq("key", INTAKE_SETTINGS_KEY).maybeSingle();
  const settings = mergeIntakeSettings(settingsRow?.value as Partial<import("./settings").IntakeSettings> | null);
  const since = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows } = await supabase
    .from("cleaner_applicants")
    .select("id, email, phone, first_name, invite_token, invite_expires_at, onboarding_launched_at, submission")
    .eq("stage", "onboarding")
    .gte("onboarding_launched_at", since)
    .limit(200);

  const { data: secret } = await supabase.from("app_secrets").select("value").eq("key", "RESEND_API_KEY").maybeSingle();
  const apiKey = String(secret?.value || "");
  let sent = 0;
  for (const row of rows || []) {
    const submission = row.submission && typeof row.submission === "object" ? row.submission as Record<string, unknown> : {};
    const readiness = parseReadiness(submission.readiness);
    const due = dueReminderHours({
      answer: readiness.answer,
      launchedAt: row.onboarding_launched_at ? String(row.onboarding_launched_at) : null,
      deadlineAt: row.invite_expires_at ? String(row.invite_expires_at) : null,
      hours: settings.reminderHours,
      sent: readiness.remindersSent,
      now,
    });
    if (!due.length || !row.invite_token) continue;
    const deadline = row.invite_expires_at
      ? new Date(String(row.invite_expires_at)).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric" })
      : "the date on your link";
    const link = beforeYouStartUrl(String(row.invite_token));
    const notice = applicantMessage("reminder", {
      firstName: row.first_name,
      body: fillBeforeCopy("Your link is open until {deadline}.", { deadline }),
      link,
    });
    const consent = submission.consentRecord && typeof submission.consentRecord === "object"
      ? submission.consentRecord as { smsConsent?: boolean }
      : {};
    let delivered = false;
    if (apiKey && row.email) {
      const mail = await deliverCompliantEmail(supabase, {
        to: String(row.email),
        subject: notice.subject,
        html: `<p>${notice.text.replace(/\n/g, "<br>")}</p>`,
        apiKey,
        declaredType: "contractor_operational",
        templateKey: "readiness_reminder",
      });
      delivered = mail.ok;
    }
    if (consent.smsConsent && row.phone) {
      await supabase.functions.invoke("send-ghl-sms", {
        body: { phone: row.phone, message: `Novara Cleaning: Your link is open until ${deadline}. ${link} Msg&data rates may apply. Reply STOP to opt out, HELP for help. https://novaracleaning.com/privacy`, type: "confirmation", firstName: row.first_name },
      });
      delivered = true;
    }
    if (!delivered) continue;
    const next = { ...readiness, remindersSent: [...readiness.remindersSent, ...due] };
    await supabase.from("cleaner_applicants").update({
      submission: { ...submission, readiness: next },
      updated_at: now.toISOString(),
    }).eq("id", row.id);
    sent += 1;
  }
  return { sent };
}

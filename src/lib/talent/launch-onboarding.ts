// Opens the existing contractor onboarding after a conditional approval.
// No phone screening is created or required.

import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeResult } from "@/lib/edge-invoke";
import { applicantMessage } from "@/lib/contractor-intake/messages";
import { applicantDeadline } from "@/lib/contractor-intake/onboarding";
import { DEFAULT_INTAKE_SETTINGS, type IntakeSettings } from "@/lib/contractor-intake/settings";
import { beforeYouStartUrl } from "@/lib/site-hosts";
import { sendOnboardingInviteEmail } from "@/lib/talent/onboarding-email";
import { usableInviteEmail } from "@/lib/talent/onboarding-invite";

export function onboardingInviteUrl(token: string): string {
  return beforeYouStartUrl(token);
}

function usablePhone(input: string | null | undefined): string | null {
  const digits = String(input || "").replace(/[^0-9]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export async function launchConditionalOnboarding(
  supabase: SupabaseClient,
  applicant: {
    id: string;
    email: string | null;
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
    zip: string | null;
    state: string | null;
  smsConsent: boolean;
  leadTrack: boolean;
},
  settings: IntakeSettings = DEFAULT_INTAKE_SETTINGS,
): Promise<{ inviteUrl: string; emailed: boolean; smsSent: boolean; emailError: string | null; smsError: string | null; cleanerId: string | null }> {
  let cleanerId: string | null = null;
  if (applicant.email) {
    const { data: found } = await supabase.from("cleaners").select("id").ilike("email", applicant.email).maybeSingle();
    cleanerId = (found?.id as string) || null;
  }
  if (!cleanerId) {
    const payload = {
      first_name: applicant.firstName,
      last_name: applicant.lastName || "",
      email: applicant.email,
      phone: applicant.phone,
      home_zip: applicant.zip,
      state: applicant.state || null,
      status: "pending",
      approved: false,
      onboarding_complete: false,
      invited_at: new Date().toISOString(),
      intake_flow: "automated",
      kit_confirmed: false,
      background_cleared: false,
      lead_track: applicant.leadTrack,
      lead_status: null,
    };
    let created = await supabase.from("cleaners").insert(payload).select("id").single();
    if (created.error && /intake_flow|kit_confirmed|background_cleared|lead_track|lead_status/.test(created.error.message)) {
      const { intake_flow: _a, kit_confirmed: _b, background_cleared: _c, lead_track: _d, lead_status: _e, ...base } = payload;
      void _a; void _b; void _c; void _d; void _e;
      created = await supabase.from("cleaners").insert(base).select("id").single();
    }
    if (created.error || !created.data) throw new Error(created.error?.message || "Could not open onboarding.");
    cleanerId = created.data.id as string;
  } else {
    await supabase.from("cleaners").update({
      intake_flow: "automated",
      kit_confirmed: false,
      background_cleared: false,
      lead_track: applicant.leadTrack,
      updated_at: new Date().toISOString(),
    }).eq("id", cleanerId);
  }

  const token = randomBytes(24).toString("hex");
  const inviteUrl = onboardingInviteUrl(token);
  const expires = applicantDeadline(new Date(), settings).toISOString();
  const invitePatch = {
    stage: "onboarding",
    intake_stage: "conditional_approval",
    cleaner_id: cleanerId,
    invite_token: token,
    invite_expires_at: expires,
    invite_sent_at: new Date().toISOString(),
    onboarding_launched_at: new Date().toISOString(),
    stage_changed_at: new Date().toISOString(),
    stage_changed_by: "hiring-site",
  };
  const invited = await supabase.from("cleaner_applicants").update(invitePatch).eq("id", applicant.id);
  if (invited.error && /intake_stage/.test(invited.error.message)) {
    const { intake_stage: _stage, ...base } = invitePatch;
    void _stage;
    const retry = await supabase.from("cleaner_applicants").update(base).eq("id", applicant.id);
    if (retry.error) throw new Error(retry.error.message);
  } else if (invited.error) {
    throw new Error(invited.error.message);
  }

  const email = usableInviteEmail(applicant.email);
  let emailed = false;
  let emailError: string | null = null;
  if (email) {
    const mail = await sendOnboardingInviteEmail({ email, firstName: applicant.firstName, onboardingUrl: inviteUrl });
    emailed = mail.sent;
    emailError = mail.error;
  } else {
    emailError = "No email on the application.";
  }

  let smsSent = false;
  let smsError: string | null = null;
  const phone = usablePhone(applicant.phone);
  if (!applicant.smsConsent) {
    smsError = "Texts were not sent because this applicant did not agree to application texts.";
  } else if (!phone) {
    smsError = "No sendable mobile number.";
  } else {
    const message = applicantMessage("conditional_approval", { firstName: applicant.firstName, link: inviteUrl }).text;
    const { data, error } = await supabase.functions.invoke("send-ghl-sms", {
      body: { phone, message, type: "confirmation", firstName: applicant.firstName },
    });
    const ghl = await edgeResult(error, data);
    smsSent = ghl.ok;
    if (!ghl.ok) smsError = ghl.error;
  }

  return { inviteUrl, emailed, smsSent, emailError, smsError, cleanerId };
}

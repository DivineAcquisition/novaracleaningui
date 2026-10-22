// The page between conditional approval and onboarding.
// The readiness answer is recorded. It does not approve, reject, or score anyone.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  beforeCopy,
  beforeYouStartSteps,
  beforeYouStartTotal,
  fillBeforeCopy,
  markViewed,
  parseReadiness,
  readyItemsForRole,
  recordReadiness,
  type ReadinessAnswer,
} from "@/lib/contractor-intake/before-you-start";
import { deliverCompliantEmail } from "@/lib/email-compliance/deliver";
import { INTAKE_SETTINGS_KEY, INTAKE_WORDING_KEY, mergeIntakeSettings } from "@/lib/contractor-intake/settings";
import { INTAKE_WORDING, type WordingVersion } from "@/lib/contractor-intake/wording";
import { beforeYouStartHostAllowed, contractorOnboardingUrl, requestHost } from "@/lib/site-hosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function deadlineLabel(iso: string | null): string {
  if (!iso) return "the date on your link";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "the date on your link";
  return date.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric" });
}

async function loadApplicant(token: string) {
  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("cleaner_applicants")
    .select("id, email, phone, first_name, full_name, role, stage, invite_expires_at, onboarding_launched_at, submission")
    .eq("invite_token", token)
    .maybeSingle();
  return { supabase, data, error };
}

function wordingOf(stored: unknown): WordingVersion[] {
  const rows = Array.isArray(stored) ? stored as WordingVersion[] : [];
  if (!rows.length) return INTAKE_WORDING;
  return INTAKE_WORDING.map((seed) => rows.find((row) => row.id === seed.id) || seed);
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!beforeYouStartHostAllowed(requestHost(req))) {
    return NextResponse.json({ error: "This page opens from your approval link." }, { status: 403 });
  }
  const token = new URL(req.url).searchParams.get("invite")?.trim() || "";
  if (token.length < 16) return NextResponse.json({ error: "This link is not valid." }, { status: 400 });

  const { supabase, data, error } = await loadApplicant(token);
  if (error) return NextResponse.json({ error: "This page is unavailable right now." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });

  const { data: settingsRow } = await supabase.from("app_settings").select("value").eq("key", INTAKE_SETTINGS_KEY).maybeSingle();
  const settings = mergeIntakeSettings(settingsRow?.value as Partial<import("@/lib/contractor-intake/settings").IntakeSettings> | null);
  const { data: wordingRow } = await supabase.from("app_settings").select("value").eq("key", INTAKE_WORDING_KEY).maybeSingle();
  const wording = wordingOf(wordingRow?.value);
  const submission = data.submission && typeof data.submission === "object" ? data.submission as Record<string, unknown> : {};
  const now = new Date().toISOString();
  const readiness = markViewed(parseReadiness(submission.readiness), now);
  if (!parseReadiness(submission.readiness).viewedAt) {
    await supabase.from("cleaner_applicants").update({
      submission: { ...submission, readiness },
      updated_at: now,
    }).eq("id", data.id);
  }

  const expired = !data.invite_expires_at || new Date(String(data.invite_expires_at)).getTime() < Date.now();
  const deadline = deadlineLabel(data.invite_expires_at ? String(data.invite_expires_at) : null);
  const steps = beforeYouStartSteps(settings.beforeStartMinutes);
  const values = { deadline, days: settings.identityImageDeleteDays };
  return NextResponse.json({
    ok: true,
    expired,
    countsAsRejection: false,
    deadline,
    answer: readiness.answer,
    title: fillBeforeCopy(beforeCopy("before_start_title", wording), values),
    intro: fillBeforeCopy(beforeCopy("before_start_intro", wording), values),
    question: beforeCopy("before_start_question", wording),
    notYet: fillBeforeCopy(beforeCopy("before_start_not_yet", wording), values),
    safety: [
      fillBeforeCopy(beforeCopy("before_start_safety_id", wording), values),
      beforeCopy("before_start_safety_ssn", wording),
      beforeCopy("before_start_safety_contractor", wording),
    ],
    steps,
    totalMinutes: beforeYouStartTotal(steps),
    ready: readyItemsForRole(String(data.role || "")),
    contactEmail: settings.applicantEmail,
    contactPhone: settings.applicantPhone,
    privacyUrl: "https://novaracleaning.com/privacy",
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!beforeYouStartHostAllowed(requestHost(req))) {
    return NextResponse.json({ error: "This page opens from your approval link." }, { status: 403 });
  }
  let body: { invite?: string; answer?: string; request?: string };
  try {
    body = await req.json() as { invite?: string; answer?: string; request?: string };
  } catch {
    return NextResponse.json({ error: "Could not read that answer." }, { status: 400 });
  }
  const token = String(body.invite || "").trim();
  if (token.length < 16) return NextResponse.json({ error: "This link is not valid." }, { status: 400 });
  const { supabase, data, error } = await loadApplicant(token);
  if (error || !data) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });

  const submission = data.submission && typeof data.submission === "object" ? data.submission as Record<string, unknown> : {};
  const expired = !data.invite_expires_at || new Date(String(data.invite_expires_at)).getTime() < Date.now();
  const now = new Date().toISOString();

  if (body.request === "new_link") {
    if (!expired) return NextResponse.json({ error: "This link is still open." }, { status: 400 });
    await supabase.from("events").insert({
      event_type: "applicant.readiness_new_link",
      source: "before-you-start",
      summary: `${data.full_name || data.email || "An applicant"} asked for a new onboarding link.`,
      data: { applicant_id: data.id, email: data.email },
    });
    const { data: secret } = await supabase.from("app_secrets").select("value").eq("key", "RESEND_API_KEY").maybeSingle();
    if (secret?.value) {
      await deliverCompliantEmail(supabase, {
        to: "operations@novaracleaning.com",
        subject: "Onboarding link request",
        html: `<p>${data.full_name || "An applicant"} (${data.email || "no email"}) asked for a new onboarding link after theirs expired. This is not a rejection.</p>`,
        apiKey: String(secret.value),
        declaredType: "internal_admin",
        templateKey: "internal_admin",
        staffRecipient: true,
      });
    }
    return NextResponse.json({
      ok: true,
      countsAsRejection: false,
      message: "A person at Novara will send a new link. This is not a rejection.",
    });
  }

  if (expired) {
    return NextResponse.json({
      ok: false,
      expired: true,
      countsAsRejection: false,
      error: "This link is no longer open. You can request a new one.",
    }, { status: 410 });
  }

  const answer = body.answer === "yes" || body.answer === "not_yet" ? body.answer : null;
  if (!answer) return NextResponse.json({ error: "Choose yes or not yet." }, { status: 400 });
  const readiness = recordReadiness(markViewed(parseReadiness(submission.readiness), now), answer as ReadinessAnswer, now);
  const saved = await supabase.from("cleaner_applicants").update({
    submission: { ...submission, readiness },
    updated_at: now,
  }).eq("id", data.id);
  if (saved.error) return NextResponse.json({ error: "Could not save that answer." }, { status: 500 });

  if (answer === "yes") {
    return NextResponse.json({ ok: true, nextUrl: contractorOnboardingUrl(token), countsAsRejection: false });
  }
  const { data: settingsRow } = await supabase.from("app_settings").select("value").eq("key", INTAKE_SETTINGS_KEY).maybeSingle();
  const settings = mergeIntakeSettings(settingsRow?.value as Partial<import("@/lib/contractor-intake/settings").IntakeSettings> | null);
  const { data: wordingRow } = await supabase.from("app_settings").select("value").eq("key", INTAKE_WORDING_KEY).maybeSingle();
  const deadline = deadlineLabel(data.invite_expires_at ? String(data.invite_expires_at) : null);
  return NextResponse.json({
    ok: true,
    countsAsRejection: false,
    message: fillBeforeCopy(beforeCopy("before_start_not_yet", wordingOf(wordingRow?.value)), { deadline, days: settings.identityImageDeleteDays }),
  });
}

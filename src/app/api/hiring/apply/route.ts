// ─── POST /api/hiring/apply ───────────────────────────────────────────────────
//
// Public application for hiring.novaracleaning.com.
//
// A complete application is decided by yes/no rules: conditional approval,
// not a fit, waitlist, or needs review. A pass opens the existing onboarding.
// No photo ID, work authorization, or phone screening is collected here.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { primeAirtablePat } from "@/lib/airtable/sources/prime-pat";
import {
  createTalentApplicantInAirtable,
  updateTalentApplicantInAirtable,
  type CreateTalentApplicantInput,
  type TalentApplicant,
} from "@/lib/airtable/talent";
import {
  phoneDigits,
  isApplicationIssue,
  buildHiringConsentRecord,
  validateHiringApplication,
  type HiringApplicationDraft,
  type NormalizedHiringApplication,
} from "@/lib/hiring/application";
import { isHiringToken } from "@/lib/hiring/session";
import { isReapplyBlocked } from "@/lib/pulse-check/roster";
import { decideApplication } from "@/lib/contractor-intake/decide";
import { applicantMessage } from "@/lib/contractor-intake/messages";
import { INTAKE_SETTINGS_KEY, mergeIntakeSettings } from "@/lib/contractor-intake/settings";
import { INTAKE_WORDING } from "@/lib/contractor-intake/wording";
import { launchConditionalOnboarding } from "@/lib/talent/launch-onboarding";
import { deliverCompliantEmail } from "@/lib/email-compliance/deliver";
import { applicationHostAllowed, HIRING_ORIGIN, requestHost } from "@/lib/site-hosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}

function flag(form: FormData, key: string): boolean {
  return str(form, key) === "true";
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first.slice(0, 64);
  const real = req.headers.get("x-real-ip")?.trim();
  return real ? real.slice(0, 64) : null;
}

function isMissingConsentColumn(message: string): boolean {
  return /age_18|valid_drivers_license|auto_insured|sms_consent|answers_accurate|consent_version|consent_accepted_at|consent_ip|consent_user_agent|consent_record/.test(
    message,
  ) && /does not exist|schema cache|Could not find/i.test(message);
}

function isMissingIntakeColumn(message: string): boolean {
  return /intake_stage|intake_decision|reapply_on|email_consent|lead_track/.test(message)
    && /does not exist|schema cache|Could not find/i.test(message);
}

function withoutIntakeColumns(payload: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...payload };
  delete copy.intake_stage;
  delete copy.intake_decision;
  delete copy.reapply_on;
  delete copy.email_consent;
  return copy;
}

type ApplicantRow = {
  id: string;
  stage: string;
  airtable_record_id: string | null;
  government_id_path: string | null;
};

async function writeApplicant(
  supabase: ReturnType<typeof getAdminSupabase>,
  existing: ApplicantRow | null,
  fields: Record<string, unknown>,
  consentColumns: Record<string, unknown>,
): Promise<{ applicantId: string; created: boolean }> {
  const write = async (includeConsentColumns: boolean) => {
    const payload = includeConsentColumns ? { ...fields, ...consentColumns } : fields;
    if (existing) {
      const { error } = await supabase
        .from("cleaner_applicants")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      return { error, applicantId: existing.id, created: false };
    }
    const { data: created, error } = await supabase
      .from("cleaner_applicants")
      .insert({
        ...payload,
        stage: (payload.stage as string) || "applicant",
        stage_changed_at: new Date().toISOString(),
        stage_changed_by: "hiring-site",
      })
      .select("id")
      .single();
    return { error, applicantId: created?.id as string | undefined, created: true };
  };

  let result = await write(true);
  if (result.error && isMissingIntakeColumn(result.error.message)) {
    const stripped = withoutIntakeColumns(fields);
    result = await (async () => {
      if (existing) {
        const { error } = await supabase.from("cleaner_applicants").update({ ...stripped, ...consentColumns, updated_at: new Date().toISOString() }).eq("id", existing.id);
        return { error, applicantId: existing.id, created: false };
      }
      const { data: created, error } = await supabase.from("cleaner_applicants").insert({
        ...stripped,
        ...consentColumns,
        stage: (stripped.stage as string) || "applicant",
        stage_changed_at: new Date().toISOString(),
        stage_changed_by: "hiring-site",
      }).select("id").single();
      return { error, applicantId: created?.id as string | undefined, created: true };
    })();
  }
  if (result.error && isMissingConsentColumn(result.error.message)) {
    // eslint-disable-next-line no-console
    console.warn("[hiring/apply] consent columns missing; saved wording on submission jsonb");
    result = await write(false);
  }
  if (result.error || !result.applicantId) {
    throw new Error(result.error?.message || "Could not save the applicant");
  }
  return { applicantId: result.applicantId, created: result.created };
}

function isAirtableId(id: string | null | undefined): id is string {
  return !!id && id.startsWith("rec");
}

function airtableInput(
  app: NormalizedHiringApplication,
  idUrl: string,
  idFilename: string,
): CreateTalentApplicantInput {
  return {
    fullName: app.fullName,
    email: app.email,
    phone: app.phone,
    zipCode: app.zipCode,
    state: app.state,
    address: app.address,
    role: app.role,
    department: app.department,
    contractorType: app.contractorType,
    availability: app.availability,
    experience: app.experience,
    preferredDays: app.preferredDays,
    transportation: app.transportation,
    authorizedToWork: null,
    consent1099: app.consent1099,
    backgroundCheckConsent: false,
    payConsent: false,
    willingToGetSupplies: app.willingToGetSupplies,
    suppliesOnHand: app.suppliesOnHand,
    reliabilityNote: app.reliabilityNote,
    notes: app.reasonNote,
    governmentIdUrl: idUrl,
    governmentIdFilename: idFilename,
  };
}

function draftFromForm(form: FormData, file: File | null): HiringApplicationDraft {
  let preferredDays: string[] = [];
  try {
    const parsed = JSON.parse(str(form, "preferredDays") || "[]");
    if (Array.isArray(parsed)) preferredDays = parsed.map((d) => String(d));
  } catch {
    preferredDays = [];
  }
  return {
    role: str(form, "role"),
    firstName: str(form, "firstName"),
    lastName: str(form, "lastName"),
    email: str(form, "email"),
    phone: str(form, "phone"),
    address: str(form, "address"),
    city: str(form, "city"),
    zipCode: str(form, "zipCode"),
    state: str(form, "state"),
    contractorType: str(form, "contractorType"),
    transportation: str(form, "transportation"),
    authorizedToWork: str(form, "authorizedToWork"),
    experience: str(form, "experience"),
    availability: str(form, "availability"),
    preferredDays,
    consent1099: flag(form, "consent1099"),
    backgroundCheckConsent: flag(form, "backgroundCheckConsent"),
    payConsent: flag(form, "payConsent"),
    age18: flag(form, "age18"),
    validDriversLicense: flag(form, "validDriversLicense"),
    autoInsured: flag(form, "autoInsured"),
    smsConsent: flag(form, "smsConsent"),
    answersAccurate: flag(form, "answersAccurate"),
    willingToGetSupplies: str(form, "willingToGetSupplies"),
    suppliesOnHand: str(form, "suppliesOnHand"),
    reliabilityNote: str(form, "reliabilityNote"),
    reasonNote: str(form, "reasonNote"),
    idConfirmed: flag(form, "idConfirmed"),
    idFile: file ? { name: file.name, type: file.type, size: file.size } : null,
    hiringRole: str(form, "hiringRole") || null,
    emailConsent: flag(form, "emailConsent"),
    hasSmartphone: str(form, "hasSmartphone"),
    hasVehicle: str(form, "hasVehicle"),
    willHaveKit: str(form, "willHaveKit"),
    understandsContractor: str(form, "understandsContractor"),
    understandsVerification: str(form, "understandsVerification"),
    ageAnswer: str(form, "ageAnswer"),
    jobsPerWeek: Number(str(form, "jobsPerWeek") || 0),
    timeWindows: jsonList(str(form, "timeWindows")),
    cleaningTypes: jsonList(str(form, "cleaningTypes")),
    experienceYears: str(form, "experienceYears"),
    privacyAccepted: flag(form, "privacyAccepted"),
    leadRoleOpen: flag(form, "leadRoleOpen"),
  };
}

function jsonList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Could not read the application." }, { status: 400 });
  }

  // Honeypot. Pretend it worked so a bot doesn't retry.
  if (str(form, "faxNumber").trim()) {
    return NextResponse.json({ ok: true });
  }

  if (!applicationHostAllowed(requestHost(req))) {
    return NextResponse.json(
      {
        error: `Applications are accepted only at ${HIRING_ORIGIN}/hiring/apply.`,
        code: "wrong_host",
      },
      { status: 403 },
    );
  }

  const uploaded = form.get("idFile");
  const file = uploaded instanceof File && uploaded.size > 0 ? uploaded : null;
  const validated = validateHiringApplication(draftFromForm(form, file));
  if (isApplicationIssue(validated)) {
    return NextResponse.json(
      { error: validated.error, code: validated.code, gate: validated.gate },
      { status: validated.status },
    );
  }
  const app = validated.value;
  const acceptedAt = new Date().toISOString();
  const ip = clientIp(req);
  const userAgent = req.headers.get("user-agent");
  const consentRecord = {
    ...buildHiringConsentRecord({ acceptedAt, ip, userAgent }),
    smsConsent: app.smsConsent,
    emailConsent: app.emailConsent,
    backgroundCheckConsent: false,
    payConsent: false,
    idConfirmed: false,
    acceptances: INTAKE_WORDING.filter((row) => {
      if (row.id === "application_sms") return app.smsConsent;
      if (row.id === "application_email") return app.emailConsent;
      if (row.id === "independent_contractor") return app.understandsContractorWork;
      if (row.id === "application_privacy") return app.privacyAccepted;
      return false;
    }).map((row) => ({
      id: row.id,
      version: row.version,
      status: row.status,
      wording: row.body,
      acceptedAt,
      ip,
      device: userAgent?.slice(0, 500) || null,
    })),
  };

  let supabase;
  try {
    supabase = getAdminSupabase();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[hiring/apply] supabase", (err as Error).message);
    return NextResponse.json(
      { error: "We couldn’t save your application. Please try again in a moment.", code: "config" },
      { status: 500 },
    );
  }
  const digits = phoneDigits(app.phone);

  const { data: priorByEmail } = await supabase
    .from("cleaners")
    .select("status, reapply_eligible_at, terminated_at, phone")
    .ilike("email", app.email)
    .limit(5);
  const { data: priorByPhone } = await supabase
    .from("cleaners")
    .select("status, reapply_eligible_at, terminated_at, phone")
    .ilike("phone", `%${digits.slice(-4)}%`)
    .limit(20);
  const prior = [...(priorByEmail || []), ...(priorByPhone || [])].filter((row) => {
    const rowDigits = phoneDigits(row.phone as string | null);
    const emailHit = (priorByEmail || []).includes(row);
    return emailHit || (rowDigits.length === 10 && rowDigits === digits);
  });
  let removedContractor = false;
  for (const row of prior) {
    const lock = isReapplyBlocked(row);
    if (lock.blocked) removedContractor = true;
  }

  const { data: byEmail } = await supabase
    .from("cleaner_applicants")
    .select("id, stage, airtable_record_id, government_id_path")
    .ilike("email", app.email)
    .maybeSingle();

  let existing = byEmail as {
    id: string;
    stage: string;
    airtable_record_id: string | null;
    government_id_path: string | null;
  } | null;

  if (!existing) {
    const { data: byPhone } = await supabase
      .from("cleaner_applicants")
      .select("id, stage, airtable_record_id, government_id_path, phone")
      .ilike("phone", `%${digits.slice(-4)}%`)
      .limit(20);
    existing =
      (byPhone || []).find((row) => phoneDigits(row.phone as string | null) === digits) || null;
  }

  const { data: coverage } = await supabase
    .from("service_coverage_zones")
    .select("zip_code")
    .eq("zip_code", app.zipCode)
    .eq("is_active", true)
    .maybeSingle();

  const { data: settingsRow } = await supabase.from("app_settings").select("value").eq("key", INTAKE_SETTINGS_KEY).maybeSingle();
  const settings = mergeIntakeSettings(settingsRow?.value && typeof settingsRow.value === "object" ? settingsRow.value as Partial<import("@/lib/contractor-intake/settings").IntakeSettings> : null);
  const duplicate = Boolean(existing) || prior.length > 0;
  const decision = decideApplication({
    role: app.role === "Lead Cleaner (Contractor)" ? "lead_cleaner" : "cleaner",
    email: app.email,
    phone: app.phone,
    name: app.fullName,
    zip: app.zipCode,
    zipInServiceArea: Boolean(coverage),
    daysAvailable: app.preferredDays.length,
    jobsPerWeek: app.jobsPerWeek,
    age18: app.age18,
    hasSmartphone: app.hasSmartphone,
    hasVehicle: app.hasVehicle,
    willHaveKit: app.willHaveKit,
    understandsContractorWork: app.understandsContractorWork,
    understandsVerification: app.understandsVerification,
    smsConsent: app.smsConsent,
    emailConsent: app.emailConsent,
    duplicate: duplicate || removedContractor,
    incomplete: false,
    reviewReason: removedContractor ? "These contact details are linked to a removed contractor." : null,
  }, settings);

  let airtable: TalentApplicant;
  try {
    const primed = await primeAirtablePat();
    if (!primed) throw new Error("Airtable is not configured");
    const input = airtableInput(app, "", "");
    airtable = isAirtableId(existing?.airtable_record_id)
      ? await updateTalentApplicantInAirtable(existing.airtable_record_id, input)
      : await createTalentApplicantInAirtable(input);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[hiring/apply] airtable", (err as Error).message);
    return NextResponse.json(
      { error: "We couldn’t save your application. Please try again in a moment.", code: "airtable" },
      { status: 502 },
    );
  }

  const fields = {
    email: app.email,
    phone: app.phone,
    full_name: app.fullName,
    first_name: app.firstName,
    last_name: app.lastName,
    address: app.address,
    zip_code: app.zipCode,
    state: app.state,
    role: app.role,
    department: app.department,
    contractor_type: app.contractorType,
    experience: app.experience,
    availability: app.availability,
    preferred_days: app.preferredDays,
    transportation: app.transportation,
    authorized_to_work: null,
    consent_1099: app.consent1099,
    background_check_consent: false,
    pay_consent: false,
    willing_to_get_supplies: app.willingToGetSupplies === "Yes",
    supplies_on_hand: app.suppliesOnHand,
    reliability_note: app.reliabilityNote,
    reason_note: app.reasonNote,
    government_id_path: null,
    stage: decision.stage === "conditional_approval" ? "onboarding" : decision.stage,
    intake_stage: decision.stage,
    intake_decision: decision,
    reapply_on: decision.reapplyOn,
    email_consent: app.emailConsent,
    airtable_record_id: airtable.airtableRecordId,
    airtable_last_modified: airtable.lastModified,
    submission: {
      ...airtable.submission,
      source: "hiring.novaracleaning.com",
      hiringRole: app.hiringRole,
      consentRecord,
      decision,
      experienceYears: app.experienceYears,
      timeWindows: app.timeWindows,
      jobsPerWeek: app.jobsPerWeek,
      cleaningTypes: app.cleaningTypes,
      leadTrack: decision.leadTrack,
    },
    synced_at: new Date().toISOString(),
    ...(!existing || existing.stage === "applicant" ? { applied_at: new Date().toISOString() } : {}),
  };

  const consentColumns = {
    age_18: app.age18,
    valid_drivers_license: app.hasVehicle,
    auto_insured: false,
    sms_consent: app.smsConsent,
    answers_accurate: app.privacyAccepted,
    consent_version: app.consentVersion,
    consent_accepted_at: acceptedAt,
    consent_ip: consentRecord.ip,
    consent_user_agent: consentRecord.userAgent,
    consent_record: consentRecord,
  };

  try {
    let applicantId = existing?.id;
    const saved = await writeApplicant(supabase, existing, fields, consentColumns);
    applicantId = saved.applicantId;

    if (saved.created) {
      await supabase.from("events").insert({
        event_type: "applicant.created",
        source: "hiring-site",
        summary: `New cleaner applicant (hiring site): ${app.fullName} — ${app.role} · ${app.state} ${app.zipCode}`,
        data: {
          applicant_id: applicantId,
          applicant_email: app.email,
          applicant_phone: app.phone,
          role: app.role,
          hiring_role: app.hiringRole,
          consent_version: app.consentVersion,
          transportation: app.transportation,
          willing_to_get_supplies: true,
          airtable_record_id: airtable.airtableRecordId,
        },
      });
    }

    let onboardingSent = false;
    if (decision.openOnboarding && applicantId) {
      try {
        const opened = await launchConditionalOnboarding(supabase, {
          id: applicantId,
          email: app.email,
          phone: app.phone,
          firstName: app.firstName,
          lastName: app.lastName,
          zip: app.zipCode,
          state: app.state || null,
          smsConsent: app.smsConsent,
          leadTrack: decision.leadTrack,
        });
        onboardingSent = opened.emailed || Boolean(opened.inviteUrl);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[hiring/apply] onboarding", (err as Error).message);
      }
    } else if (app.emailConsent || app.smsConsent) {
      const kind = decision.outcome === "pass" ? "conditional_approval" : decision.outcome === "not_a_fit" ? "not_a_fit" : decision.outcome === "waitlist" ? "waitlist" : "needs_review";
      const notice = applicantMessage(kind, { firstName: app.firstName, body: decision.message });
      try {
        const { data: secret } = await supabase.from("app_secrets").select("value").eq("key", "RESEND_API_KEY").maybeSingle();
        if (app.emailConsent && secret?.value) {
          await deliverCompliantEmail(supabase, {
            to: app.email,
            subject: notice.subject,
            html: `<p>${notice.text.replace(/\n/g, "<br>")}</p>`,
            apiKey: String(secret.value),
            declaredType: "contractor_operational",
            templateKey: "contractor_invitation",
          });
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[hiring/apply] notice", (err as Error).message);
      }
    }

    const sessionToken = str(form, "sessionToken");
    if (isHiringToken(sessionToken)) {
      const { data: sess } = await supabase
        .from("hiring_application_sessions")
        .select("source, job_title")
        .eq("token", sessionToken)
        .maybeSingle();
      if (sess?.source === "indeed" && applicantId) {
        await supabase
          .from("cleaner_applicants")
          .update({
            submission: {
              ...fields.submission,
              source: "indeed",
              indeedJob: sess.job_title,
            },
          })
          .eq("id", applicantId);
      }
      await supabase
        .from("hiring_application_sessions")
        .update({
          status: "submitted",
          submitted_at: new Date().toISOString(),
          applicant_id: applicantId,
          updated_at: new Date().toISOString(),
        })
        .eq("token", sessionToken)
        .eq("status", "open");
    }

    return NextResponse.json({
      ok: true,
      applicantId,
      updated: Boolean(existing),
      outcome: decision.outcome,
      stage: decision.stage,
      message: decision.leadTrack
        ? `${decision.message} You are on the Lead Track: you start as a cleaner, and a person reviews lead status after you meet the requirements.`
        : decision.message,
      reapplyOn: decision.reapplyOn,
      onboardingSent,
      countsAsRejection: decision.countsAsRejection,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[hiring/apply] local save", (err as Error).message, airtable.airtableRecordId);
    return NextResponse.json(
      {
        error:
          "Your application reached our hiring desk, but the confirmation didn’t finish. Please email hello@novaracleaning.com instead of submitting again.",
        code: "local_save",
      },
      { status: 502 },
    );
  }
}

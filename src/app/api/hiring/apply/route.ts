// ─── POST /api/hiring/apply ───────────────────────────────────────────────────
//
// Public application for hiring.novaracleaning.com. One question at a time on
// the client; this route re-checks every gate, stores the photo ID in a
// private bucket, then writes the Applicants row in Airtable and
// public.cleaner_applicants.
//
// Hard stops (422): no car, not authorized to work, declined a consent,
// not willing to get supplies. A current government-issued photo ID is
// required. Saying yes to supplies asks what they already have.

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { primeAirtablePat } from "@/lib/airtable/sources/prime-pat";
import {
  createTalentApplicantInAirtable,
  updateTalentApplicantInAirtable,
  type CreateTalentApplicantInput,
  type TalentApplicant,
} from "@/lib/airtable/talent";
import {
  APPLICANT_ID_BUCKET,
  phoneDigits,
  safeIdFilename,
  isApplicationIssue,
  validateHiringApplication,
  type HiringApplicationDraft,
  type NormalizedHiringApplication,
} from "@/lib/hiring/application";
import { isHiringToken } from "@/lib/hiring/session";
import { formatRosterDate, isReapplyBlocked } from "@/lib/pulse-check/roster";

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
    authorizedToWork: app.authorizedToWork,
    consent1099: true,
    backgroundCheckConsent: true,
    payConsent: true,
    willingToGetSupplies: "Yes",
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
    willingToGetSupplies: str(form, "willingToGetSupplies"),
    suppliesOnHand: str(form, "suppliesOnHand"),
    reliabilityNote: str(form, "reliabilityNote"),
    reasonNote: str(form, "reasonNote"),
    idConfirmed: flag(form, "idConfirmed"),
    idFile: file ? { name: file.name, type: file.type, size: file.size } : null,
    hiringRole: str(form, "hiringRole") || null,
  };
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
  if (!file) {
    return NextResponse.json({ error: "Upload a photo or PDF of your government-issued photo ID.", code: "missing_id" }, { status: 400 });
  }

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
  for (const row of prior) {
    const lock = isReapplyBlocked(row);
    if (lock.blocked) {
      const until = formatRosterDate(lock.until);
      return NextResponse.json(
        {
          error: until
            ? `This contractor account was closed. You can apply again after ${until}.`
            : "This contractor account was closed. You can apply again in 3 months.",
          code: "reapply_blocked",
        },
        { status: 409 },
      );
    }
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

  const filename = safeIdFilename(file.name);
  const path = `ids/${new Date().getUTCFullYear()}/${randomUUID()}-${filename}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await supabase.storage.from(APPLICANT_ID_BUCKET).upload(path, bytes, {
    contentType: app.idContentType,
    upsert: false,
  });
  if (upErr) {
    // eslint-disable-next-line no-console
    console.error("[hiring/apply] id upload", upErr.message);
    return NextResponse.json(
      { error: "We couldn’t store your ID. Please try the upload again.", code: "id_upload" },
      { status: 500 },
    );
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from(APPLICANT_ID_BUCKET)
    .createSignedUrl(path, 60 * 60);
  if (signErr || !signed?.signedUrl) {
    await supabase.storage.from(APPLICANT_ID_BUCKET).remove([path]);
    return NextResponse.json(
      { error: "We couldn’t store your ID. Please try the upload again.", code: "id_upload" },
      { status: 500 },
    );
  }

  let airtable: TalentApplicant;
  try {
    const primed = await primeAirtablePat();
    if (!primed) throw new Error("Airtable is not configured");
    const input = airtableInput(app, signed.signedUrl, filename);
    airtable = isAirtableId(existing?.airtable_record_id)
      ? await updateTalentApplicantInAirtable(existing.airtable_record_id, input)
      : await createTalentApplicantInAirtable(input);
  } catch (err) {
    await supabase.storage.from(APPLICANT_ID_BUCKET).remove([path]);
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
    authorized_to_work: app.authorizedToWork,
    consent_1099: true,
    background_check_consent: true,
    pay_consent: true,
    willing_to_get_supplies: true,
    supplies_on_hand: app.suppliesOnHand,
    reliability_note: app.reliabilityNote,
    reason_note: app.reasonNote,
    government_id_path: path,
    airtable_record_id: airtable.airtableRecordId,
    airtable_last_modified: airtable.lastModified,
    submission: {
      ...airtable.submission,
      source: "hiring.novaracleaning.com",
      hiringRole: app.hiringRole,
      governmentIdPath: path,
    },
    synced_at: new Date().toISOString(),
    ...(!existing || existing.stage === "applicant" ? { applied_at: new Date().toISOString() } : {}),
  };

  try {
    let applicantId = existing?.id;
    if (existing) {
      const { error } = await supabase
        .from("cleaner_applicants")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { data: created, error } = await supabase
        .from("cleaner_applicants")
        .insert({
          ...fields,
          stage: "applicant",
          stage_changed_at: new Date().toISOString(),
          stage_changed_by: "hiring-site",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      applicantId = created.id as string;

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
          transportation: app.transportation,
          willing_to_get_supplies: true,
          airtable_record_id: airtable.airtableRecordId,
        },
      });
    }

    if (existing?.government_id_path && existing.government_id_path !== path) {
      await supabase.storage.from(APPLICANT_ID_BUCKET).remove([existing.government_id_path]);
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

    return NextResponse.json({ ok: true, applicantId, updated: Boolean(existing) });
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

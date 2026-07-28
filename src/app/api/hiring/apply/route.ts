// ─── POST /api/hiring/apply ───────────────────────────────────────────────────
//
// Public application intake for hiring.novaracleaning.com. Inserts into
// public.cleaner_applicants (stage=applicant) so the existing Talent pipeline
// owns screening → onboarding → activation. Synthetic airtable_record_id
// (hiring_<uuid>) keeps the Airtable UNIQUE column happy without a Fillout row.

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  type HiringRoleId,
  applicantRoleLabel,
  roleById,
} from "@/lib/hiring/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLE_IDS = new Set<HiringRoleId>([
  "field-tech",
  "specialized-contractors",
  "commercial-cleaner",
]);

function digits(phone: string): string {
  return phone.replace(/\D/g, "");
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const roleId = String(body.roleId || "field-tech") as HiringRoleId;
  if (!ROLE_IDS.has(roleId)) {
    return NextResponse.json({ error: "Unknown role." }, { status: 400 });
  }

  const firstName = String(body.firstName || "").trim();
  const lastName = String(body.lastName || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim();
  const zipCode = String(body.zipCode || "").trim();
  const state = String(body.state || "").trim().toUpperCase();
  const experience = String(body.experience || "").trim();
  const availability = String(body.availability || "").trim();
  const note = String(body.note || "").trim().slice(0, 2000);
  const consent1099 = Boolean(body.consent1099);
  const authorizedToWork = Boolean(body.authorizedToWork);

  if (!firstName || !lastName) {
    return NextResponse.json({ error: "First and last name are required." }, { status: 400 });
  }
  if (!email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }
  if (digits(phone).length < 10) {
    return NextResponse.json({ error: "A valid phone number is required." }, { status: 400 });
  }
  if (!/^\d{5}$/.test(zipCode)) {
    return NextResponse.json({ error: "Enter a 5-digit ZIP code." }, { status: 400 });
  }
  if (!state || state.length !== 2) {
    return NextResponse.json({ error: "Select a state." }, { status: 400 });
  }
  if (!experience) {
    return NextResponse.json({ error: "Tell us about your cleaning experience." }, { status: 400 });
  }
  if (!availability) {
    return NextResponse.json({ error: "Share your availability." }, { status: 400 });
  }
  if (!consent1099 || !authorizedToWork) {
    return NextResponse.json(
      { error: "Confirm work authorization and 1099 contractor terms." },
      { status: 400 },
    );
  }

  const role = roleById(roleId);
  const fullName = `${firstName} ${lastName}`.trim();
  const supabase = getAdminSupabase();

  // Dedupe by email (then phone) — re-apply updates the same person.
  const { data: byEmail } = await supabase
    .from("cleaner_applicants")
    .select("id, stage")
    .ilike("email", email)
    .maybeSingle();

  let existingId = byEmail?.id as string | undefined;
  if (!existingId) {
    // Exact phone match only (formatted as stored by the form).
    const { data: byPhone } = await supabase
      .from("cleaner_applicants")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();
    existingId = byPhone?.id as string | undefined;
  }

  const fields = {
    email,
    phone,
    full_name: fullName,
    first_name: firstName,
    last_name: lastName,
    zip_code: zipCode,
    state,
    role: applicantRoleLabel(roleId),
    department: role.evergreen ? "Evergreen" : "Field",
    contractor_type: role.evergreen ? "evergreen" : "field_tech",
    experience,
    availability,
    authorized_to_work: "yes",
    consent_1099: true,
    reason_note: note || null,
    reliability_note: role.evergreen
      ? "Active evergreen list — select when needed"
      : null,
    applied_at: new Date().toISOString(),
    submission: {
      source: "hiring.novaracleaning.com",
      roleId,
      evergreen: role.evergreen,
      note: note || null,
    },
  };

  try {
    if (existingId) {
      // Don't pull someone who's already past applicant back to the front of
      // the funnel — just refresh contact + application details.
      const { error } = await supabase
        .from("cleaner_applicants")
        .update({
          ...fields,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, applicantId: existingId, updated: true });
    }

    const { data: created, error } = await supabase
      .from("cleaner_applicants")
      .insert({
        airtable_record_id: `hiring_${randomUUID()}`,
        stage: "applicant",
        stage_changed_at: new Date().toISOString(),
        stage_changed_by: "hiring-site",
        ...fields,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await supabase.from("events").insert({
      event_type: "applicant.created",
      source: "hiring-site",
      summary: `New cleaner applicant (hiring site): ${fullName} — ${applicantRoleLabel(roleId)}${state ? ` · ${state}` : ""}${zipCode ? ` ${zipCode}` : ""}`,
      data: {
        applicant_id: created.id,
        applicant_email: email,
        applicant_phone: phone,
        role: applicantRoleLabel(roleId),
        role_id: roleId,
        evergreen: role.evergreen,
        experience,
        availability,
      },
    });

    return NextResponse.json({ ok: true, applicantId: created.id, updated: false });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[hiring/apply]", err);
    return NextResponse.json(
      { error: (err as Error).message || "Could not save your application." },
      { status: 500 },
    );
  }
}

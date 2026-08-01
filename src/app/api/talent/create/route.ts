// ─── POST /api/talent/create ───────────────────────────────────────────────────
//
// Manual applicant intake from the cleaner-hub Applicants queue.
// Creates the row in Airtable (Applicants table) first, then inserts into
// public.cleaner_applicants with that airtable_record_id so sync stays aligned.
//
// Body: { fullName, email, phone?, zipCode?, state?, address?, role?,
//         availability?, experience?, notes? }

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { primeAirtablePat } from "@/lib/airtable/sources/prime-pat";
import { createTalentApplicantInAirtable } from "@/lib/airtable/talent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const digits = (v: string | null | undefined) => (v ? String(v).replace(/\D/g, "") : "");

export async function POST(req: Request): Promise<NextResponse> {
  let principal: { userId: string; email: string };
  try {
    principal = await requireAdmin(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return NextResponse.json({ error: e.message }, { status: e.status || 401 });
  }

  let body: {
    fullName?: string;
    email?: string;
    phone?: string;
    zipCode?: string;
    state?: string;
    address?: string;
    role?: string;
    availability?: string;
    experience?: string;
    notes?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const fullName = String(body.fullName || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  if (!fullName) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }

  const supabase = getAdminSupabase();

  // Dedupe against local pipeline before writing to Airtable.
  const { data: existingByEmail } = await supabase
    .from("cleaner_applicants")
    .select("id, full_name, stage")
    .ilike("email", email)
    .maybeSingle();
  if (existingByEmail) {
    return NextResponse.json(
      {
        error: `An applicant with this email already exists (${existingByEmail.full_name || email}, stage: ${existingByEmail.stage}).`,
        existingId: existingByEmail.id,
      },
      { status: 409 },
    );
  }

  const phone = String(body.phone || "").trim() || null;
  if (phone) {
    const phoneDigits = digits(phone);
    if (phoneDigits.length >= 10) {
      const { data: existingByPhone } = await supabase
        .from("cleaner_applicants")
        .select("id, full_name, stage, phone")
        .not("phone", "is", null)
        .limit(500);
      const hit = (existingByPhone || []).find((r) => digits(r.phone) === phoneDigits);
      if (hit) {
        return NextResponse.json(
          {
            error: `An applicant with this phone already exists (${hit.full_name || hit.phone}, stage: ${hit.stage}).`,
            existingId: hit.id,
          },
          { status: 409 },
        );
      }
    }
  }

  try {
    await primeAirtablePat();
    const airtable = await createTalentApplicantInAirtable({
      fullName,
      email,
      phone,
      zipCode: body.zipCode,
      state: body.state,
      address: body.address,
      role: body.role,
      availability: body.availability,
      experience: body.experience,
      notes: body.notes,
    });

    const { data: row, error } = await supabase
      .from("cleaner_applicants")
      .insert({
        airtable_record_id: airtable.airtableRecordId,
        email: airtable.email,
        phone: airtable.phone,
        full_name: airtable.fullName,
        first_name: airtable.firstName,
        last_name: airtable.lastName,
        address: airtable.address,
        zip_code: airtable.zipCode,
        state: airtable.state,
        zone: airtable.zone,
        role: airtable.role,
        department: airtable.department,
        contractor_type: airtable.contractorType,
        experience: airtable.experience,
        availability: airtable.availability,
        preferred_days: airtable.preferredDays,
        transportation: airtable.transportation,
        authorized_to_work: airtable.authorizedToWork,
        consent_1099: airtable.consent1099,
        background_check_consent: airtable.backgroundCheckConsent,
        pay_consent: airtable.payConsent,
        reliability_note: airtable.reliabilityNote,
        reason_note: airtable.reasonNote,
        submission: airtable.submission,
        stage: "applicant",
        stage_changed_at: new Date().toISOString(),
        stage_changed_by: principal.email,
        applied_at: airtable.appliedAt || new Date().toISOString(),
        airtable_last_modified: airtable.lastModified,
        airtable_marked_imported: true,
        synced_at: new Date().toISOString(),
      })
      .select("id, full_name, email, stage")
      .single();

    if (error) {
      // Airtable row exists; surface clearly so ops can re-sync rather than
      // inventing a second Airtable record.
      return NextResponse.json(
        {
          error: `Created in Airtable (${airtable.airtableRecordId}) but failed to save locally: ${error.message}. Run Sync from Airtable to pull them in.`,
          airtableRecordId: airtable.airtableRecordId,
        },
        { status: 502 },
      );
    }

    const who = row.full_name || row.email || row.id;
    await supabase.from("events").insert({
      event_type: "applicant.created",
      source: "cleaner-hub",
      summary: `Applicant added manually by ${principal.email}: ${who}`,
      data: {
        applicant_id: row.id,
        airtable_record_id: airtable.airtableRecordId,
        source: "manual",
        created_by: principal.email,
      },
    });

    return NextResponse.json({
      ok: true,
      applicant: row,
      airtableRecordId: airtable.airtableRecordId,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[talent-create]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// ─── POST /api/talent/sync ─────────────────────────────────────────────────────
//
// ONE-WAY sync: talent-acquisition applicants (Fillout → Airtable, base
// app0jCdQHXOvItVPo / Contractors) into public.cleaner_applicants — the
// Applicants queue in the admin cleaner hub. From import onward the workspace
// is the system of record; the app owns stage progression and later syncs
// NEVER move a stage.
//
// Idempotent + dedupe: matched by Airtable record id first, then email
// (lowercased), then phone digits — a re-application or edit updates the
// existing person, never duplicates them.
//
// Notifications: brand-new applicants insert an `applicant.created` events row
// (existing events → Discord channel). Only recent applications notify so a
// first-time backfill doesn't flood the channel.
//
// Auth: shared secret (?secret= / x-talent-secret, TALENT_SYNC_SECRET) for the
// pg_cron poller — or an admin/VA session for the hub's "Sync now" button.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { primeAirtablePat } from "@/lib/airtable/sources/prime-pat";
import {
  fetchTalentApplicants,
  initialStageFromAirtable,
  markImported,
  type TalentApplicant,
} from "@/lib/airtable/talent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const NOTIFY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

async function resolveSecret(name: string): Promise<string> {
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase.from("app_secrets").select("value").eq("key", name).maybeSingle();
    if (data?.value) return String(data.value).trim();
  } catch {
    /* fall through */
  }
  return (process.env[name] || "").trim();
}

const digits = (v: string | null | undefined) => (v ? String(v).replace(/\D/g, "") : "");

/** DB row shape (subset) for dedupe matching. */
interface ExistingRow {
  id: string;
  airtable_record_id: string;
  email: string | null;
  phone: string | null;
  cleaner_id: string | null;
}

function toDbFields(a: TalentApplicant) {
  return {
    airtable_record_id: a.airtableRecordId,
    email: a.email,
    phone: a.phone,
    full_name: a.fullName,
    first_name: a.firstName,
    last_name: a.lastName,
    address: a.address,
    zip_code: a.zipCode,
    state: a.state,
    zone: a.zone,
    role: a.role,
    department: a.department,
    contractor_type: a.contractorType,
    experience: a.experience,
    availability: a.availability,
    preferred_days: a.preferredDays,
    transportation: a.transportation,
    authorized_to_work: a.authorizedToWork,
    consent_1099: a.consent1099,
    background_check_consent: a.backgroundCheckConsent,
    pay_consent: a.payConsent,
    reliability_note: a.reliabilityNote,
    reason_note: a.reasonNote,
    submission: a.submission,
    applied_at: a.appliedAt,
    airtable_last_modified: a.lastModified,
    synced_at: new Date().toISOString(),
  };
}

export async function POST(req: Request): Promise<NextResponse> {
  const provided =
    new URL(req.url).searchParams.get("secret") || req.headers.get("x-talent-secret") || "";
  const expected = await resolveSecret("TALENT_SYNC_SECRET");
  const viaSecret = !!expected && provided === expected;
  if (!viaSecret) {
    try {
      await requireAdmin(req);
    } catch (err) {
      const e = err as AdminAuthError;
      return NextResponse.json({ error: e.message }, { status: e.status || 401 });
    }
  }

  try {
    await primeAirtablePat();
    const supabase = getAdminSupabase();

    const applicants = await fetchTalentApplicants();

    const { data: existingRows, error: exErr } = await supabase
      .from("cleaner_applicants")
      .select("id, airtable_record_id, email, phone, cleaner_id");
    if (exErr) throw new Error(`Could not read applicants: ${exErr.message}`);
    const existing = (existingRows || []) as ExistingRow[];

    const byRecordId = new Map(existing.map((r) => [r.airtable_record_id, r]));
    const byEmail = new Map(
      existing.filter((r) => r.email).map((r) => [String(r.email).toLowerCase(), r]),
    );
    const byPhone = new Map(
      existing.filter((r) => digits(r.phone)).map((r) => [digits(r.phone), r]),
    );

    let created = 0;
    let updated = 0;
    const failures: string[] = [];
    const newApplicants: Array<{ id: string; a: TalentApplicant; stage: string }> = [];

    for (const a of applicants) {
      try {
        const match =
          byRecordId.get(a.airtableRecordId) ||
          (a.email ? byEmail.get(a.email) : undefined) ||
          (digits(a.phone) ? byPhone.get(digits(a.phone)) : undefined);

        if (match) {
          // Refresh submission details ONLY — stage progression belongs to the
          // app. A re-application (new Airtable record, same email) re-points
          // airtable_record_id at the newest record.
          const { error } = await supabase
            .from("cleaner_applicants")
            .update(toDbFields(a))
            .eq("id", match.id);
          if (error) throw new Error(error.message);
          updated += 1;
        } else {
          const stage = initialStageFromAirtable(a);
          // Link an existing contractor by email so progress reads through.
          let cleanerId: string | null = null;
          if (a.email) {
            const { data: cleaner } = await supabase
              .from("cleaners")
              .select("id")
              .ilike("email", a.email)
              .maybeSingle();
            cleanerId = cleaner?.id || null;
          }
          const { data: row, error } = await supabase
            .from("cleaner_applicants")
            .insert({
              ...toDbFields(a),
              stage,
              cleaner_id: cleanerId,
              stage_changed_at: new Date().toISOString(),
              stage_changed_by: "sync:airtable",
            })
            .select("id")
            .single();
          if (error) throw new Error(error.message);
          created += 1;
          if (row?.id) newApplicants.push({ id: row.id, a, stage });
        }
      } catch (err) {
        failures.push(`${a.airtableRecordId}: ${(err as Error).message}`);
      }
    }

    // Notify admin for genuinely new, recent applicants (skip backfilled
    // history and rows that imported already-hired/rejected).
    const now = Date.now();
    for (const { a, stage } of newApplicants) {
      if (stage !== "applicant") continue;
      const appliedAt = a.appliedAt ? new Date(a.appliedAt).getTime() : now;
      if (now - appliedAt > NOTIFY_WINDOW_MS) continue;
      await supabase.from("events").insert({
        event_type: "applicant.created",
        source: "talent-sync",
        zone: a.zone,
        summary: `New cleaner applicant: ${a.fullName || a.email || "Unknown"}${a.state ? ` — ${a.state}` : ""}${a.zipCode ? ` ${a.zipCode}` : ""}`,
        data: {
          applicant_email: a.email,
          applicant_phone: a.phone,
          role: a.role,
          experience: a.experience,
          availability: a.availability,
          transportation: a.transportation,
        },
      });
    }

    // Courtesy marker back to Airtable (best-effort; never blocks the sync).
    let marked = 0;
    try {
      marked = await markImported(applicants);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[talent-sync] Airtable write-back failed:", (err as Error).message);
    }

    // Log the run when something changed (idempotent runs stay quiet).
    if (created > 0) {
      await supabase.from("events").insert({
        event_type: "applicant.sync",
        source: "talent-sync",
        summary: `Talent sync: ${created} new applicant${created === 1 ? "" : "s"}, ${updated} updated`,
        data: { created, updated, marked, failures: failures.slice(0, 10) },
      });
    }

    return NextResponse.json({
      ok: failures.length === 0,
      total: applicants.length,
      created,
      updated,
      markedImported: marked,
      failures,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[talent-sync]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

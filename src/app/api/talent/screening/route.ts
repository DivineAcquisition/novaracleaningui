// ─── POST /api/talent/screening ────────────────────────────────────────────────
//
// Live phone-screening lifecycle for cleaner-hub applicants. The screening
// ALWAYS belongs to a specific applicant — never a floating form.
//
//   { action: "start",     applicantId }              ← resume the open draft
//                                                       or create one pre-filled
//                                                       from the applicant record
//   { action: "save",      screeningId, patch }       ← continuous auto-save
//   { action: "submit",    screeningId }              ← validate, freeze,
//                                                       route the outcome,
//                                                       generate the PDF
//   { action: "list",      applicantId }              ← history + signed PDF urls
//   { action: "retry_pdf", screeningId }              ← regenerate a failed PDF
//
// Guarantees enforced here (and by the DB trigger):
//   · screener identity + timestamps are stamped server-side, never typed
//   · submitted screenings are immutable — a correction is a NEW screening
//   · inconsistent outcomes are BLOCKED (Advance with a failed qualifier,
//     a pending qualifier, or any consent = No; Decline without a standard
//     reason; Hold without pending item + follow-up date)
//   · the screening row is saved BEFORE the PDF: a failed generation flags
//     pdf_status='failed' for retry and never discards the record
//   · outcome routing reuses the existing pipeline: Advance moves the
//     applicant to 'screening' where the existing Launch Onboarding action
//     lives; Hold sets stage 'hold' + follow-up date (daily cron resurfaces
//     it); Decline maps to the existing 'rejected' stage with the
//     standardized reason retained in history

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError, type AdminPrincipal } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  declineReasonLabel,
  deriveDownstreamFields,
  validateScreeningOutcome,
  type PhoneScreeningRow,
  type Recommendation,
  type ScreeningAnswers,
  type ScreeningConsents,
  type ScreeningScorecard,
} from "@/lib/phone-screening";
import { buildScreeningPdf, type ScreeningPdfApplicant } from "@/lib/screening-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "screening-records";

interface ApplicantRow extends ScreeningPdfApplicant {
  id: string;
  stage: string;
  cleaner_id: string | null;
  availability: string | null;
  preferred_days: string[] | null;
  experience: string | null;
}

const APPLICANT_COLS =
  "id, email, phone, full_name, first_name, last_name, zip_code, state, stage, cleaner_id, availability, preferred_days, experience";

const DAY_ABBREV: Record<string, string> = {
  mon: "Mon", monday: "Mon",
  tue: "Tue", tues: "Tue", tuesday: "Tue",
  wed: "Wed", wednesday: "Wed",
  thu: "Thu", thur: "Thu", thurs: "Thu", thursday: "Thu",
  fri: "Fri", friday: "Fri",
  sat: "Sat", saturday: "Sat",
  sun: "Sun", sunday: "Sun",
};

function normalizeDays(days: string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const d of days || []) {
    const abbr = DAY_ABBREV[String(d).trim().toLowerCase()];
    if (abbr && !out.includes(abbr)) out.push(abbr);
  }
  return out;
}

async function logEvent(
  supabase: ReturnType<typeof getAdminSupabase>,
  args: { type: string; summary: string; cleanerId?: string | null; data?: Record<string, unknown> },
) {
  await supabase
    .from("events")
    .insert({
      event_type: args.type,
      source: "phone-screening",
      cleaner_id: args.cleanerId || null,
      summary: args.summary,
      data: args.data || {},
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

/** Stamp who/when onto any consent capture missing them — never hand-typed. */
function stampConsents(
  consents: ScreeningConsents | undefined,
  principal: AdminPrincipal,
): ScreeningConsents | undefined {
  if (!consents) return consents;
  const now = new Date().toISOString();
  const out: ScreeningConsents = {};
  for (const [key, c] of Object.entries(consents)) {
    if (!c || (c.value !== "yes" && c.value !== "no")) continue;
    out[key] = {
      value: c.value,
      note: typeof c.note === "string" && c.note.trim() ? c.note.trim() : undefined,
      at: c.at || now,
      by: principal.userId,
      by_name: principal.email,
    };
  }
  return out;
}

/** Generate + upload the branded screening-record PDF. Never throws. */
async function generatePdf(
  supabase: ReturnType<typeof getAdminSupabase>,
  screening: PhoneScreeningRow,
  applicant: ApplicantRow,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const bytes = await buildScreeningPdf(screening, applicant);
    const path = `${applicant.id}/${screening.id}.pdf`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error(upErr.message);
    const { error: dbErr } = await supabase
      .from("phone_screenings")
      .update({
        pdf_path: path,
        pdf_status: "generated",
        pdf_attempts: (screening.pdf_attempts || 0) + 1,
        pdf_last_error: null,
      })
      .eq("id", screening.id);
    if (dbErr) throw new Error(dbErr.message);
    return { ok: true };
  } catch (err) {
    const message = (err as Error).message || "PDF generation failed";
    // The submitted screening is already saved — flag for retry, never discard.
    await supabase
      .from("phone_screenings")
      .update({
        pdf_status: "failed",
        pdf_attempts: (screening.pdf_attempts || 0) + 1,
        pdf_last_error: message.slice(0, 500),
      })
      .eq("id", screening.id)
      .then(
        () => undefined,
        () => undefined,
      );
    return { ok: false, error: message };
  }
}

/**
 * Write screening-captured data onto the applicant (and linked cleaner, if
 * one exists) using EXISTING fields — availability days, hard cutoffs,
 * travel radius, supply readiness, and the consent booleans — so dispatch
 * and the risk layer have them from day one without re-entry.
 */
async function writeDownstreamFields(
  supabase: ReturnType<typeof getAdminSupabase>,
  screening: PhoneScreeningRow,
  applicant: ApplicantRow,
) {
  const derived = deriveDownstreamFields(screening.answers || {});
  const c = screening.consents || {};
  const consentBool = (key: string): boolean | undefined =>
    c[key]?.value === "yes" ? true : c[key]?.value === "no" ? false : undefined;

  const applicantPatch: Record<string, unknown> = {};
  if (derived.preferredDays.length > 0) applicantPatch.preferred_days = derived.preferredDays;
  if (derived.availabilityText) applicantPatch.availability = derived.availabilityText;
  const c1099 = consentBool("contractor_1099");
  if (c1099 !== undefined) applicantPatch.consent_1099 = c1099;
  const cBg = consentBool("background_check");
  if (cBg !== undefined) applicantPatch.background_check_consent = cBg;
  const cPay = consentBool("pay_structure");
  if (cPay !== undefined) applicantPatch.pay_consent = cPay;
  if (Object.keys(applicantPatch).length > 0) {
    await supabase.from("cleaner_applicants").update(applicantPatch).eq("id", applicant.id);
  }

  if (!applicant.cleaner_id) return;

  const { data: cleaner } = await supabase
    .from("cleaners")
    .select("id, constraints, home_zip")
    .eq("id", applicant.cleaner_id)
    .maybeSingle();
  if (!cleaner) return;

  const existing = (cleaner.constraints || {}) as Record<string, unknown>;
  const constraints = {
    ...existing,
    ...(derived.noWorkAfter ? { no_work_after: derived.noWorkAfter } : {}),
    ...(derived.noWorkBefore ? { no_work_before: derived.noWorkBefore } : {}),
    ...(derived.constraintNotes ? { notes: derived.constraintNotes } : {}),
  };

  const cleanerPatch: Record<string, unknown> = { constraints };
  if (derived.preferredDays.length > 0) cleanerPatch.preferred_work_days = derived.preferredDays;
  if (derived.travelRadiusMiles) cleanerPatch.max_travel_miles = derived.travelRadiusMiles;
  await supabase.from("cleaners").update(cleanerPatch).eq("id", applicant.cleaner_id);
}

export async function POST(req: Request): Promise<NextResponse> {
  let principal: AdminPrincipal;
  try {
    principal = await requireAdmin(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return NextResponse.json({ error: e.message }, { status: e.status || 401 });
  }

  let body: {
    action?: string;
    applicantId?: string;
    screeningId?: string;
    patch?: {
      answers?: ScreeningAnswers;
      consents?: ScreeningConsents;
      scorecard?: ScreeningScorecard;
      recommendation?: Recommendation | null;
      decline_reason?: string | null;
      decline_notes?: string | null;
      hold_pending?: string | null;
      hold_follow_up_date?: string | null;
    };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = String(body.action || "");
  const supabase = getAdminSupabase();

  const loadApplicant = async (id: string): Promise<ApplicantRow | null> => {
    const { data } = await supabase
      .from("cleaner_applicants")
      .select(APPLICANT_COLS)
      .eq("id", id)
      .maybeSingle();
    return (data as ApplicantRow | null) || null;
  };

  const loadScreening = async (id: string): Promise<PhoneScreeningRow | null> => {
    const { data } = await supabase.from("phone_screenings").select("*").eq("id", id).maybeSingle();
    return (data as PhoneScreeningRow | null) || null;
  };

  try {
    switch (action) {
      // ── Resume the open draft or start a new pre-filled one ──
      case "start": {
        const applicantId = String(body.applicantId || "");
        if (!applicantId) return NextResponse.json({ error: "applicantId is required" }, { status: 400 });
        const applicant = await loadApplicant(applicantId);
        if (!applicant) return NextResponse.json({ error: "Applicant not found" }, { status: 404 });

        // A dropped call resumes exactly where it left off.
        const { data: draft } = await supabase
          .from("phone_screenings")
          .select("*")
          .eq("applicant_id", applicantId)
          .eq("status", "draft")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (draft) {
          return NextResponse.json({ ok: true, screening: draft, resumed: true, applicant });
        }

        // Pre-fill from what the intake already captured — the VA never
        // re-types what the system knows. Consents are NEVER pre-filled:
        // they are captured live, on this call, as a legal record.
        const answers: ScreeningAnswers = {
          qualifiers: {
            ...(applicant.zip_code ? { home_base: [applicant.zip_code, applicant.state].filter(Boolean).join(", ") } : {}),
          },
          availability: {
            ...(normalizeDays(applicant.preferred_days).length > 0
              ? { days: normalizeDays(applicant.preferred_days) }
              : {}),
            ...(applicant.availability ? { hours: applicant.availability } : {}),
          },
          experience: {
            ...(applicant.experience ? { background: applicant.experience } : {}),
          },
        };

        const { data: created, error: cErr } = await supabase
          .from("phone_screenings")
          .insert({
            applicant_id: applicantId,
            status: "draft",
            answers,
            screener_id: principal.userId,
            screener_name: principal.email,
            started_at: new Date().toISOString(),
          })
          .select("*")
          .single();
        if (cErr) throw new Error(cErr.message);
        return NextResponse.json({ ok: true, screening: created, resumed: false, applicant });
      }

      // ── Continuous auto-save (drafts only) ──
      case "save": {
        const screeningId = String(body.screeningId || "");
        if (!screeningId) return NextResponse.json({ error: "screeningId is required" }, { status: 400 });
        const screening = await loadScreening(screeningId);
        if (!screening) return NextResponse.json({ error: "Screening not found" }, { status: 404 });
        if (screening.status !== "draft") {
          return NextResponse.json(
            { error: "This screening was submitted and is immutable — run a new screening to make a correction." },
            { status: 409 },
          );
        }
        const patch = body.patch || {};
        const update: Record<string, unknown> = {};
        if (patch.answers) update.answers = patch.answers;
        if (patch.consents) update.consents = stampConsents(patch.consents, principal);
        if (patch.scorecard) update.scorecard = patch.scorecard;
        if ("recommendation" in patch) update.recommendation = patch.recommendation || null;
        if ("decline_reason" in patch) update.decline_reason = patch.decline_reason || null;
        if ("decline_notes" in patch) update.decline_notes = patch.decline_notes || null;
        if ("hold_pending" in patch) update.hold_pending = patch.hold_pending || null;
        if ("hold_follow_up_date" in patch) update.hold_follow_up_date = patch.hold_follow_up_date || null;
        if (Object.keys(update).length === 0) return NextResponse.json({ ok: true, noop: true });

        const { data: saved, error: sErr } = await supabase
          .from("phone_screenings")
          .update(update)
          .eq("id", screeningId)
          .eq("status", "draft")
          .select("updated_at")
          .single();
        if (sErr) throw new Error(sErr.message);
        return NextResponse.json({ ok: true, savedAt: saved.updated_at });
      }

      // ── Submit: validate → freeze → route outcome → generate PDF ──
      case "submit": {
        const screeningId = String(body.screeningId || "");
        if (!screeningId) return NextResponse.json({ error: "screeningId is required" }, { status: 400 });
        const screening = await loadScreening(screeningId);
        if (!screening) return NextResponse.json({ error: "Screening not found" }, { status: 404 });
        if (screening.status !== "draft") {
          return NextResponse.json({ error: "This screening was already submitted." }, { status: 409 });
        }
        const applicant = await loadApplicant(screening.applicant_id);
        if (!applicant) return NextResponse.json({ error: "Applicant not found" }, { status: 404 });

        // Blocked, not merely warned about.
        const errors = validateScreeningOutcome({
          answers: screening.answers || {},
          consents: screening.consents || {},
          recommendation: screening.recommendation,
          declineReason: screening.decline_reason,
          holdPending: screening.hold_pending,
          holdFollowUpDate: screening.hold_follow_up_date,
        });
        if (errors.length > 0) {
          return NextResponse.json({ error: errors.join(" "), errors }, { status: 422 });
        }

        // 1. Freeze the record FIRST — the PDF renders from the saved row.
        const submittedAt = new Date().toISOString();
        const { data: frozen, error: fErr } = await supabase
          .from("phone_screenings")
          .update({ status: "submitted", submitted_at: submittedAt })
          .eq("id", screeningId)
          .eq("status", "draft")
          .select("*")
          .single();
        if (fErr) throw new Error(fErr.message);
        const finalRow = frozen as PhoneScreeningRow;

        // 2. Downstream field writes (existing applicant/cleaner fields).
        await writeDownstreamFields(supabase, finalRow, applicant);

        // 3. Outcome routing through the EXISTING pipeline.
        const rec = finalRow.recommendation as Recommendation;
        const stagePatch: Record<string, unknown> = {
          stage_changed_at: submittedAt,
          stage_changed_by: principal.email,
        };
        let newStage: string | null = null;
        const routable = ["applicant", "screening", "hold"].includes(applicant.stage);
        if (rec === "advance" && routable) {
          // Forward in the pipeline — the existing Launch Onboarding action
          // is offered from the 'screening' stage.
          newStage = "screening";
          stagePatch.hold_pending = null;
          stagePatch.hold_follow_up_at = null;
          stagePatch.hold_reminder_sent_at = null;
        } else if (rec === "hold" && applicant.stage !== "active") {
          newStage = "hold";
          stagePatch.hold_pending = finalRow.hold_pending;
          stagePatch.hold_follow_up_at = finalRow.hold_follow_up_date;
          stagePatch.hold_reminder_sent_at = null; // re-arm the dated reminder
        } else if (rec === "decline" && applicant.stage !== "active") {
          newStage = "rejected";
          stagePatch.rejection_reason = [
            declineReasonLabel(finalRow.decline_reason),
            finalRow.decline_notes || "",
          ]
            .filter(Boolean)
            .join(" — ");
        }
        if (newStage) {
          await supabase
            .from("cleaner_applicants")
            .update({ stage: newStage, ...stagePatch })
            .eq("id", applicant.id);
        }

        const who = applicant.full_name || applicant.email || applicant.id;
        await logEvent(supabase, {
          type: "applicant.screened",
          summary: `Phone screening submitted for ${who} by ${principal.email} — ${rec.toUpperCase()}${
            rec === "decline"
              ? ` (${declineReasonLabel(finalRow.decline_reason)})`
              : rec === "hold"
                ? ` (follow up ${finalRow.hold_follow_up_date})`
                : ""
          }`,
          cleanerId: applicant.cleaner_id,
          data: {
            applicant_id: applicant.id,
            screening_id: finalRow.id,
            recommendation: rec,
            decline_reason: finalRow.decline_reason,
            hold_follow_up_date: finalRow.hold_follow_up_date,
          },
        });

        // 4. Generate the branded PDF from the saved record. A failure is
        //    flagged for retry — the screening itself is already safe.
        const pdf = await generatePdf(supabase, finalRow, applicant);

        return NextResponse.json({
          ok: true,
          stage: newStage || applicant.stage,
          recommendation: rec,
          offerLaunchOnboarding: rec === "advance",
          pdf: pdf.ok ? "generated" : "failed",
          pdfError: pdf.error,
        });
      }

      // ── History for the applicant record (newest first) + signed PDF urls ──
      case "list": {
        const applicantId = String(body.applicantId || "");
        if (!applicantId) return NextResponse.json({ error: "applicantId is required" }, { status: 400 });
        const { data: rows, error: lErr } = await supabase
          .from("phone_screenings")
          .select(
            "id, status, recommendation, decline_reason, hold_pending, hold_follow_up_date, screener_name, started_at, submitted_at, pdf_path, pdf_status, pdf_attempts, pdf_last_error, created_at",
          )
          .eq("applicant_id", applicantId)
          .order("created_at", { ascending: false });
        if (lErr) throw new Error(lErr.message);

        const screenings = await Promise.all(
          (rows || []).map(async (r) => {
            let pdfUrl: string | null = null;
            if (r.pdf_path && r.pdf_status === "generated") {
              const { data: signed } = await supabase.storage
                .from(BUCKET)
                .createSignedUrl(r.pdf_path, 3600);
              pdfUrl = signed?.signedUrl || null;
            }
            return { ...r, pdfUrl };
          }),
        );
        return NextResponse.json({ ok: true, screenings });
      }

      // ── Regenerate a failed PDF from the immutable record ──
      case "retry_pdf": {
        const screeningId = String(body.screeningId || "");
        if (!screeningId) return NextResponse.json({ error: "screeningId is required" }, { status: 400 });
        const screening = await loadScreening(screeningId);
        if (!screening) return NextResponse.json({ error: "Screening not found" }, { status: 404 });
        if (screening.status !== "submitted") {
          return NextResponse.json({ error: "Only submitted screenings have a PDF." }, { status: 400 });
        }
        const applicant = await loadApplicant(screening.applicant_id);
        if (!applicant) return NextResponse.json({ error: "Applicant not found" }, { status: 404 });
        const pdf = await generatePdf(supabase, screening, applicant);
        if (!pdf.ok) return NextResponse.json({ error: pdf.error || "PDF generation failed" }, { status: 502 });
        return NextResponse.json({ ok: true, pdf: "generated" });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[talent-screening]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// ─── POST /api/talent/actions ──────────────────────────────────────────────────
//
// Admin actions on cleaner-hub applicants (public.cleaner_applicants). The
// whole lifecycle lives here — Airtable is intake-only.
//
//   { action: "advance_screening", applicantId }
//   { action: "reject",            applicantId, reason }
//   { action: "reinstate",         applicantId, targetStage? }  ← rejected → onboarding (default) / screening / applicant
//   { action: "launch_onboarding", applicantId }   ← email + SMS via existing channels
//   { action: "resend_onboarding", applicantId }   ← one-click nudge for stalled onboarding
//   { action: "activate",          applicantId }   ← gates: agreement signed + payout setup
//
// launch_onboarding reuses the EXISTING contractor onboarding flow: the invite
// email/SMS point at a TOKENIZED contractor auth link (?invite=…) that skips
// the /cleaner/role intro video and goes straight into account → wizard →
// ICA → Stripe Connect. No parallel onboarding is invented here. A cleaners
// row is created (status=pending, approved=false) so progress reads through
// live; portal access stays gated by the existing rules (no dispatch before
// signed agreement + admin approval/activation).
//
// Every stage change writes an events row (who / when) — the existing audit
// channel, which also feeds Discord.

import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { edgeResult } from "@/lib/edge-invoke";
import { deriveDownstreamFields, type ScreeningAnswers } from "@/lib/phone-screening";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ONBOARDING_AUTH_BASE = "https://contractor.novaracleaning.com/cleaner/auth";
/** Invite links stay valid for 14 days; resend mints a fresh token/window. */
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function mintInviteToken(): string {
  return randomBytes(24).toString("hex");
}

function onboardingInviteUrl(token: string): string {
  return `${ONBOARDING_AUTH_BASE}?invite=${encodeURIComponent(token)}`;
}

interface ApplicantRow {
  id: string;
  email: string | null;
  phone: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  zip_code: string | null;
  state: string | null;
  stage: string;
  cleaner_id: string | null;
  onboarding_launched_at: string | null;
  rejection_reason?: string | null;
}

interface CleanerRow {
  id: string;
  status: string | null;
  approved: boolean | null;
  ob_agreement_signed: boolean | null;
  ob_payouts_setup: boolean | null;
  payouts_enabled: boolean | null;
  stripe_account_id: string | null;
}

async function logEvent(
  supabase: ReturnType<typeof getAdminSupabase>,
  args: { type: string; summary: string; cleanerId?: string | null; data?: Record<string, unknown> },
) {
  await supabase.from("events").insert({
    event_type: args.type,
    source: "cleaner-hub",
    cleaner_id: args.cleanerId || null,
    summary: args.summary,
    data: args.data || {},
  });
}

/** Digits-only sanity check before we ask a transport to send anywhere. */
function usablePhone(input: string | null | undefined): string | null {
  const digits = String(input || "").replace(/[^0-9]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  // Anything else (7-digit local, a note someone typed in the phone field) can
  // never be delivered, and saying so beats a downstream "unable to resolve
  // contactId" the operator has to decode.
  return null;
}

interface InviteOutcome {
  emailed: boolean;
  smsSent: boolean;
  emailError: string | null;
  smsError: string | null;
}

/**
 * Email + SMS through the existing notification infrastructure.
 *
 * Both channels report WHY they failed rather than just that they did. The
 * old version threw the reason away, so a missing GHL token, an unreachable
 * phone number and a dead Resend key all surfaced to the admin as the same
 * unactionable "Action failed".
 */
async function sendOnboardingInvite(
  supabase: ReturnType<typeof getAdminSupabase>,
  applicant: ApplicantRow,
  onboardingUrl: string,
): Promise<InviteOutcome> {
  const firstName = applicant.first_name || applicant.full_name || "there";
  const out: InviteOutcome = { emailed: false, smsSent: false, emailError: null, smsError: null };

  if (applicant.email) {
    const { data, error } = await supabase.functions.invoke("send-cleaner-email", {
      body: {
        type: "invitation",
        email: applicant.email,
        data: {
          firstName,
          lastName: applicant.last_name || "",
          email: applicant.email,
          onboardingUrl,
        },
      },
    });
    const res = await edgeResult(error, data);
    out.emailed = res.ok;
    if (!res.ok) {
      out.emailError = res.error;
      // eslint-disable-next-line no-console
      console.warn("[talent-actions] invite email failed:", res.error);
    }
  } else {
    out.emailError = "No email on the applicant record.";
  }

  const phone = usablePhone(applicant.phone);
  if (!phone) {
    out.smsError = applicant.phone
      ? `"${applicant.phone}" isn't a sendable mobile number.`
      : "No phone on the applicant record.";
  } else {
    const message =
      `Hi ${firstName}! It's Novara Cleaning — you've been selected to join our contractor team. ` +
      `Start your onboarding here (agreement, payout setup & portal access): ${onboardingUrl} ` +
      `Questions? Just reply to this text.`;

    // GHL is the canonical SMS channel. send-sms-notification is the fallback,
    // but note it ALSO falls back to GHL internally — so when GHL itself is the
    // thing that's broken (bad token, no verified number), both hops fail for
    // the same reason and the operator needs to see that reason once, clearly,
    // rather than twice as a generic failure.
    const { data, error } = await supabase.functions.invoke("send-ghl-sms", {
      body: { phone, message, type: "confirmation", firstName },
    });
    const ghl = await edgeResult(error, data);
    if (ghl.ok) {
      out.smsSent = true;
    } else {
      const { data: tData, error: tErr } = await supabase.functions.invoke("send-sms-notification", {
        body: { toPhone: phone, message, type: "confirmation" },
      });
      const telnyx = await edgeResult(tErr, tData);
      out.smsSent = telnyx.ok;
      if (!telnyx.ok) {
        out.smsError = `${ghl.error}${telnyx.error === ghl.error ? "" : ` (fallback: ${telnyx.error})`}`;
        // eslint-disable-next-line no-console
        console.warn("[talent-actions] invite SMS failed:", out.smsError);
      }
    }
  }

  return out;
}

export async function POST(req: Request): Promise<NextResponse> {
  let principal: { userId: string; email: string };
  try {
    principal = await requireAdmin(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return NextResponse.json({ error: e.message }, { status: e.status || 401 });
  }

  let body: { action?: string; applicantId?: string; reason?: string; targetStage?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const action = String(body.action || "");
  const applicantId = String(body.applicantId || "");
  if (!action || !applicantId) {
    return NextResponse.json({ error: "action and applicantId are required" }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const { data: applicantData, error: aErr } = await supabase
    .from("cleaner_applicants")
    .select(
      "id, email, phone, full_name, first_name, last_name, zip_code, state, stage, cleaner_id, onboarding_launched_at, rejection_reason",
    )
    .eq("id", applicantId)
    .maybeSingle();
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  const applicant = applicantData as ApplicantRow | null;
  if (!applicant) return NextResponse.json({ error: "Applicant not found" }, { status: 404 });

  const setStage = async (stage: string, extra: Record<string, unknown> = {}) => {
    const { error } = await supabase
      .from("cleaner_applicants")
      .update({
        stage,
        stage_changed_at: new Date().toISOString(),
        stage_changed_by: principal.email,
        ...extra,
      })
      .eq("id", applicantId);
    if (error) throw new Error(error.message);
  };

  const who = applicant.full_name || applicant.email || applicantId;

  try {
    switch (action) {
      case "advance_screening": {
        await setStage("screening");
        await logEvent(supabase, {
          type: "applicant.stage_changed",
          summary: `${who} advanced to screening by ${principal.email}`,
          cleanerId: applicant.cleaner_id,
          data: { applicant_id: applicantId, from: applicant.stage, to: "screening" },
        });
        return NextResponse.json({ ok: true, stage: "screening" });
      }

      case "reject": {
        const reason = String(body.reason || "").trim();
        if (!reason) return NextResponse.json({ error: "A rejection reason is required" }, { status: 400 });
        await setStage("rejected", { rejection_reason: reason });
        await logEvent(supabase, {
          type: "applicant.stage_changed",
          summary: `${who} rejected by ${principal.email} — ${reason}`,
          cleanerId: applicant.cleaner_id,
          data: { applicant_id: applicantId, from: applicant.stage, to: "rejected", reason },
        });
        return NextResponse.json({ ok: true, stage: "rejected" });
      }

      case "reinstate": {
        // Bring a rejected (or withdrawn) applicant back into the pipeline.
        // Default target is onboarding when they already had a launch / linked
        // cleaner; otherwise screening. Explicit targetStage wins when valid.
        if (applicant.stage !== "rejected" && applicant.stage !== "withdrawn") {
          return NextResponse.json(
            { error: `Can only reinstate from rejected/withdrawn (currently ${applicant.stage}).` },
            { status: 409 },
          );
        }
        const ALLOWED = new Set(["applicant", "screening", "hold", "onboarding"]);
        const requested = String(body.targetStage || "").trim().toLowerCase();
        const inferred =
          applicant.onboarding_launched_at || applicant.cleaner_id ? "onboarding" : "screening";
        const target = ALLOWED.has(requested) ? requested : inferred;
        const previousRejection = applicant.rejection_reason || null;

        await setStage(target, {
          rejection_reason: null,
          ...(target !== "hold"
            ? { hold_pending: null, hold_follow_up_at: null, hold_reminder_sent_at: null }
            : {}),
        });

        // If they already have a linked cleaner left inactive, nudge it back
        // to pending so onboarding can resume.
        if (applicant.cleaner_id && (target === "onboarding" || target === "screening")) {
          const { data: c } = await supabase
            .from("cleaners")
            .select("id, status")
            .eq("id", applicant.cleaner_id)
            .maybeSingle();
          const st = String(c?.status || "").toLowerCase();
          if (c && (st === "inactive" || st === "pending")) {
            await supabase
              .from("cleaners")
              .update({
                status: "pending",
                approved: false,
                available_for_bookings: false,
                deactivated_at: null,
                deactivation_reason: null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", c.id);
          }
        }

        await logEvent(supabase, {
          type: "applicant.reinstated",
          summary: `${who} reinstated to ${target} by ${principal.email}` +
            (previousRejection ? ` (was rejected: ${previousRejection})` : ""),
          cleanerId: applicant.cleaner_id,
          data: {
            applicant_id: applicantId,
            from: applicant.stage,
            to: target,
            previous_rejection_reason: previousRejection,
          },
        });
        return NextResponse.json({ ok: true, stage: target });
      }

      case "launch_onboarding":
      case "resend_onboarding": {
        if (!applicant.email && !applicant.phone) {
          return NextResponse.json(
            { error: "Applicant has no email or phone to send onboarding to." },
            { status: 400 },
          );
        }

        // Create-or-link the cleaners row so onboarding progress (agreement,
        // payouts, portal) reads through live. New rows start pending +
        // unapproved — the existing access gates stay in force.
        let cleanerId = applicant.cleaner_id;
        if (!cleanerId && applicant.email) {
          const { data: found } = await supabase
            .from("cleaners")
            .select("id")
            .ilike("email", applicant.email)
            .maybeSingle();
          cleanerId = found?.id || null;
        }
        if (!cleanerId && action === "launch_onboarding") {
          // Carry data captured on the phone screening (availability days,
          // hard cutoffs, travel radius, supply notes) onto the contractor
          // record from day one — dispatch and the risk layer read these
          // existing fields, so nothing has to be re-entered later.
          const screeningFields: Record<string, unknown> = {};
          const { data: latestScreening } = await supabase
            .from("phone_screenings")
            .select("answers")
            .eq("applicant_id", applicantId)
            .eq("status", "submitted")
            .order("submitted_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (latestScreening?.answers) {
            const derived = deriveDownstreamFields(latestScreening.answers as ScreeningAnswers);
            if (derived.preferredDays.length > 0) screeningFields.preferred_work_days = derived.preferredDays;
            if (derived.travelRadiusMiles) screeningFields.max_travel_miles = derived.travelRadiusMiles;
            const constraints = {
              ...(derived.noWorkAfter ? { no_work_after: derived.noWorkAfter } : {}),
              ...(derived.noWorkBefore ? { no_work_before: derived.noWorkBefore } : {}),
              ...(derived.constraintNotes ? { notes: derived.constraintNotes } : {}),
            };
            if (Object.keys(constraints).length > 0) screeningFields.constraints = constraints;
          }

          const { data: createdRow, error: cErr } = await supabase
            .from("cleaners")
            .insert({
              first_name: applicant.first_name,
              last_name: applicant.last_name,
              email: applicant.email,
              phone: applicant.phone,
              home_zip: applicant.zip_code,
              state: applicant.state,
              status: "pending",
              approved: false,
              onboarding_complete: false,
              invited_at: new Date().toISOString(),
              ...screeningFields,
            })
            .select("id")
            .single();
          if (cErr) throw new Error(`Could not create cleaner record: ${cErr.message}`);
          cleanerId = createdRow.id as string;
        }

        // Mint a fresh invite token so the link skips /cleaner/role (video)
        // and lands on contractor auth → normal onboarding.
        const inviteToken = mintInviteToken();
        const inviteExpiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
        const inviteUrl = onboardingInviteUrl(inviteToken);
        const isResend = action === "resend_onboarding";

        // Persist the token BEFORE anything is sent. It used to be written
        // afterwards, so any failure on this update left a live text in
        // somebody's hand pointing at a token the database had never heard of —
        // an invite that looks fine and dies on tap.
        await setStage("onboarding", {
          cleaner_id: cleanerId,
          // Launching clears any hold — the pending item is resolved.
          hold_pending: null,
          hold_follow_up_at: null,
          hold_reminder_sent_at: null,
          invite_token: inviteToken,
          invite_expires_at: inviteExpiresAt,
          invite_sent_at: new Date().toISOString(),
          ...(isResend
            ? { onboarding_last_nudge_at: new Date().toISOString() }
            : { onboarding_launched_at: applicant.onboarding_launched_at || new Date().toISOString() }),
        });

        const { emailed, smsSent, emailError, smsError } = await sendOnboardingInvite(
          supabase,
          applicant,
          inviteUrl,
        );

        await logEvent(supabase, {
          type: "applicant.onboarding_launched",
          summary:
            `${isResend ? "Onboarding re-sent to" : "Onboarding launched for"} ${who} by ${principal.email} ` +
            `(email: ${emailed ? "sent" : `failed — ${emailError}`}, SMS: ${smsSent ? "sent" : `failed — ${smsError}`})`,
          cleanerId,
          data: {
            applicant_id: applicantId,
            resend: isResend,
            emailed,
            smsSent,
            email_error: emailError,
            sms_error: smsError,
            invite_expires_at: inviteExpiresAt,
            skip_role_video: true,
          },
        });

        if (!emailed && !smsSent) {
          // The token is already on the record, so the link in the copy below
          // works — an admin can paste it into their own text rather than being
          // blocked entirely by a transport outage.
          return NextResponse.json(
            {
              error:
                `Couldn't reach ${who}. Email: ${emailError || "not attempted"}. SMS: ${smsError || "not attempted"}. ` +
                `The invite link is valid for 14 days if you want to send it yourself.`,
              emailError,
              smsError,
              inviteUrl,
            },
            { status: 502 },
          );
        }

        return NextResponse.json({
          ok: true,
          stage: "onboarding",
          emailed,
          smsSent,
          emailError,
          smsError,
          cleanerId,
          inviteUrl,
          inviteExpiresAt,
        });
      }

      case "activate": {
        if (!applicant.cleaner_id) {
          return NextResponse.json(
            { error: "No linked contractor record — launch onboarding first." },
            { status: 400 },
          );
        }
        const { data: cleanerData, error: clErr } = await supabase
          .from("cleaners")
          .select("id, status, approved, ob_agreement_signed, ob_payouts_setup, payouts_enabled, stripe_account_id")
          .eq("id", applicant.cleaner_id)
          .maybeSingle();
        if (clErr) return NextResponse.json({ error: clErr.message }, { status: 500 });
        const cleaner = cleanerData as CleanerRow | null;
        if (!cleaner) return NextResponse.json({ error: "Linked contractor record not found" }, { status: 404 });

        // Standing gate: no activation before signed agreement + payout setup.
        if (!cleaner.ob_agreement_signed) {
          return NextResponse.json(
            { error: "Agreement not signed yet — activation is blocked until the ICA is signed." },
            { status: 409 },
          );
        }
        const payoutsReady = Boolean(
          cleaner.payouts_enabled || cleaner.ob_payouts_setup || cleaner.stripe_account_id,
        );
        if (!payoutsReady) {
          return NextResponse.json(
            { error: "Payout setup (Stripe Connect) is not complete yet." },
            { status: 409 },
          );
        }

        const { error: upErr } = await supabase
          .from("cleaners")
          .update({
            status: "active",
            approved: true,
            activated_at: new Date().toISOString(),
          })
          .eq("id", cleaner.id);
        if (upErr) throw new Error(upErr.message);

        await setStage("active");
        await logEvent(supabase, {
          type: "cleaner.status_changed",
          summary: `${who} activated as a contractor by ${principal.email} (agreement signed + payouts ready)`,
          cleanerId: cleaner.id,
          data: { applicant_id: applicantId, action: "activate" },
        });
        return NextResponse.json({ ok: true, stage: "active", cleanerId: cleaner.id });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[talent-actions]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

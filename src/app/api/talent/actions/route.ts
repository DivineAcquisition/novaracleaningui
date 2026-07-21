// ─── POST /api/talent/actions ──────────────────────────────────────────────────
//
// Admin actions on cleaner-hub applicants (public.cleaner_applicants). The
// whole lifecycle lives here — Airtable is intake-only.
//
//   { action: "advance_screening", applicantId }
//   { action: "reject",            applicantId, reason }
//   { action: "launch_onboarding", applicantId }   ← email + SMS via existing channels
//   { action: "resend_onboarding", applicantId }   ← one-click nudge for stalled onboarding
//   { action: "activate",          applicantId }   ← gates: agreement signed + payout setup
//
// launch_onboarding reuses the EXISTING contractor onboarding flow: the invite
// email/SMS point at the contractor portal (account → wizard → sign the ICA →
// Stripe Connect W-9/payouts). No parallel onboarding is invented here. A
// cleaners row is created (status=pending, approved=false) so progress reads
// through live; portal access stays gated by the existing rules (no dispatch
// before signed agreement + admin approval/activation).
//
// Every stage change writes an events row (who / when) — the existing audit
// channel, which also feeds Discord.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ONBOARDING_URL = "https://contractor.novaracleaning.com/cleaner/role";

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

/** Email + SMS through the existing notification infrastructure. */
async function sendOnboardingInvite(
  supabase: ReturnType<typeof getAdminSupabase>,
  applicant: ApplicantRow,
): Promise<{ emailed: boolean; smsSent: boolean }> {
  const firstName = applicant.first_name || applicant.full_name || "there";
  let emailed = false;
  let smsSent = false;

  if (applicant.email) {
    const { error } = await supabase.functions.invoke("send-cleaner-email", {
      body: {
        type: "invitation",
        email: applicant.email,
        data: {
          firstName,
          lastName: applicant.last_name || "",
          email: applicant.email,
          onboardingUrl: ONBOARDING_URL,
        },
      },
    });
    emailed = !error;
    if (error) {
      // eslint-disable-next-line no-console
      console.warn("[talent-actions] invite email failed:", error.message);
    }
  }

  if (applicant.phone) {
    const message =
      `Hi ${firstName}! It's Novara Cleaning — you've been selected to join our contractor team. ` +
      `Start your onboarding here (agreement, payout setup & portal access): ${ONBOARDING_URL} ` +
      `Questions? Just reply to this text.`;
    // GHL is the canonical SMS channel; Telnyx is the fallback (mirrors
    // supabase/functions/_shared/sms.ts).
    const { data, error } = await supabase.functions.invoke("send-ghl-sms", {
      body: { phone: applicant.phone, message, type: "confirmation" },
    });
    smsSent = !error && !(data as { error?: string })?.error;
    if (!smsSent) {
      const { error: telnyxErr } = await supabase.functions.invoke("send-sms-notification", {
        body: { toPhone: applicant.phone, message, type: "confirmation" },
      });
      smsSent = !telnyxErr;
    }
  }

  return { emailed, smsSent };
}

export async function POST(req: Request): Promise<NextResponse> {
  let principal: { userId: string; email: string };
  try {
    principal = await requireAdmin(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return NextResponse.json({ error: e.message }, { status: e.status || 401 });
  }

  let body: { action?: string; applicantId?: string; reason?: string };
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
      "id, email, phone, full_name, first_name, last_name, zip_code, state, stage, cleaner_id, onboarding_launched_at",
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
            })
            .select("id")
            .single();
          if (cErr) throw new Error(`Could not create cleaner record: ${cErr.message}`);
          cleanerId = createdRow.id as string;
        }

        const { emailed, smsSent } = await sendOnboardingInvite(supabase, applicant);
        if (!emailed && !smsSent) {
          return NextResponse.json(
            { error: "Neither the onboarding email nor SMS could be sent." },
            { status: 502 },
          );
        }

        const isResend = action === "resend_onboarding";
        await setStage("onboarding", {
          cleaner_id: cleanerId,
          ...(isResend
            ? { onboarding_last_nudge_at: new Date().toISOString() }
            : { onboarding_launched_at: applicant.onboarding_launched_at || new Date().toISOString() }),
        });
        await logEvent(supabase, {
          type: "applicant.onboarding_launched",
          summary: `${isResend ? "Onboarding re-sent to" : "Onboarding launched for"} ${who} by ${principal.email} (email: ${emailed ? "sent" : "no"}, SMS: ${smsSent ? "sent" : "no"})`,
          cleanerId,
          data: { applicant_id: applicantId, resend: isResend, emailed, smsSent },
        });
        return NextResponse.json({ ok: true, stage: "onboarding", emailed, smsSent, cleanerId });
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

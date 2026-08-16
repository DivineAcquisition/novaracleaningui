import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { buildMembershipValues, sendAgreement } from "@/lib/docuseal";
import { membershipPlanLabel } from "@/lib/membership-visit";

export type EnsureMembershipAgreementInput = {
  email: string;
  name?: string;
  phone?: string;
  plan?: string;
  serviceAddress?: string;
  firstServiceDate?: string;
  membershipRateCents?: number;
  oneTimeRateCents?: number;
  initialDeepClean?: string;
  homeSizeId?: string;
  scheduleId?: string;
  paymentUrl?: string;
  holdPayment?: boolean;
  sendEmail?: boolean;
  createdBy?: string;
  metadata?: Record<string, unknown>;
};

export type EnsureMembershipAgreementResult = {
  ok: true;
  alreadySent?: boolean;
  skipped?: string;
  submissionId?: string | null;
  signingUrl?: string | null;
  recordId?: string | null;
  holdPayment?: boolean;
  paymentUrl?: string | null;
};

function normalizeEmail(raw: string): string {
  return String(raw || "").trim().toLowerCase();
}

/**
 * Send the Recurring Service & Membership Agreement at most once per email.
 * Skips when a membership DocuSeal row already exists, when the customer
 * signed the membership pay-page agreement, or when a recurring schedule
 * already has agreement_signed_at. Claim is atomic via the unique index on
 * (audience=membership, lower(email)).
 */
export async function ensureMembershipAgreement(
  input: EnsureMembershipAgreementInput,
): Promise<EnsureMembershipAgreementResult> {
  const email = normalizeEmail(input.email);
  if (!email || !email.includes("@")) {
    return { ok: true, skipped: "no email" };
  }

  const supabase = getAdminSupabase();
  const sendEmail = input.sendEmail !== false;
  const paymentUrl = input.paymentUrl ? String(input.paymentUrl).trim() : "";
  const holdPayment = input.holdPayment !== false && Boolean(paymentUrl);
  const plan = input.plan ? membershipPlanLabel(input.plan) || String(input.plan) : undefined;
  const name = input.name ? String(input.name).trim() : undefined;
  const createdBy = input.createdBy || "auto:membership-ensure";

  const { data: existingDoc } = await supabase
    .from("docuseal_submissions")
    .select("id, submission_id, signing_url, status")
    .eq("audience", "membership")
    .ilike("submitter_email", email)
    .not("status", "eq", "failed")
    .order("created_at", { ascending: false })
    .limit(1);
  if (Array.isArray(existingDoc) && existingDoc.length > 0) {
    const row = existingDoc[0];
    return {
      ok: true,
      alreadySent: true,
      skipped: "membership_docuseal_exists",
      submissionId: row.submission_id || null,
      signingUrl: row.signing_url || null,
      recordId: row.id || null,
      holdPayment,
      paymentUrl: holdPayment ? paymentUrl : null,
    };
  }

  const { data: signedSa } = await supabase
    .from("service_agreements")
    .select("id")
    .eq("agreement_type", "membership")
    .ilike("customer_email", email)
    .eq("agreed_service_agreement", true)
    .limit(1);
  if (Array.isArray(signedSa) && signedSa.length > 0) {
    return { ok: true, alreadySent: true, skipped: "membership_service_agreement_signed" };
  }

  const { data: signedSched } = await supabase
    .from("customer_recurring_schedules")
    .select("id")
    .ilike("email", email)
    .not("agreement_signed_at", "is", null)
    .limit(1);
  if (Array.isArray(signedSched) && signedSched.length > 0) {
    return { ok: true, alreadySent: true, skipped: "schedule_agreement_signed" };
  }

  const { data: claim, error: claimErr } = await supabase
    .from("docuseal_submissions")
    .insert({
      audience: "membership",
      submitter_email: email,
      submitter_name: name || null,
      role: "Member",
      status: "sending",
      created_by: createdBy,
      metadata: {
        kind: "membership_ensure",
        hold_payment: holdPayment,
        payment_url: paymentUrl || null,
        phone: input.phone || null,
        plan: plan || null,
        name: name || null,
        first_name: name ? name.split(/\s+/)[0] : null,
        membership_rate_cents: input.membershipRateCents ?? null,
        first_service_date: input.firstServiceDate || null,
        home_size_id: input.homeSizeId || null,
        schedule_id: input.scheduleId || null,
        ...(input.metadata || {}),
      },
    })
    .select("id")
    .single();
  if (claimErr || !claim) {
    return { ok: true, alreadySent: true, skipped: "membership_claim_exists" };
  }

  const values = buildMembershipValues({
    name,
    email,
    serviceAddress: input.serviceAddress,
    plan,
    membershipRateCents:
      input.membershipRateCents != null && Number.isFinite(input.membershipRateCents)
        ? Math.round(input.membershipRateCents)
        : undefined,
    oneTimeRateCents:
      input.oneTimeRateCents != null && Number.isFinite(input.oneTimeRateCents)
        ? Math.round(input.oneTimeRateCents)
        : undefined,
    firstServiceDate: input.firstServiceDate,
    initialDeepClean: input.initialDeepClean,
  });

  try {
    const result = await sendAgreement({
      audience: "membership",
      email,
      name,
      values,
      sendEmail,
      createdBy,
      skipTracking: true,
      metadata: {
        kind: holdPayment ? "membership_agree_then_pay" : "membership_ensure",
        hold_payment: holdPayment,
        payment_url: paymentUrl || null,
        phone: input.phone || null,
        plan: plan || null,
        schedule_id: input.scheduleId || null,
        ...(input.metadata || {}),
      },
    });
    await supabase
      .from("docuseal_submissions")
      .update({
        submission_id: result.submissionId,
        signing_url: result.signingUrl,
        submitter_name: name || null,
        status: "completed",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", claim.id);
    return {
      ok: true,
      ...result,
      recordId: claim.id,
      holdPayment,
      paymentUrl: holdPayment ? paymentUrl : null,
    };
  } catch (err) {
    await supabase.from("docuseal_submissions").delete().eq("id", claim.id);
    throw err;
  }
}

export async function backfillActiveMembershipAgreements(createdBy = "auto:membership-backfill") {
  const supabase = getAdminSupabase();
  const { data: schedules, error } = await supabase
    .from("customer_recurring_schedules")
    .select(
      "id, email, first_name, last_name, phone, address, city, state, zip_code, membership_plan, cadence, price_cents, next_service_date, home_size_id, agreement_signed_at",
    )
    .eq("active", true);
  if (error) throw error;

  const seen = new Set<string>();
  const results: Array<{ email: string; scheduleId: string; result: EnsureMembershipAgreementResult }> = [];
  for (const s of schedules || []) {
    const email = normalizeEmail(s.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const name = `${s.first_name || ""} ${s.last_name || ""}`.trim() || undefined;
    const addressLine = [s.address, s.city, [s.state, s.zip_code].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ");
    const result = await ensureMembershipAgreement({
      email,
      name,
      phone: s.phone || undefined,
      plan: s.membership_plan || s.cadence || undefined,
      serviceAddress: addressLine || undefined,
      firstServiceDate: s.next_service_date || undefined,
      oneTimeRateCents: s.price_cents != null ? Number(s.price_cents) : undefined,
      homeSizeId: s.home_size_id || undefined,
      scheduleId: s.id,
      holdPayment: false,
      sendEmail: true,
      createdBy,
    });
    results.push({ email, scheduleId: s.id, result });
  }
  return results;
}

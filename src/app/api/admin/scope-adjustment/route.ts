// ─── /api/admin/scope-adjustment ─────────────────────────────────────────
//
// GET  — everything the Scope Adjustment form needs for one booking: the
//        reason catalogue, the job's own condition photos, the pricing
//        engine's suggestion, prior adjustments, and any mid-job scope flag
//        the cleaner raised.
// POST — apply an adjustment.
//
// The rules that make an adjustment defensible are enforced here, not in the
// dialog, because the dialog is only one caller:
//
//   * at least one defined reason, and it must be a live reason code
//   * photo evidence must come from this job's own before/after sets; an
//     adjustment with no evidence is recorded as unsupported and requires a
//     written override
//   * the amount is recomputed from the pricing engine server-side; anything
//     off that number is flagged as an override and requires a note
//   * cleaner pay follows the adjusted work value and is never reduced
//
// Admin/VA gated. All money is integer cents.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { computeCrewPay, shareFor } from "@/lib/crew-pay";
import { syncJobByBookingId, DEFAULT_LIVE_ENTRY_SOURCE } from "@/lib/airtable/sync";
import { scopeAdjustmentChargeNowCents } from "@/lib/booking-balance";
import {
  draftJustificationMessage,
  isScopeAdjustable,
  serviceLabelFor,
  suggestScopeAdjustment,
  summarizeReasons,
  type ScopeReason,
} from "@/lib/scope-adjustment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOOKING_FIELDS =
  "id, booking_number, first_name, last_name, email, phone, address, city, state, status, service_type, home_size_id, add_ons, membership_plan, uses_credit, service_date, time_slot, total_estimate_cents, final_charge_cents, deposit_cents, payment_option, payment_received_at, customer_id, balance_amount_cents, balance_payment_intent_id, completion_hold_status, completion_hold_amount_cents, completion_hold_captured_amount, completion_hold_captured_at, team_notes, cleaner_payout_cents, payout_status, cleaner_id, job_id, before_photos, after_photos";

interface BookingContext {
  id: string;
  booking_number: number | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  status: string | null;
  service_type: string | null;
  home_size_id: string | null;
  add_ons: string[] | null;
  membership_plan: string | null;
  uses_credit: boolean | null;
  service_date: string | null;
  time_slot: string | null;
  total_estimate_cents: number | null;
  final_charge_cents: number | null;
  deposit_cents: number | null;
  payment_option: string | null;
  payment_received_at: string | null;
  customer_id: string | null;
  balance_amount_cents: number | null;
  balance_payment_intent_id: string | null;
  completion_hold_status: string | null;
  completion_hold_amount_cents: number | null;
  completion_hold_captured_amount: number | null;
  completion_hold_captured_at: string | null;
  team_notes: string | null;
  cleaner_payout_cents: number | null;
  payout_status: string | null;
  cleaner_id: string | null;
  job_id: string | null;
  before_photos: string[] | null;
  after_photos: string[] | null;
}

/** The revenue the customer is currently on the hook for. */
function currentPriceCents(b: BookingContext): number {
  return Number(b.final_charge_cents ?? b.total_estimate_cents ?? 0);
}

function evidencePool(b: BookingContext): string[] {
  return [...(b.before_photos || []), ...(b.after_photos || [])].filter(
    (u) => typeof u === "string" && u.startsWith("http"),
  );
}

// ─── GET: form context ───────────────────────────────────────────────────
export async function GET(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(req);
  } catch (e) {
    const err = e as AdminAuthError;
    return NextResponse.json({ error: err.message }, { status: err.status || 401 });
  }

  const bookingId = new URL(req.url).searchParams.get("bookingId") || "";
  if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });

  const supabase = getAdminSupabase();

  try {
    const { data: booking, error: bErr } = await supabase
      .from("bookings")
      .select(BOOKING_FIELDS)
      .eq("id", bookingId)
      .maybeSingle<BookingContext>();
    if (bErr) throw bErr;
    if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

    const { data: reasonRows } = await supabase
      .from("scope_adjustment_reasons")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true });
    const reasons = (reasonRows || []) as ScopeReason[];

    const { data: history } = await supabase
      .from("scope_adjustments")
      .select("*")
      .eq("booking_id", bookingId)
      .order("applied_at", { ascending: false });

    // A mid-job scope flag from the crew is the cue to talk to the customer
    // while the job is still live rather than after the invoice closes.
    const { data: fieldFlags } = await supabase
      .from("qc_issues")
      .select("id, issue_number, issue_type, severity, status, title, description, created_at")
      .eq("booking_id", bookingId)
      .eq("reported_via", "cleaner_field")
      .neq("status", "resolved")
      .order("created_at", { ascending: false });

    const original = currentPriceCents(booking);
    const suggestion = suggestScopeAdjustment({
      homeSizeId: booking.home_size_id,
      addOns: booking.add_ons || [],
      membershipPlan: booking.membership_plan,
      usesCredit: booking.uses_credit === true,
      originalServiceType: booking.service_type,
      adjustedServiceType: "deep",
      originalPriceCents: original,
    });

    return NextResponse.json({
      ok: true,
      booking: {
        id: booking.id,
        bookingNumber: booking.booking_number,
        firstName: booking.first_name,
        status: booking.status,
        serviceType: booking.service_type,
        homeSizeId: booking.home_size_id,
        addOns: booking.add_ons || [],
        membershipPlan: booking.membership_plan || "none",
        usesCredit: booking.uses_credit === true,
        serviceDate: booking.service_date,
        originalPriceCents: original,
        adjustable: isScopeAdjustable(booking.status),
        payoutStatus: booking.payout_status,
        cleanerPayoutCents: booking.cleaner_payout_cents,
      },
      reasons,
      evidencePhotos: {
        before: (booking.before_photos || []).filter((u) => u?.startsWith("http")),
        after: (booking.after_photos || []).filter((u) => u?.startsWith("http")),
      },
      // Default suggestion is the common case (reclassify to Deep); the UI
      // re-asks whenever the admin changes the target scope.
      defaultSuggestion: suggestion,
      history: history || [],
      fieldFlags: fieldFlags || [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[scope-adjustment:GET]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── POST: apply an adjustment ───────────────────────────────────────────
export async function POST(req: Request): Promise<NextResponse> {
  let principal;
  try {
    principal = await requireAdmin(req);
  } catch (e) {
    const err = e as AdminAuthError;
    return NextResponse.json({ error: err.message }, { status: err.status || 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const bookingId = String(body.bookingId || "");
  const reasonCodes = Array.isArray(body.reasonCodes) ? body.reasonCodes.map(String) : [];
  const adjustedPriceCents = Math.round(Number(body.adjustedPriceCents));
  const adjustedServiceType = body.adjustedServiceType ? String(body.adjustedServiceType) : null;
  const adjustedHomeSizeId = body.adjustedHomeSizeId ? String(body.adjustedHomeSizeId) : null;
  const adjustedAddOns = Array.isArray(body.adjustedAddOns) ? body.adjustedAddOns.map(String) : null;
  const evidencePhotos = Array.isArray(body.evidencePhotos) ? body.evidencePhotos.map(String) : [];
  const evidenceOverrideNote = String(body.evidenceOverrideNote || "").trim();
  const overrideNote = String(body.overrideNote || "").trim();
  const internalNote = String(body.internalNote || "").trim();
  const customerMessage = String(body.customerMessage || "").trim();
  const sendSms = body.sendSms !== false;
  const sendEmail = body.sendEmail !== false;

  if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });
  if (reasonCodes.length === 0) {
    return NextResponse.json(
      { error: "Pick at least one reason — an adjustment has to map to a defined justification.", code: "reason_required" },
      { status: 400 },
    );
  }
  if (!Number.isFinite(adjustedPriceCents) || adjustedPriceCents <= 0) {
    return NextResponse.json({ error: "adjustedPriceCents must be a positive integer" }, { status: 400 });
  }

  const supabase = getAdminSupabase();

  try {
    const { data: booking, error: bErr } = await supabase
      .from("bookings")
      .select(BOOKING_FIELDS)
      .eq("id", bookingId)
      .maybeSingle<BookingContext>();
    if (bErr) throw bErr;
    if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

    if (!isScopeAdjustable(booking.status)) {
      return NextResponse.json(
        { error: `A ${booking.status || "this"} booking cannot be scope-adjusted.`, code: "not_adjustable" },
        { status: 409 },
      );
    }

    const originalPriceCents = currentPriceCents(booking);
    if (adjustedPriceCents <= originalPriceCents) {
      return NextResponse.json(
        {
          error: `The adjusted price must be above the current ${(originalPriceCents / 100).toFixed(2)}. Use "Adjust job cost" to reduce a job.`,
          code: "not_an_increase",
        },
        { status: 400 },
      );
    }

    // Reasons must be live codes from the catalogue.
    const { data: reasonRows } = await supabase
      .from("scope_adjustment_reasons")
      .select("*")
      .eq("active", true);
    const reasons = (reasonRows || []) as ScopeReason[];
    const unknown = reasonCodes.filter((c) => !reasons.some((r) => r.code === c));
    if (unknown.length) {
      return NextResponse.json(
        { error: `Unknown or retired reason: ${unknown.join(", ")}`, code: "reason_invalid" },
        { status: 400 },
      );
    }

    // Evidence must be this job's own photos — an adjustment cannot cite
    // pictures from somewhere else.
    const pool = new Set(evidencePool(booking));
    const foreign = evidencePhotos.filter((u) => !pool.has(u));
    if (foreign.length) {
      return NextResponse.json(
        { error: "Evidence photos must come from this job's before/after sets.", code: "evidence_foreign" },
        { status: 400 },
      );
    }
    const evidenceMissing = evidencePhotos.length === 0;
    if (evidenceMissing && !evidenceOverrideNote) {
      return NextResponse.json(
        {
          error:
            "This job has no photo evidence attached. Reference the condition photos, or record a written override to proceed — it will be flagged as unsupported.",
          code: "evidence_required",
        },
        { status: 400 },
      );
    }

    // Recompute the suggestion server-side; the client's number is advisory.
    const suggestion = suggestScopeAdjustment({
      homeSizeId: booking.home_size_id,
      addOns: booking.add_ons || [],
      membershipPlan: booking.membership_plan,
      usesCredit: booking.uses_credit === true,
      originalServiceType: booking.service_type,
      adjustedServiceType,
      adjustedHomeSizeId,
      adjustedAddOns: adjustedAddOns || booking.add_ons || [],
      originalPriceCents,
    });
    const amountOverridden =
      suggestion.unpriced || adjustedPriceCents !== suggestion.suggestedPriceCents;
    if (amountOverridden && !overrideNote) {
      return NextResponse.json(
        {
          error: suggestion.unpriced
            ? "Nothing was reclassified, so the pricing engine has no suggestion — add a note explaining how this amount was reached."
            : `That is off the pricing engine's suggested ${(suggestion.suggestedPriceCents / 100).toFixed(2)} — add a note explaining the difference.`,
          code: "override_note_required",
          suggestedPriceCents: suggestion.suggestedPriceCents,
        },
        { status: 400 },
      );
    }

    // ─── Apply the new revenue (and the reclassified service) ────────────
    // final_charge_cents is the adjusted total. Leave total_estimate_cents
    // alone so complete-booking can tell original quote from extras:
    // remaining = final − collected(original).
    const bookingUpdate: Record<string, unknown> = {
      final_charge_cents: adjustedPriceCents,
      updated_at: new Date().toISOString(),
    };
    if (adjustedServiceType && adjustedServiceType !== booking.service_type) {
      bookingUpdate.service_type = adjustedServiceType;
    }
    if (adjustedHomeSizeId && adjustedHomeSizeId !== booking.home_size_id) {
      bookingUpdate.home_size_id = adjustedHomeSizeId;
    }
    if (adjustedAddOns) {
      bookingUpdate.add_ons = adjustedAddOns;
    }
    const { error: updErr } = await supabase.from("bookings").update(bookingUpdate).eq("id", bookingId);
    if (updErr) throw updErr;

    // ─── Cleaner pay follows the work actually performed ─────────────────
    const pay = await protectCleanerPay(supabase, booking, adjustedPriceCents);

    // In-progress jobs: extra waits for complete-booking (which reads
    // final_charge_cents). Already-complete jobs: complete-booking will not
    // run again, so collect the extra now. Never fail the adjustment if Stripe
    // declines — the extra is still on the booking.
    const { data: addonChargeRows } = await supabase
      .from("booking_addon_charges")
      .select("amount_cents, status")
      .eq("booking_id", bookingId);
    const paidAddonCents = (addonChargeRows || [])
      .filter((r: { status: string | null }) => r.status === "paid" || r.status === "charged")
      .reduce((s: number, r: { amount_cents: number | null }) => s + (Number(r.amount_cents) || 0), 0);

    const chargeNowCents = scopeAdjustmentChargeNowCents(booking, adjustedPriceCents, paidAddonCents);
    let chargeStatus: "deferred_until_complete" | "charged" | "failed" | "missing_card" | "skipped" =
      chargeNowCents > 0 ? "skipped" : "deferred_until_complete";
    let chargeError: string | null = null;
    let chargePaymentIntentId: string | null = null;
    if (chargeNowCents > 0) {
      const charged = await chargeScopeExtraOffSession(supabase, booking, chargeNowCents, {
        bookingId,
        adjustmentDeltaCents: adjustedPriceCents - originalPriceCents,
      });
      chargeStatus = charged.status;
      chargeError = charged.error;
      chargePaymentIntentId = charged.paymentIntentId;
    }

    // ─── QC documentation link ───────────────────────────────────────────
    const { data: docRow } = await supabase
      .from("job_documentation")
      .select("id")
      .eq("booking_id", bookingId)
      .maybeSingle();

    const chargeAt = chargeStatus === "charged" || booking.status === "completed" ? "now" : "completion";
    const message =
      customerMessage ||
      draftJustificationMessage({
        firstName: booking.first_name,
        reasons,
        selectedCodes: reasonCodes,
        adjustedServiceType: adjustedServiceType || booking.service_type,
        adjustedPriceCents,
        originalPriceCents,
        serviceDate: booking.service_date,
        hasPhotoEvidence: !evidenceMissing,
        chargeAt,
      });

    const chargeWhen =
      chargeStatus === "charged"
        ? "Charged to the card on file"
        : "When this clean is completed";

    // ─── Notify the customer, then archive exactly what was sent ─────────
    const channels: string[] = [];
    if (sendSms && booking.phone) {
      try {
        const { error } = await supabase.functions.invoke("send-ghl-sms", {
          body: {
            phone: booking.phone,
            email: booking.email || undefined,
            firstName: booking.first_name || undefined,
            message,
            type: "scope_adjustment",
          },
        });
        if (!error) channels.push("sms");
      } catch {
        /* non-blocking — the adjustment is still recorded */
      }
    }
    if (sendEmail && booking.email) {
      try {
        const { error } = await supabase.functions.invoke("send-addon-email", {
          body: {
            type: "scope_adjustment",
            email: booking.email,
            data: {
              name: booking.first_name || undefined,
              bookingRef: booking.booking_number ? `NVC-${String(booking.booking_number).padStart(4, "0")}` : undefined,
              serviceDate: booking.service_date || undefined,
              serviceAddress: [booking.address, booking.city, booking.state].filter(Boolean).join(", ") || undefined,
              amount: `$${(adjustedPriceCents / 100).toFixed(2)}`,
              originalAmount: `$${(originalPriceCents / 100).toFixed(2)}`,
              serviceLabel: serviceLabelFor(adjustedServiceType || booking.service_type, reasons),
              justification: message,
              photoCount: evidencePhotos.length,
              chargeWhen,
            },
          },
        });
        if (!error) channels.push("email");
      } catch {
        /* non-blocking */
      }
    }

    // ─── The QC record for the price change ──────────────────────────────
    const { data: adjustment, error: insErr } = await supabase
      .from("scope_adjustments")
      .insert({
        booking_id: bookingId,
        documentation_id: docRow?.id || null,
        reason_codes: reasonCodes,
        internal_note: internalNote || null,
        original_service_type: booking.service_type,
        adjusted_service_type: adjustedServiceType || booking.service_type,
        original_price_cents: originalPriceCents,
        adjusted_price_cents: adjustedPriceCents,
        suggested_price_cents: suggestion.unpriced ? null : suggestion.suggestedPriceCents,
        pricing_basis: suggestion.basis,
        amount_overridden: amountOverridden,
        override_note: overrideNote || null,
        evidence_photos: evidencePhotos,
        evidence_photo_count: evidencePhotos.length,
        evidence_missing: evidenceMissing,
        evidence_override_note: evidenceOverrideNote || null,
        customer_message: message,
        message_channels: channels,
        message_sent_at: channels.length ? new Date().toISOString() : null,
        cleaner_payout_before_cents: pay.before,
        cleaner_payout_after_cents: pay.after,
        payout_supplement_cents: pay.supplementCents,
        payout_already_released: pay.alreadyReleased,
        applied_by: principal.userId,
        applied_by_name: principal.email,
      })
      .select("id")
      .single();
    if (insErr) throw insErr;

    const deltaCents = adjustedPriceCents - originalPriceCents;

    await supabase
      .from("events")
      .insert({
        event_type: "booking.scope_adjusted",
        booking_id: bookingId,
        source: "scope-adjustment",
        summary:
          `Scope adjusted $${(originalPriceCents / 100).toFixed(2)} → $${(adjustedPriceCents / 100).toFixed(2)} ` +
          `(${summarizeReasons(reasons, reasonCodes)})${evidenceMissing ? " · UNSUPPORTED (no photo evidence)" : ""}`,
        data: {
          adjustmentId: adjustment.id,
          reasonCodes,
          originalPriceCents,
          adjustedPriceCents,
          deltaCents,
          suggestedPriceCents: suggestion.suggestedPriceCents,
          amountOverridden,
          evidenceMissing,
          evidencePhotoCount: evidencePhotos.length,
          channels,
          chargeStatus,
          chargeNowCents,
          chargePaymentIntentId,
          payout: pay,
          by: principal.userId,
        },
      })
      .then(() => undefined, () => undefined);

    // Crew is owed more than what already went out the door — surface it so
    // payroll settles the difference; the company eats it, not the cleaner.
    if (pay.supplementCents > 0) {
      await supabase
        .from("events")
        .insert({
          event_type: "payroll.scope_supplement_due",
          booking_id: bookingId,
          source: "scope-adjustment",
          summary: `Supplemental pay owed $${(pay.supplementCents / 100).toFixed(2)} per cleaner — payout was released before the scope adjustment`,
          data: { adjustmentId: adjustment.id, ...pay },
        })
        .then(() => undefined, () => undefined);
    }

    // Keep revenue consistent downstream (same path adjust-job-cost uses).
    let airtableSynced = false;
    try {
      airtableSynced = !!(await syncJobByBookingId(bookingId, { entrySource: DEFAULT_LIVE_ENTRY_SOURCE }));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[scope-adjustment] airtable sync failed (non-blocking)", (e as Error).message);
    }
    try {
      await supabase.functions.invoke("send-zapier-webhook", { body: { bookingId, source: "scope-adjustment" } });
    } catch {
      /* non-blocking — the booking-change trigger also covers this */
    }

    return NextResponse.json({
      ok: true,
      adjustmentId: adjustment.id,
      originalPriceCents,
      adjustedPriceCents,
      deltaCents,
      suggestedPriceCents: suggestion.unpriced ? null : suggestion.suggestedPriceCents,
      amountOverridden,
      evidenceMissing,
      channels,
      chargeStatus,
      chargeNowCents,
      chargeError,
      payout: pay,
      airtableSynced,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[scope-adjustment:POST]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type ChargeResult = {
  status: "charged" | "failed" | "missing_card";
  error: string | null;
  paymentIntentId: string | null;
};

async function stripeSecret(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase
    .from("app_secrets")
    .select("value")
    .eq("key", "STRIPE_SECRET_KEY")
    .maybeSingle();
  return ((data?.value as string) || process.env.STRIPE_SECRET_KEY || "").trim();
}

async function stripeCall(
  key: string,
  method: "GET" | "POST",
  path: string,
  params?: Record<string, string>,
  idempotencyKey?: string,
): Promise<Record<string, unknown>> {
  const url = new URL(`https://api.stripe.com/v1/${path}`);
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const init: RequestInit = { method, headers };
  if (params && method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  } else if (params) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(params).toString();
  }
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = data?.error as { message?: string } | undefined;
    throw new Error(err?.message || `Stripe ${res.status}`);
  }
  return data;
}

/**
 * Off-session charge for a scope extra on a job that is already complete.
 * Best-effort: never throws.
 */
async function chargeScopeExtraOffSession(
  supabase: SupabaseClient,
  booking: BookingContext,
  amountCents: number,
  meta: { bookingId: string; adjustmentDeltaCents: number },
): Promise<ChargeResult> {
  if (amountCents <= 0) return { status: "failed", error: "nothing to charge", paymentIntentId: null };
  try {
    const key = await stripeSecret(supabase);
    if (!key) throw new Error("STRIPE_SECRET_KEY not configured");

    let customerId: string | null =
      booking.customer_id && booking.customer_id.startsWith("cus_") ? booking.customer_id : null;
    if (!customerId && booking.email) {
      const { data: custRow } = await supabase
        .from("customers")
        .select("stripe_customer_id")
        .eq("email", booking.email)
        .maybeSingle();
      const fromRow = String(custRow?.stripe_customer_id || "");
      if (fromRow.startsWith("cus_")) customerId = fromRow;
    }
    if (!customerId && booking.email) {
      const listed = await stripeCall(key, "GET", "customers", { email: booking.email, limit: "1" });
      const data = listed.data as Array<{ id?: string }> | undefined;
      customerId = data?.[0]?.id || null;
    }
    if (!customerId) throw new Error("No Stripe customer on file");

    const pms = await stripeCall(key, "GET", "payment_methods", {
      customer: customerId,
      type: "card",
      limit: "1",
    });
    const pmId = (pms.data as Array<{ id?: string }> | undefined)?.[0]?.id;
    if (!pmId) return { status: "missing_card", error: "No saved card on file", paymentIntentId: null };

    const bookingRef = booking.booking_number
      ? `NVC-${String(booking.booking_number).padStart(4, "0")}`
      : `BK-${meta.bookingId.slice(0, 8)}`;

    const pi = await stripeCall(key, "POST", "payment_intents", {
      amount: String(amountCents),
      currency: "usd",
      customer: customerId,
      payment_method: pmId,
      off_session: "true",
      confirm: "true",
      description: `${bookingRef} — Scope adjustment extra`,
      "metadata[bookingId]": meta.bookingId,
      "metadata[bookingNumber]": String(booking.booking_number ?? ""),
      "metadata[chargeType]": "scope_adjustment",
      "metadata[deltaCents]": String(meta.adjustmentDeltaCents),
    }, `scope-adj-${meta.bookingId}-${amountCents}`);

    const piId = String(pi.id || "");
    const already = Number(booking.balance_amount_cents || 0);
    await supabase
      .from("bookings")
      .update({
        customer_id: customerId,
        balance_payment_intent_id: booking.balance_payment_intent_id || piId,
        balance_amount_cents: already + amountCents,
        team_notes: [
          booking.team_notes || "",
          `Scope extra $${(amountCents / 100).toFixed(2)} charged off-session ${piId} (${new Date().toISOString().slice(0, 10)}).`,
        ].filter(Boolean).join("\n"),
      })
      .eq("id", meta.bookingId);

    return { status: "charged", error: null, paymentIntentId: piId || null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.warn("[scope-adjustment] off-session charge failed (non-blocking)", message);
    return { status: "failed", error: message, paymentIntentId: null };
  }
}

interface PayResult {
  before: number;
  after: number;
  perCleanerCents: number;
  payPercentage: number;
  cleanerCount: number;
  supplementCents: number;
  alreadyReleased: boolean;
}

/**
 * Recompute the crew's share off the adjusted job value using the same
 * revenue-share math complete-booking uses, and raise pay to match. Pay only
 * ever moves up here: the cleaner did the heavier work, so a billing outcome
 * must never claw it back. If the payout already went out at the old value,
 * the released amount is left untouched and the shortfall is recorded as a
 * supplement for payroll to settle.
 */
async function protectCleanerPay(
  supabase: SupabaseClient,
  booking: BookingContext,
  adjustedRevenueCents: number,
): Promise<PayResult> {
  const before = Number(booking.cleaner_payout_cents || 0);
  const alreadyReleased = String(booking.payout_status || "").toLowerCase() === "completed";
  const result: PayResult = {
    before,
    after: before,
    perCleanerCents: before,
    payPercentage: 0,
    cleanerCount: 0,
    supplementCents: 0,
    alreadyReleased,
  };

  try {
    const { data: assigns } = await supabase
      .from("job_assignments")
      .select("id, cleaner_id, estimated_pay_cents, pay_locked_at, pay_percentage_snapshot, crew_size_snapshot")
      .eq("job_id", booking.job_id || "")
      .in("status", ["Confirmed", "Accepted", "accepted", "In Progress", "completed"]);

    // The crew that performed the work. Crew size drives the RATE now, not just
    // the split, so it has to come from the real crew rather than the booking's
    // planned headcount.
    const crew: string[] = (assigns || [])
      .map((a: { cleaner_id: string }) => a.cleaner_id)
      .filter(Boolean);
    // An admin-assigned booking may have no assignment row.
    if (booking.cleaner_id && !crew.includes(booking.cleaner_id)) {
      crew.push(booking.cleaner_id);
    }
    if (crew.length === 0) return result;

    // The adjusted value is the final approved value, so pay rises with it —
    // each cleaner at their own tier's rate for this crew size.
    const shares = await computeCrewPay(supabase, adjustedRevenueCents, crew);
    if (shares.length === 0) return result;

    result.payPercentage = shares[0].ratePercent;
    result.cleanerCount = shares[0].crewSize;

    const leadShare = shareFor(shares, booking.cleaner_id) || shares[0];
    result.perCleanerCents = leadShare.shareCents;

    if (alreadyReleased) {
      // Do not rewrite what was already paid — record the gap instead.
      result.supplementCents = Math.max(0, leadShare.shareCents - before);
      return result;
    }

    // Never move pay down: the crew did the work at the higher scope.
    const after = Math.max(before, leadShare.shareCents);
    result.after = after;
    if (after !== before) {
      await supabase.from("bookings").update({ cleaner_payout_cents: after }).eq("id", booking.id);
    }
    await Promise.all(
      (assigns || []).map((a: {
        id: string;
        cleaner_id: string;
        estimated_pay_cents?: number | null;
        pay_locked_at?: string | null;
        pay_percentage_snapshot?: number | null;
        crew_size_snapshot?: number | null;
      }) => {
        const share = shareFor(shares, a.cleaner_id);
        if (!share) return Promise.resolve();
        // Per-cleaner, so a mixed crew isn't flattened onto one number.
        const prev = Number(a.estimated_pay_cents || 0);
        const next = Math.max(prev, share.shareCents);
        const update = supabase
          .from("job_assignments")
          .update({
            estimated_pay_cents: next,
            pay_percentage_snapshot: share.ratePercent,
            crew_size_snapshot: share.crewSize,
          })
          .eq("id", a.id);
        // Pay was locked at completion — any change after that leaves a trail.
        if (a.pay_locked_at && next !== prev) {
          return Promise.all([
            update,
            supabase.from("cleaner_pay_recalcs").insert({
              job_id: booking.job_id,
              booking_id: booking.id,
              cleaner_id: a.cleaner_id,
              reason: "Approved scope adjustment raised final job value",
              crew_size_before: a.crew_size_snapshot ?? share.crewSize,
              crew_size_after: share.crewSize,
              rate_before: a.pay_percentage_snapshot ?? share.ratePercent,
              rate_after: share.ratePercent,
              pay_before_cents: prev,
              pay_after_cents: next,
            }),
          ]).then(() => undefined);
        }
        return update;
      }),
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[scope-adjustment] pay recompute failed (non-blocking)", (e as Error).message);
  }

  return result;
}

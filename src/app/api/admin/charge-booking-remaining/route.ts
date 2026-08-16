// ─── POST /api/admin/charge-booking-remaining ────────────────────────────
//
// Charges whatever is still owed on a booking (final_charge minus deposit,
// already-captured completion, and add-ons already billed). Used from the
// Bookings tab so captured vs remaining stay in line with Stripe.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { remainingDueAtCompletionCents } from "@/lib/booking-balance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOOKING_COLS =
  "id, booking_number, email, first_name, service_type, service_date, status, customer_id, payment_option, uses_credit, total_estimate_cents, final_charge_cents, deposit_cents, payment_received_at, balance_amount_cents, balance_payment_intent_id, completion_hold_status, completion_hold_amount_cents, completion_hold_captured_amount, completion_hold_captured_at, team_notes";

async function stripeSecret(): Promise<string> {
  const supabase = getAdminSupabase();
  const { data } = await supabase.from("app_secrets").select("value").eq("key", "STRIPE_SECRET_KEY").maybeSingle();
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

async function paidAddonCentsFor(bookingId: string): Promise<number> {
  const supabase = getAdminSupabase();
  const { data } = await supabase
    .from("booking_addon_charges")
    .select("amount_cents, status")
    .eq("booking_id", bookingId);
  return (data || [])
    .filter((r: { status: string | null }) => r.status === "paid" || r.status === "charged")
    .reduce((s: number, r: { amount_cents: number | null }) => s + (Number(r.amount_cents) || 0), 0);
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(req);
  } catch (e) {
    const err = e as AdminAuthError;
    return NextResponse.json({ error: err.message }, { status: err.status || 401 });
  }

  let bookingId = "";
  try {
    const body = (await req.json()) as { bookingId?: string };
    bookingId = String(body.bookingId || "");
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });

  const supabase = getAdminSupabase();
  const { data: booking, error } = await supabase.from("bookings").select(BOOKING_COLS).eq("id", bookingId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const paidAddonCents = await paidAddonCentsFor(bookingId);
  const remainingCents = remainingDueAtCompletionCents(booking, paidAddonCents);
  if (remainingCents <= 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      remainingCents: 0,
      chargedCents: 0,
      message: "Nothing remaining to charge.",
    });
  }

  try {
    const key = await stripeSecret();
    if (!key) throw new Error("STRIPE_SECRET_KEY not configured");

    let customerId = String(booking.customer_id || "");
    if (!customerId.startsWith("cus_")) {
      const { data: custRow } = await supabase
        .from("customers")
        .select("stripe_customer_id")
        .eq("email", booking.email)
        .maybeSingle();
      customerId = String(custRow?.stripe_customer_id || "");
    }
    if (!customerId.startsWith("cus_") && booking.email) {
      const listed = await stripeCall(key, "GET", "customers", { email: String(booking.email), limit: "1" });
      customerId = (listed.data as Array<{ id?: string }> | undefined)?.[0]?.id || "";
    }
    if (!customerId.startsWith("cus_")) throw new Error("No Stripe customer on file");

    const pms = await stripeCall(key, "GET", "payment_methods", { customer: customerId, type: "card", limit: "1" });
    const pmId = (pms.data as Array<{ id?: string }> | undefined)?.[0]?.id;
    if (!pmId) throw new Error("No saved card on file");

    const bookingRef = booking.booking_number
      ? `NVC-${String(booking.booking_number).padStart(4, "0")}`
      : `BK-${bookingId.slice(0, 8)}`;

    const pi = await stripeCall(key, "POST", "payment_intents", {
      amount: String(remainingCents),
      currency: "usd",
      customer: customerId,
      payment_method: pmId,
      off_session: "true",
      confirm: "true",
      description: `${bookingRef} — Remaining balance`,
      "metadata[bookingId]": bookingId,
      "metadata[chargeType]": "balance_remaining",
    }, `remaining-${bookingId}-${remainingCents}`);

    const piId = String(pi.id || "");
    const already = Number(booking.balance_amount_cents || 0);
    const { error: updErr } = await supabase
      .from("bookings")
      .update({
        customer_id: customerId,
        balance_amount_cents: already + remainingCents,
        team_notes: [
          booking.team_notes || "",
          `Remaining $${(remainingCents / 100).toFixed(2)} charged off-session ${piId} (${new Date().toISOString().slice(0, 10)}).`,
        ].filter(Boolean).join("\n"),
      })
      .eq("id", bookingId);
    if (updErr) {
      return NextResponse.json({
        error: `Charged ${piId} but the booking row did not update: ${updErr.message}`,
        paymentIntentId: piId,
        chargedCents: remainingCents,
      }, { status: 500 });
    }

    await supabase.from("events").insert({
      event_type: "booking.balance_charged",
      booking_id: bookingId,
      source: "admin",
      summary: `Remaining $${(remainingCents / 100).toFixed(2)} charged to the card on file`,
      data: { paymentIntentId: piId, amountCents: remainingCents },
    }).then(() => undefined, () => undefined);

    return NextResponse.json({
      ok: true,
      remainingCents: 0,
      chargedCents: remainingCents,
      paymentIntentId: piId,
      message: `Charged $${(remainingCents / 100).toFixed(2)} remaining.`,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

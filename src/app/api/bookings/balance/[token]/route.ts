// ─── /api/bookings/balance/[token] ───────────────────────────────────────────
//
// Backend for the public final-balance page (/pay-balance/<token>).
//
// The deposit page (/pay/<token>) takes money BEFORE the clean, against an
// estimate. This is the other end: the clean has happened, the number may have
// moved — add-ons performed on site, a scope adjustment — and the customer is
// being asked for the rest. So the page leads with WHAT WAS DONE and shows how
// the final figure was reached, then asks for payment. Nobody should be asked
// to pay a number they can't reconstruct.
//
//   GET  → completed-work summary + itemised money breakdown + paid state
//   POST → PaymentIntent for the outstanding balance
//
// The unguessable token IS the credential (same model as the deposit page and
// the photo gallery), it is scoped to one booking, and the response only ever
// contains that booking's own details.
//
// Implemented as a Next route rather than an edge function on purpose: Stripe
// is called over REST with the secret from app_secrets, and this ships on the
// normal web deploy.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { ADD_ONS, type AddOnId } from "@/lib/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOOKING_COLS =
  "id, booking_number, status, first_name, last_name, email, phone, address, city, state, zip_code, " +
  "service_type, home_size_id, service_date, time_slot, add_ons, " +
  "total_estimate_cents, final_charge_cents, deposit_cents, payment_received_at, " +
  "balance_payment_intent_id, balance_amount_cents, customer_id, job_id, " +
  "before_photos, after_photos, completed_at";

interface BookingRow {
  id: string;
  booking_number: number | null;
  status: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  service_type: string | null;
  service_date: string | null;
  time_slot: string | null;
  add_ons: string[] | null;
  total_estimate_cents: number | null;
  final_charge_cents: number | null;
  deposit_cents: number | null;
  payment_received_at: string | null;
  balance_payment_intent_id: string | null;
  balance_amount_cents: number | null;
  customer_id: string | null;
  job_id: string | null;
  before_photos: string[] | null;
  after_photos: string[] | null;
  completed_at: string | null;
}

async function stripeSecret(): Promise<string> {
  const supabase = getAdminSupabase();
  const { data } = await supabase
    .from("app_secrets")
    .select("value")
    .eq("key", "STRIPE_SECRET_KEY")
    .maybeSingle();
  return ((data?.value as string) || process.env.STRIPE_SECRET_KEY || "").trim();
}

async function stripeCall(
  path: string,
  key: string,
  params?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      ...(params ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(params ? { body: new URLSearchParams(params).toString() } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = data?.error as { message?: string } | undefined;
    throw new Error(err?.message || `Stripe ${res.status}`);
  }
  return data;
}

async function loadBooking(token: string): Promise<BookingRow | null> {
  // Length floor mirrors the deposit page: a short token is a typo or a probe,
  // not a link we ever issued.
  if (!token || token.length < 16) return null;
  const supabase = getAdminSupabase();
  const { data } = await (supabase.from as never as (t: string) => {
    select: (c: string) => {
      eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: BookingRow | null }> };
    };
  })("bookings")
    .select(BOOKING_COLS)
    .eq("balance_pay_token", token)
    .maybeSingle();
  return data || null;
}

interface LineItem {
  label: string;
  amountCents: number | null;
  note?: string;
  kind: "service" | "addon" | "adjustment" | "credit";
}

/**
 * Rebuild the final figure as a list a human can check line by line.
 *
 * The base service line is derived by subtraction rather than recomputed from
 * the pricing engine: what the customer owes is whatever the booking actually
 * says, and a second opinion from the calculator would only introduce a number
 * that disagrees with their invoice.
 */
async function buildBreakdown(booking: BookingRow) {
  const supabase = getAdminSupabase();

  const [{ data: addonRequests }, { data: adjustments }, { data: checklist }] =
    await Promise.all([
      supabase
        .from("job_addon_requests")
        .select("addon_id, addon_label, amount_cents, status, created_at")
        .eq("booking_id", booking.id)
        .eq("status", "approved"),
      supabase
        .from("scope_adjustments")
        .select("reason_codes, delta_cents, customer_message, applied_at, status")
        .eq("booking_id", booking.id)
        .order("applied_at", { ascending: true }),
      booking.job_id
        ? supabase
          .from("job_checklists")
          .select("completed_items, total_items, progress_pct, completed_at")
          .eq("job_id", booking.job_id)
          .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const items: LineItem[] = [];

  // Add-ons chosen when the booking was made.
  const bookedAddons = (booking.add_ons || []).filter(Boolean);
  const bookedAddonCents = bookedAddons.reduce((sum, id) => {
    const entry = ADD_ONS[id as AddOnId];
    return sum + (entry ? entry.price * 100 : 0);
  }, 0);

  // Add-ons the crew actually performed on site and an admin approved.
  const performed = (addonRequests || []) as {
    addon_id: string;
    addon_label: string | null;
    amount_cents: number | null;
  }[];
  const performedCents = performed.reduce((s, r) => s + (Number(r.amount_cents) || 0), 0);

  const adjustmentRows = ((adjustments || []) as {
    reason_codes: string[] | null;
    delta_cents: number | null;
    customer_message: string | null;
    status: string | null;
  }[]).filter((a) => a.status !== "reversed");
  const adjustmentCents = adjustmentRows.reduce((s, a) => s + (Number(a.delta_cents) || 0), 0);

  const finalTotal = Number(
    booking.final_charge_cents ?? booking.total_estimate_cents ?? 0,
  );

  // Everything the final total is NOT explained by the extras is the base
  // service. Never negative — a mis-set final_charge would otherwise render as
  // a nonsense negative line.
  const baseCents = Math.max(0, finalTotal - bookedAddonCents - performedCents - adjustmentCents);

  items.push({
    kind: "service",
    label: serviceLabel(booking.service_type),
    amountCents: baseCents,
  });

  for (const id of bookedAddons) {
    const entry = ADD_ONS[id as AddOnId];
    items.push({
      kind: "addon",
      label: entry?.label || id,
      amountCents: entry ? entry.price * 100 : null,
      note: "Added when you booked",
    });
  }

  for (const r of performed) {
    items.push({
      kind: "addon",
      label: r.addon_label || r.addon_id,
      amountCents: Number(r.amount_cents) || 0,
      note: "Performed on site",
    });
  }

  for (const a of adjustmentRows) {
    items.push({
      kind: "adjustment",
      label: "Scope adjustment",
      amountCents: Number(a.delta_cents) || 0,
      note: a.customer_message || (a.reason_codes || []).join(", ") || undefined,
    });
  }

  const depositPaidCents = booking.payment_received_at
    ? Number(booking.deposit_cents || 0)
    : 0;

  const cl = checklist as
    | { completed_items: number; total_items: number; progress_pct: number }
    | null;

  return {
    items,
    finalTotalCents: finalTotal,
    depositPaidCents,
    balanceDueCents: Math.max(0, finalTotal - depositPaidCents),
    checklist: cl
      ? {
        completedItems: cl.completed_items,
        totalItems: cl.total_items,
        progressPct: cl.progress_pct,
      }
      : null,
    beforePhotos: (booking.before_photos || []).filter((u) => u?.startsWith("http")).length,
    afterPhotos: (booking.after_photos || []).filter((u) => u?.startsWith("http")).length,
  };
}

function serviceLabel(serviceType: string | null): string {
  switch (serviceType) {
    case "deep":
      return "Deep Clean";
    case "moveInOut":
      return "Move-In / Move-Out Clean";
    case "combo":
      return "Deep + Standard Combo";
    case "standard":
      return "Standard Clean";
    default:
      return (serviceType || "Cleaning").replaceAll("_", " ");
  }
}

/**
 * Has the balance already been settled?
 *
 * Asked of Stripe directly rather than trusting a flag on our own row. The
 * webhook that would normally stamp payment is a separate moving part; a
 * customer reloading this page must never be shown a "pay now" button for
 * money they have already sent.
 */
async function balanceSettled(
  booking: BookingRow,
  key: string,
): Promise<{ paid: boolean; paidAmountCents: number | null }> {
  if (!booking.balance_payment_intent_id || !key) {
    return { paid: false, paidAmountCents: null };
  }
  try {
    const pi = await stripeCall(
      `payment_intents/${booking.balance_payment_intent_id}`,
      key,
    );
    const status = String(pi.status || "");
    if (status === "succeeded") {
      return { paid: true, paidAmountCents: Number(pi.amount_received) || null };
    }
  } catch {
    // A Stripe hiccup must not present as "unpaid" nor block the page; fall
    // through to the stored amount, which is only set once a charge landed.
    if (booking.balance_amount_cents) {
      return { paid: true, paidAmountCents: booking.balance_amount_cents };
    }
  }
  return { paid: false, paidAmountCents: null };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  const booking = await loadBooking(token);
  if (!booking) {
    return NextResponse.json(
      { error: "This payment link isn't valid. If you think it should be, reply to our text." },
      { status: 404 },
    );
  }
  if (String(booking.status || "").toLowerCase() === "cancelled") {
    return NextResponse.json({ error: "This booking was cancelled." }, { status: 410 });
  }

  const key = await stripeSecret();
  const [breakdown, settled] = await Promise.all([
    buildBreakdown(booking),
    balanceSettled(booking, key),
  ]);

  return NextResponse.json({
    ok: true,
    booking: {
      id: booking.id,
      ref: booking.booking_number
        ? `NVC-${String(booking.booking_number).padStart(4, "0")}`
        : `BK-${booking.id.slice(0, 8)}`,
      firstName: booking.first_name || "",
      email: booking.email || "",
      serviceType: booking.service_type,
      serviceLabel: serviceLabel(booking.service_type),
      serviceDate: booking.service_date,
      timeSlot: booking.time_slot,
      address: booking.address,
      city: booking.city,
      state: booking.state,
      completedAt: booking.completed_at,
      status: booking.status,
    },
    ...breakdown,
    paid: settled.paid,
    paidAmountCents: settled.paidAmountCents,
  });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  const booking = await loadBooking(token);
  if (!booking) {
    return NextResponse.json({ error: "This payment link isn't valid." }, { status: 404 });
  }
  if (String(booking.status || "").toLowerCase() === "cancelled") {
    return NextResponse.json({ error: "This booking was cancelled." }, { status: 410 });
  }

  const key = await stripeSecret();
  if (!key) {
    return NextResponse.json({ error: "Payments are not configured." }, { status: 500 });
  }

  const settled = await balanceSettled(booking, key);
  if (settled.paid) {
    return NextResponse.json({ ok: true, paid: true });
  }

  const breakdown = await buildBreakdown(booking);
  const amount = breakdown.balanceDueCents;
  if (amount <= 0) {
    return NextResponse.json({ ok: true, paid: true, nothingDue: true });
  }

  const supabase = getAdminSupabase();

  try {
    // Reuse the open intent when the amount hasn't moved, so a customer who
    // reloads mid-payment doesn't strand a second authorisation on their card.
    if (booking.balance_payment_intent_id) {
      const existing = await stripeCall(
        `payment_intents/${booking.balance_payment_intent_id}`,
        key,
      ).catch(() => null);
      const status = String(existing?.status || "");
      const reusable = ["requires_payment_method", "requires_confirmation", "requires_action"];
      if (existing && reusable.includes(status) && Number(existing.amount) === amount) {
        return NextResponse.json({
          ok: true,
          clientSecret: existing.client_secret,
          amountCents: amount,
        });
      }
    }

    const pi = await stripeCall("payment_intents", key, {
      amount: String(amount),
      currency: "usd",
      "automatic_payment_methods[enabled]": "true",
      description: `Final balance — ${
        booking.booking_number ? `NVC-${String(booking.booking_number).padStart(4, "0")}` : booking.id.slice(0, 8)
      }`,
      "metadata[booking_id]": booking.id,
      "metadata[purpose]": "final_balance",
      "metadata[source]": "balance_pay_page",
      ...(booking.email ? { receipt_email: booking.email } : {}),
    });

    await supabase
      .from("bookings")
      .update({ balance_payment_intent_id: pi.id as string })
      .eq("id", booking.id);

    return NextResponse.json({
      ok: true,
      clientSecret: pi.client_secret,
      amountCents: amount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[balance-pay] intent failed", message);
    return NextResponse.json(
      { error: "We couldn't start the payment just now. Please try again in a moment." },
      { status: 502 },
    );
  }
}

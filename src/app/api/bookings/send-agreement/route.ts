// ─── POST /api/bookings/send-agreement?secret=... ─────────────────────────────
//
// Auto-sends the one-time Service Agreement (DocuSeal) to a customer when their
// booking is confirmed. Fired by a DB trigger (pg_net) on the confirm
// transition. Secret-gated (BOOKING_AGREEMENT_SECRET in app_secrets) since the
// caller is the database. Idempotent: skips if an agreement was already sent for
// this booking.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { sendAgreement, buildOneTimeValues } from "@/lib/docuseal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function POST(req: Request): Promise<NextResponse> {
  const expected = await resolveSecret("BOOKING_AGREEMENT_SECRET");
  const provided = new URL(req.url).searchParams.get("secret") || req.headers.get("x-booking-secret") || "";
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { bookingId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const bookingId = body.bookingId;
  if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });

  try {
    const supabase = getAdminSupabase();
    const { data: booking } = await supabase
      .from("bookings")
      .select(
        "id, email, first_name, last_name, status, phone, address, city, state, zip_code, service_date, service_type, total_estimate_cents, deposit_cents, full_payment_discount, payment_option",
      )
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    if (!booking.email) return NextResponse.json({ ok: true, skipped: "no email" });

    // Idempotent: only one agreement per booking.
    const { data: existing } = await supabase
      .from("docuseal_submissions")
      .select("id")
      .eq("booking_id", bookingId)
      .limit(1);
    if (existing && existing.length > 0) {
      return NextResponse.json({ ok: true, alreadySent: true });
    }

    const name = `${booking.first_name || ""} ${booking.last_name || ""}`.trim() || undefined;

    // Pre-fill the Client-role fields so the customer just reviews + signs.
    const totalCents = Number(booking.total_estimate_cents || 0);
    const depositCents = Number(booking.deposit_cents || 0);
    const fullDiscount = Number(booking.full_payment_discount || 0);
    const balanceCents = booking.payment_option === "full"
      ? Math.max(0, totalCents - fullDiscount)
      : Math.max(0, totalCents - depositCents);
    const addressLine = [booking.address, booking.city, [booking.state, booking.zip_code].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ");

    const values = buildOneTimeValues({
      name,
      email: String(booking.email),
      phone: booking.phone || undefined,
      serviceDate: booking.service_date || undefined,
      address: addressLine || undefined,
      totalCents,
      depositCents,
      balanceCents,
    });

    const result = await sendAgreement({
      audience: "one_time",
      email: String(booking.email),
      name,
      values,
      bookingId,
      createdBy: "auto:booking-confirm",
      metadata: { source: "booking-confirm" },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[bookings/send-agreement]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

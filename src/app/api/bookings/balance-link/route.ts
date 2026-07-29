// ─── /api/bookings/balance-link ──────────────────────────────────────────────
//
// Mint (or re-mint) the tokenized final-balance link for a booking and,
// optionally, text it to the customer.
//
// The final figure is only knowable AFTER the clean — add-ons performed on
// site, a scope adjustment — so this is an admin action taken at the end of the
// job rather than a payment option chosen at booking time.
//
// Idempotent: re-issuing returns the SAME token unless `rotate` is set, so
// texting the link twice doesn't invalidate the copy the customer already has.
//
// Admin/VA only.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_BASE = "https://try.novaracleaning.com";

function mintToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(req);
  } catch (e) {
    const err = e as AdminAuthError;
    return NextResponse.json({ error: err.message }, { status: err.status || 401 });
  }

  let body: { bookingId?: string; rotate?: boolean; sendSms?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const bookingId = String(body.bookingId || "").trim();
  if (!bookingId) {
    return NextResponse.json({ error: "bookingId is required." }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const { data: booking, error } = await (supabase.from as never as (t: string) => {
    select: (c: string) => {
      eq: (k: string, v: string) => {
        maybeSingle: () => Promise<{
          data: {
            id: string;
            booking_number: number | null;
            status: string | null;
            first_name: string | null;
            phone: string | null;
            balance_pay_token: string | null;
          } | null;
          error: { message: string } | null;
        }>;
      };
    };
  })("bookings")
    .select("id, booking_number, status, first_name, phone, balance_pay_token")
    .eq("id", bookingId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!booking) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  if (String(booking.status || "").toLowerCase() === "cancelled") {
    return NextResponse.json(
      { error: "This booking is cancelled — no balance to collect." },
      { status: 409 },
    );
  }

  const token = !booking.balance_pay_token || body.rotate
    ? mintToken()
    : booking.balance_pay_token;

  if (token !== booking.balance_pay_token) {
    const { error: upErr } = await supabase
      .from("bookings")
      .update({
        balance_pay_token: token,
        balance_pay_token_created_at: new Date().toISOString(),
      })
      .eq("id", bookingId);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const url = `${PUBLIC_BASE}/pay-balance/${token}`;

  // Texting is best effort. The link is already minted and valid, so a transport
  // failure must still hand the admin something they can paste themselves.
  let smsSent = false;
  let smsError: string | null = null;
  if (body.sendSms && booking.phone) {
    try {
      const res = await fetch(
        `${process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-ghl-sms`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            phone: booking.phone,
            firstName: booking.first_name || undefined,
            type: "final_balance",
            message:
              `Hi ${booking.first_name || "there"}! Your Novara clean is complete. ` +
              `Here's a full breakdown of the work and your remaining balance: ${url}`,
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      smsSent = res.ok && !data?.error;
      if (!smsSent) smsError = data?.error || `SMS failed (${res.status})`;
    } catch (e) {
      smsError = e instanceof Error ? e.message : String(e);
    }
  } else if (body.sendSms) {
    smsError = "No phone number on file.";
  }

  await supabase
    .from("events")
    .insert({
      event_type: "booking.balance_link_issued",
      booking_id: bookingId,
      source: "admin",
      summary:
        `Final-balance link issued for ${
          booking.booking_number ? `NVC-${String(booking.booking_number).padStart(4, "0")}` : bookingId.slice(0, 8)
        }` + (body.sendSms ? ` (SMS: ${smsSent ? "sent" : `failed — ${smsError}`})` : ""),
      data: { rotated: token !== booking.balance_pay_token, sms_sent: smsSent },
    })
    .then(() => undefined, () => undefined);

  return NextResponse.json({ ok: true, url, token, smsSent, smsError });
}

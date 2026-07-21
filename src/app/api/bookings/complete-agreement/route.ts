// ─── POST /api/bookings/complete-agreement ────────────────────────────────────
//
// Records a COMPLETED one-time Service Agreement in DocuSeal for a pay-page
// booking AFTER the customer signs on try.novaracleaning.com/pay/<token>.
//
// Pay-page/VA bookings sign in-browser (SignaturePad → pdf-lib → Supabase +
// Drive) and are intentionally excluded from the confirm-time DocuSeal auto-
// send (that fired before the customer completed the legal step). This route
// closes that gap: once the customer has signed, we mirror the executed
// agreement into DocuSeal so it lives alongside every other signed agreement.
//
// Auth: the caller presents the booking's pay_page_token — the same token that
// already gates the pay page and is the customer's credential. No shared
// secret, so the pay page client can call it directly. Idempotent: the unique
// index on docuseal_submissions(booking_id) makes the send exactly-once.
//
// Body: { token: string, signatureImage?: string /* data:image/png;base64 */ }

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { sendAgreement, buildOneTimeValues } from "@/lib/docuseal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  let body: { token?: string; signatureImage?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const token = String(body.token || "").trim();
  const signatureImage =
    typeof body.signatureImage === "string" &&
    /^data:image\/(png|jpe?g);base64,/.test(body.signatureImage)
      ? body.signatureImage
      : undefined;
  if (!token || token.length < 16) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }

  try {
    const supabase = getAdminSupabase();

    // Resolve the booking from its pay-page token (the caller's credential).
    const { data: booking } = await supabase
      .from("bookings")
      .select(
        "id, email, first_name, last_name, status, phone, address, city, state, zip_code, service_date, service_type, total_estimate_cents, deposit_cents, full_payment_discount, payment_option, pay_page_token",
      )
      .eq("pay_page_token", token)
      .maybeSingle();
    if (!booking) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (!booking.email) return NextResponse.json({ ok: true, skipped: "no email" });

    // Gate: only mirror to DocuSeal once the customer has actually signed on
    // the pay page (a service_agreements row with source='pay_page' and all
    // acceptance flags). Mirrors the server-side gate the pay page enforces
    // before payment — no signature, no DocuSeal record.
    const { data: signed } = await supabase
      .from("service_agreements")
      .select("id, signed_by, customer_name")
      .eq("booking_id", booking.id)
      .eq("source", "pay_page")
      .eq("agreed_terms", true)
      .eq("agreed_disclaimer", true)
      .eq("agreed_service_agreement", true)
      .order("created_at", { ascending: false })
      .limit(1);
    if (!Array.isArray(signed) || signed.length === 0) {
      return NextResponse.json({ ok: true, skipped: "agreement_not_signed" });
    }

    // CLAIM atomically (unique index on booking_id). If a row already exists,
    // the agreement was already mirrored (or is in flight) — treat as done.
    const { data: claim, error: claimErr } = await supabase
      .from("docuseal_submissions")
      .insert({
        booking_id: booking.id,
        audience: "one_time",
        submitter_email: String(booking.email),
        role: "Client",
        status: "sending",
        created_by: "pay_page:signed",
      })
      .select("id")
      .single();
    if (claimErr || !claim) {
      return NextResponse.json({ ok: true, alreadySent: true });
    }

    const name =
      `${booking.first_name || ""} ${booking.last_name || ""}`.trim() ||
      signed[0].signed_by ||
      signed[0].customer_name ||
      undefined;

    const totalCents = Number(booking.total_estimate_cents || 0);
    const depositCents = Number(booking.deposit_cents || 0);
    const fullDiscount = Number(booking.full_payment_discount || 0);
    const balanceCents =
      booking.payment_option === "full"
        ? Math.max(0, totalCents - fullDiscount)
        : Math.max(0, totalCents - depositCents);
    const addressLine = [
      booking.address,
      booking.city,
      [booking.state, booking.zip_code].filter(Boolean).join(" "),
    ]
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

    try {
      const result = await sendAgreement({
        audience: "one_time",
        email: String(booking.email),
        name,
        values,
        signatureImage,
        // Don't email the customer a second copy — they already got their
        // signed PDF flow on the pay page; this is a record mirror.
        sendEmail: false,
        bookingId: booking.id,
        createdBy: "pay_page:signed",
        metadata: { source: "pay_page_signed" },
        skipTracking: true, // we own the claim row
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
      return NextResponse.json({ ok: true, ...result });
    } catch (sendErr) {
      // Release the claim so a later retry (payment success) can try again.
      await supabase.from("docuseal_submissions").delete().eq("id", claim.id);
      throw sendErr;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[bookings/complete-agreement]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

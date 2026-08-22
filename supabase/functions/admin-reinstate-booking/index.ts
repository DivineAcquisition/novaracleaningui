import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";
import Stripe from "https://esm.sh/stripe@18.5.0";

// Standalone reinstate for unpaid-deposit auto-cancels. Kept self-contained
// so it can be deployed without bundling admin-modify-booking's checklist
// graph. The Bookings tab calls this when the customer asked to keep the date.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPPORT = "(844) 735-2070";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

async function resolveSecret(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  name: string,
): Promise<string> {
  try {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", name).maybeSingle();
    if (data?.value && typeof data.value === "string" && data.value.trim()) return data.value.trim();
  } catch {
    /* env fallback */
  }
  return (Deno.env.get(name) || "").trim();
}

function formatServiceDate(dateStr?: string | null): string {
  if (!dateStr) return "";
  try {
    return new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatTimeSlot(slot?: string | null): string {
  if (!slot) return "";
  const map: Record<string, string> = {
    "8-12": "8:00 AM – 12:00 PM",
    "12-16": "12:00 PM – 4:00 PM",
    "16-20": "4:00 PM – 8:00 PM",
  };
  return map[slot] || slot;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) throw new Error("Admin authorization required");
    const token = auth.replace(/^Bearer\s+/i, "");
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data: u } = await userClient.auth.getUser(token);
    if (!u?.user?.id) throw new Error("Not signed in");
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
    const allowed = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
    if (!allowed) throw new Error("Admins or VAs only");

    const body = await req.json();
    const bookingId = String(body.bookingId || "");
    if (!bookingId) throw new Error("bookingId is required");

    const { data: booking, error: bErr } = await admin.from("bookings").select("*").eq("id", bookingId).single();
    if (bErr || !booking) throw new Error("Booking not found");
    if (booking.status !== "cancelled") throw new Error("Only cancelled bookings can be reinstated.");
    if (booking.payment_received_at) {
      throw new Error("This booking already has a payment — reopen it as a new booking instead.");
    }
    const reason = String(booking.auto_cancelled_reason || booking.cancel_reason || "");
    const looksUnpaid =
      reason === "unpaid_deposit" ||
      /unpaid deposit/i.test(reason) ||
      Boolean(booking.hosted_invoice_url || booking.stripe_invoice_id);
    if (!looksUnpaid) throw new Error("This cancelled booking is not an unpaid-deposit auto-cancel.");

    const nowIso = new Date().toISOString();
    const noteLine = `Reinstated after unpaid-deposit auto-cancel ${nowIso.slice(0, 10)} (customer requested).`;
    const prevNotes = String(booking.team_notes || "").trim();
    const payUrl = await reissueDepositInvoice(admin, booking);

    const { error: upErr } = await admin
      .from("bookings")
      .update({
        status: "pending_payment",
        cancel_reason: null,
        cancelled_at: null,
        auto_cancelled_reason: null,
        cancel_fee_cents: 0,
        pending_deposit_started_at: nowIso,
        hosted_invoice_url: payUrl || booking.hosted_invoice_url || null,
        updated_at: nowIso,
        team_notes: prevNotes ? `${prevNotes}\n${noteLine}` : noteLine,
      })
      .eq("id", bookingId)
      .eq("status", "cancelled");
    if (upErr) throw new Error(`Reinstate failed: ${errMessage(upErr)}`);

    await admin
      .from("booking_emails_sent")
      .delete()
      .eq("booking_id", bookingId)
      .in("kind", [
        "pending_deposit_reminder_30m",
        "pending_deposit_reminder_2h",
        "pending_deposit_reminder_next_day_2h",
        "pending_deposit_auto_cancelled",
      ]);

    const money = `$${((Number(booking.deposit_cents) || 0) / 100).toFixed(2)}`;
    const when = [
      booking.service_date ? formatServiceDate(booking.service_date) : null,
      booking.time_slot ? formatTimeSlot(booking.time_slot) : null,
    ].filter(Boolean).join(" · ");
    const link = payUrl || booking.hosted_invoice_url;

    if (booking.phone && link) {
      try {
        await admin.functions.invoke("send-ghl-sms", {
          body: {
            phone: booking.phone,
            message:
              `Novara Cleaning: Your cleaning${when ? ` (${when})` : ""} is reopened and pending the ${money} deposit.` +
              ` Pay here: ${link}` +
              ` Call ${SUPPORT} with questions.`,
            type: "confirmation",
          },
        });
      } catch {
        /* non-blocking */
      }
    }

    const resendKey = await resolveSecret(admin, "RESEND_API_KEY");
    if (booking.email && link && resendKey) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Novara Cleaning <hello@novaracleaning.com>",
          to: [booking.email],
          subject: "Your Novara cleaning is reopened — deposit needed",
          html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#0f172a;line-height:1.55;max-width:560px">
            <p>Hi ${booking.first_name || "there"},</p>
            <p>We reopened your cleaning${when ? ` on <strong>${when}</strong>` : ""}. It stays pending until we receive the ${money} deposit.</p>
            <p style="margin:20px 0"><a href="${link}" style="display:inline-block;background:#5C0FFE;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:600">Pay deposit ${money}</a></p>
            <p style="font-size:12px;color:#94a3b8">Questions? Call ${SUPPORT}</p>
          </div>`,
        }),
      });
    }

    try {
      await admin.from("events").insert({
        event_type: "booking.reinstated_unpaid_deposit",
        source: "admin-reinstate-booking",
        summary: `Reinstated unpaid-deposit booking ${booking.booking_number || bookingId}`,
        data: { booking_id: bookingId, by: u.user.id, pay_url: payUrl },
      });
    } catch {
      /* non-blocking */
    }

    return json({ success: true, bookingId, status: "pending_payment", payUrl });
  } catch (error) {
    return json({ success: false, error: errMessage(error) }, 400);
  }
});

async function reissueDepositInvoice(
  // deno-lint-ignore no-explicit-any
  admin: any,
  booking: Record<string, unknown>,
): Promise<string | null> {
  const existingUrl = typeof booking.hosted_invoice_url === "string" ? booking.hosted_invoice_url : null;
  const existingId = typeof booking.stripe_invoice_id === "string" ? booking.stripe_invoice_id : null;
  const amount = Number(booking.deposit_cents || 0);
  if (amount <= 0) return existingUrl;
  const key = await resolveSecret(admin, "STRIPE_SECRET_KEY");
  if (!key) return existingUrl;
  const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" as never });

  if (existingId) {
    try {
      const inv = await stripe.invoices.retrieve(existingId);
      if (inv.status === "open" && inv.hosted_invoice_url) {
        await stripe.invoices.sendInvoice(existingId).catch(() => undefined);
        return inv.hosted_invoice_url;
      }
    } catch {
      /* create a replacement */
    }
  }

  const email = String(booking.email || "").trim();
  if (!email) return existingUrl;
  let customerId =
    typeof booking.customer_id === "string" && booking.customer_id.startsWith("cus_")
      ? booking.customer_id
      : "";
  if (!customerId) {
    const found = await stripe.customers.list({ email, limit: 1 });
    customerId = found.data[0]?.id || "";
  }
  if (!customerId) {
    const created = await stripe.customers.create({
      email,
      name: `${booking.first_name || ""} ${booking.last_name || ""}`.trim() || undefined,
      phone: String(booking.phone || "") || undefined,
    });
    customerId = created.id;
  }

  const description = `Novara deposit — booking ${booking.booking_number || booking.id}`;
  const item = await stripe.invoiceItems.create({ customer: customerId, amount, currency: "usd", description });
  try {
    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: "send_invoice",
      days_until_due: 1,
      pending_invoice_items_behavior: "include",
      description,
      metadata: { booking_id: String(booking.id), purpose: "deposit", reinstated: "true" },
      auto_advance: true,
      payment_settings: { payment_method_types: ["card"] },
    });
    if (!invoice.id) throw new Error("Stripe did not return invoice id");
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id, { auto_advance: true });
    await stripe.invoices.sendInvoice(invoice.id);
    await admin
      .from("bookings")
      .update({ stripe_invoice_id: invoice.id, hosted_invoice_url: finalized.hosted_invoice_url || existingUrl })
      .eq("id", booking.id);
    return finalized.hosted_invoice_url || existingUrl;
  } catch (err) {
    if (item.id) await stripe.invoiceItems.del(item.id).catch(() => undefined);
    console.warn("[admin-reinstate-booking] reissue invoice failed", err instanceof Error ? err.message : String(err));
    return existingUrl;
  }
}

// ─── adjust-booking-invoice ─────────────────────────────────────────────────
//
// Admin/ops: bump booking total (e.g. partial deep upgrade) and sync Stripe
// remaining-balance invoice by adding a line item (deep cleaning add-on).
//
// Body:
//   bookingId (required)
//   totalCents (required) — new job total
//   addonLabel? — line item description (default: Deep cleaning add-on)
//   addonCents? — override add-on amount (default: newTotal - previousTotal)
//   serviceType? — optional booking.service_type patch
//   addOns? — optional string[] for bookings.add_ons
//   teamNotes? — appended to team_notes

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { resolveSecret } from "../_shared/app-secrets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (step: string, details?: unknown) => {
  console.log(`[ADJUST-BOOKING-INVOICE] ${step}${details ? ` ${JSON.stringify(details)}` : ""}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const bookingId = String(body.bookingId || "");
    const totalCents = Number(body.totalCents);
    const addonLabel = String(body.addonLabel || "Deep cleaning add-on (partial deep upgrade)");
    const serviceType = body.serviceType ? String(body.serviceType) : null;
    const addOns = Array.isArray(body.addOns) ? body.addOns.map(String) : null;
    const teamNotesAppend = body.teamNotes ? String(body.teamNotes) : null;

    if (!bookingId || !Number.isFinite(totalCents) || totalCents <= 0) {
      return new Response(JSON.stringify({ error: "bookingId and totalCents required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: booking, error: fetchErr } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();

    if (fetchErr || !booking) {
      return new Response(JSON.stringify({ error: "Booking not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const previousTotal = Number(booking.total_estimate_cents || 0);
    const depositCents = Number(booking.deposit_cents || 0);
    const addonCents = Number.isFinite(Number(body.addonCents))
      ? Number(body.addonCents)
      : Math.max(0, totalCents - previousTotal);
    const remainingCents = Math.max(0, totalCents - depositCents);

    const bookingRef = booking.booking_number
      ? `NVC-${String(booking.booking_number).padStart(4, "0")}`
      : `BK-${bookingId.slice(0, 8)}`;

    const stripeKey = await resolveSecret(supabase, "STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    let stripeCustomerId: string | null = null;
    if (booking.customer_id && String(booking.customer_id).startsWith("cus_")) {
      stripeCustomerId = booking.customer_id;
    } else {
      const found = await stripe.customers.list({ email: booking.email, limit: 1 });
      stripeCustomerId = found.data[0]?.id ?? null;
    }
    if (!stripeCustomerId) throw new Error("Stripe customer not found");

    const existingInvoiceId = booking.stripe_invoice_id as string | null;
    let invoiceId = existingInvoiceId;
    let hostedInvoiceUrl = booking.hosted_invoice_url as string | null;
    let invoiceAction = "none";

    if (existingInvoiceId) {
      let status: string;
      try {
        const inv = await stripe.invoices.retrieve(existingInvoiceId);
        status = inv.status ?? "unknown";
      } catch (retrieveErr) {
        log("stale_or_missing_invoice", {
          existingInvoiceId,
          message: retrieveErr instanceof Error ? retrieveErr.message : String(retrieveErr),
        });
        status = "missing";
      }

      if (status === "draft" || status === "open") {
        if (addonCents > 0) {
          await stripe.invoiceItems.create({
            customer: stripeCustomerId,
            invoice: existingInvoiceId,
            amount: addonCents,
            currency: "usd",
            description: `${bookingRef} — ${addonLabel}`,
            metadata: {
              booking_id: bookingId,
              purpose: "deep_cleaning_addon",
            },
          });
          invoiceAction = "line_item_added";
        }

        if (status === "draft") {
          const finalized = await stripe.invoices.finalizeInvoice(existingInvoiceId);
          hostedInvoiceUrl = finalized.hosted_invoice_url ?? hostedInvoiceUrl;
          await stripe.invoices.sendInvoice(existingInvoiceId);
          invoiceAction = "finalized_and_sent";
        } else {
          // open — Stripe recalculates totals when items are added
          const refreshed = await stripe.invoices.retrieve(existingInvoiceId);
          hostedInvoiceUrl = refreshed.hosted_invoice_url ?? hostedInvoiceUrl;
          invoiceAction = "open_invoice_updated";
        }
      } else if (status === "paid") {
        // Already paid at old amount — issue supplemental invoice for the delta
        if (addonCents > 0) {
          await stripe.invoiceItems.create({
            customer: stripeCustomerId,
            amount: addonCents,
            currency: "usd",
            description: `${bookingRef} — ${addonLabel}`,
            metadata: { booking_id: bookingId, purpose: "deep_cleaning_addon" },
          });
          const supplemental = await stripe.invoices.create({
            customer: stripeCustomerId,
            collection_method: "send_invoice",
            days_until_due: 7,
            pending_invoice_items_behavior: "include",
            description: `${bookingRef} — Additional balance (partial deep clean)`,
            metadata: { booking_id: bookingId, purpose: "supplemental_balance" },
            auto_advance: true,
          });
          if (supplemental.id) {
            const fin = await stripe.invoices.finalizeInvoice(supplemental.id);
            await stripe.invoices.sendInvoice(supplemental.id);
            invoiceId = supplemental.id;
            hostedInvoiceUrl = fin.hosted_invoice_url ?? hostedInvoiceUrl;
            invoiceAction = "supplemental_invoice_created";
          }
        }
      } else {
        // void / uncollectible / missing — fresh invoice: base remaining + deep add-on
        const baseRemainingCents = Math.max(0, remainingCents - addonCents);
        if (baseRemainingCents > 0) {
          await stripe.invoiceItems.create({
            customer: stripeCustomerId,
            amount: baseRemainingCents,
            currency: "usd",
            description: `${bookingRef} — Remaining balance`,
            metadata: { booking_id: bookingId, purpose: "remaining_balance" },
          });
        }
        if (addonCents > 0) {
          await stripe.invoiceItems.create({
            customer: stripeCustomerId,
            amount: addonCents,
            currency: "usd",
            description: `${bookingRef} — ${addonLabel}`,
            metadata: { booking_id: bookingId, purpose: "deep_cleaning_addon" },
          });
        }
        const fresh = await stripe.invoices.create({
          customer: stripeCustomerId,
          collection_method: "send_invoice",
          days_until_due: 7,
          pending_invoice_items_behavior: "include",
          description: `${bookingRef} — Remaining balance (job total $${(totalCents / 100).toFixed(2)})`,
          metadata: { booking_id: bookingId, purpose: "remaining_balance_reissue" },
          auto_advance: true,
        });
        if (fresh.id) {
          const fin = await stripe.invoices.finalizeInvoice(fresh.id);
          await stripe.invoices.sendInvoice(fresh.id);
          invoiceId = fresh.id;
          hostedInvoiceUrl = fin.hosted_invoice_url ?? null;
          invoiceAction = status === "missing" ? "reissued_after_missing" : "new_invoice_created";
        }
      }
    } else if (remainingCents > 0) {
      const baseRemainingCents = Math.max(0, remainingCents - addonCents);
      if (baseRemainingCents > 0) {
        await stripe.invoiceItems.create({
          customer: stripeCustomerId,
          amount: baseRemainingCents,
          currency: "usd",
          description: `${bookingRef} — Remaining balance`,
          metadata: { booking_id: bookingId, purpose: "remaining_balance" },
        });
      }
      if (addonCents > 0) {
        await stripe.invoiceItems.create({
          customer: stripeCustomerId,
          amount: addonCents,
          currency: "usd",
          description: `${bookingRef} — ${addonLabel}`,
          metadata: { booking_id: bookingId, purpose: "deep_cleaning_addon" },
        });
      }
      const created = await stripe.invoices.create({
        customer: stripeCustomerId,
        collection_method: "send_invoice",
        days_until_due: 7,
        pending_invoice_items_behavior: "include",
        auto_advance: true,
        metadata: { booking_id: bookingId, purpose: "remaining_balance" },
      });
      if (created.id) {
        const fin = await stripe.invoices.finalizeInvoice(created.id);
        await stripe.invoices.sendInvoice(created.id);
        invoiceId = created.id;
        hostedInvoiceUrl = fin.hosted_invoice_url ?? null;
        invoiceAction = "invoice_created";
      }
    }

    const patch: Record<string, unknown> = {
      total_estimate_cents: totalCents,
      final_charge_cents: totalCents,
    };
    if (serviceType) patch.service_type = serviceType;
    if (addOns) patch.add_ons = addOns;
    if (invoiceId) patch.stripe_invoice_id = invoiceId;
    if (hostedInvoiceUrl) patch.hosted_invoice_url = hostedInvoiceUrl;
    if (teamNotesAppend) {
      const prev = (booking.team_notes as string | null) || "";
      patch.team_notes = prev
        ? `${prev}\n${teamNotesAppend}`
        : teamNotesAppend;
    }

    await supabase.from("bookings").update(patch).eq("id", bookingId);

    // Refresh GHL
    try {
      await supabase.functions.invoke("send-zapier-webhook", { body: { bookingId } });
    } catch (_) { /* non-blocking */ }

    const result = {
      success: true,
      bookingId,
      bookingRef,
      previousTotalCents: previousTotal,
      newTotalCents: totalCents,
      depositCents,
      remainingCents,
      addonCents,
      invoiceId,
      hostedInvoiceUrl,
      invoiceAction,
    };
    log("done", result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", { message });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

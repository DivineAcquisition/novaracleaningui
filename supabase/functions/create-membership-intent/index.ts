import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveSecret } from "../_shared/app-secrets.ts";
import { MEMBERSHIP_PRICES } from "../_shared/pricing.ts";
import { getEstimatedHours } from "../_shared/payout-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-expiry",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[CREATE-MEMBERSHIP-INTENT] ${step}${detailsStr}`);
};

const PLAN_LABELS: Record<string, string> = {
  monthly: "Glow Monthly",
  biweekly: "Glow Bi-Weekly",
  weekly: "Glow Weekly",
};

const DEEP_CLEAN_CENTS = 7500;

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

// deno-lint-ignore no-explicit-any
async function paymentIntentFromInvoice(stripe: Stripe, invoice: any): Promise<any | null> {
  let paymentIntent = invoice.payment_intent;
  if (typeof paymentIntent === "string") {
    try {
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntent);
    } catch {
      paymentIntent = null;
    }
  }
  if (paymentIntent && typeof paymentIntent === "object" && paymentIntent.client_secret) {
    return paymentIntent;
  }

  const nested = invoice.payments?.data;
  if (Array.isArray(nested)) {
    for (const row of nested) {
      let id = row?.payment?.payment_intent || row?.payment_intent;
      if (id && typeof id === "object" && id.client_secret) return id;
      if (typeof id === "string") {
        try {
          const retrieved = await stripe.paymentIntents.retrieve(id);
          if (retrieved?.client_secret) return retrieved;
        } catch { /* continue */ }
      }
    }
  }

  try {
    // Basil: PaymentIntents live on invoice payments, not invoice.payment_intent.
    // deno-lint-ignore no-explicit-any
    const listed = await (stripe.invoices as any).listPayments(invoice.id, { limit: 5 });
    for (const row of listed?.data || []) {
      let id = row?.payment?.payment_intent || row?.payment_intent;
      if (id && typeof id === "object" && id.client_secret) return id;
      if (typeof id === "string") {
        const retrieved = await stripe.paymentIntents.retrieve(id);
        if (retrieved?.client_secret) return retrieved;
      }
    }
  } catch (err) {
    logStep("listPayments fallback skipped", { error: err instanceof Error ? err.message : String(err) });
  }
  return null;
}

// deno-lint-ignore no-explicit-any
async function invoiceClientSecret(stripe: Stripe, subscription: Stripe.Subscription): Promise<{
  clientSecret: string;
  paymentIntentId: string;
  amount: number;
  invoiceId: string;
}> {
  const expanded = await stripe.subscriptions.retrieve(subscription.id, {
    expand: [
      "latest_invoice.confirmation_secret",
      "latest_invoice.payment_intent",
      "latest_invoice.payments",
    ],
  });
  // deno-lint-ignore no-explicit-any
  let invoice: any = expanded.latest_invoice;
  if (typeof invoice === "string") {
    invoice = await stripe.invoices.retrieve(invoice, {
      expand: ["confirmation_secret", "payment_intent", "payments"],
    });
  }
  if (!invoice || typeof invoice === "string") {
    throw new Error("Could not load the membership invoice.");
  }

  const confirmationSecret = invoice.confirmation_secret?.client_secret
    || invoice.confirmation_secret?.clientSecret;
  const paymentIntent = await paymentIntentFromInvoice(stripe, invoice);

  const clientSecret =
    (typeof confirmationSecret === "string" && confirmationSecret) ||
    (paymentIntent && typeof paymentIntent === "object" && paymentIntent.client_secret) ||
    "";
  const paymentIntentId =
    (paymentIntent && typeof paymentIntent === "object" && paymentIntent.id) ||
    (typeof invoice.payment_intent === "string" ? invoice.payment_intent : "") ||
    "";
  const amount = Number(invoice.amount_due || paymentIntent?.amount || 0);
  const invoiceId = typeof invoice.id === "string" ? invoice.id : "";

  if (!clientSecret) {
    throw new Error("Stripe did not return a payment secret for this membership invoice.");
  }
  return { clientSecret, paymentIntentId, amount, invoiceId };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const rawBody = await req.json();
    const bookingData = rawBody.bookingData || rawBody;
    const email = String(bookingData.email || bookingData.customerEmail || "").trim().toLowerCase();
    const homeSizeId = String(bookingData.homeSizeId || "");
    const membershipPlan = String(bookingData.membershipPlan || "").trim().toLowerCase();
    const wantsDeepClean = bookingData.includeDeepClean !== false;

    if (!email || !email.includes("@")) {
      return json({ error: "Email is required", code: "VALIDATION_ERROR" }, 400);
    }
    if (!homeSizeId) {
      return json({ error: "Home size is required", code: "VALIDATION_ERROR" }, 400);
    }
    if (!["monthly", "biweekly", "weekly"].includes(membershipPlan)) {
      return json({ error: "A Glow plan is required", code: "VALIDATION_ERROR" }, 400);
    }
    if (!bookingData.serviceDate || !bookingData.timeSlot) {
      return json({ error: "Please pick a first-clean date and time", code: "VALIDATION_ERROR" }, 400);
    }

    const prices = MEMBERSHIP_PRICES[homeSizeId];
    const monthlyDollars = prices?.[membershipPlan as keyof typeof prices];
    if (!monthlyDollars) {
      return json({ error: "Invalid home size for this membership", code: "INVALID_HOME_SIZE" }, 400);
    }
    const monthlyPriceCents = Math.round(Number(monthlyDollars) * 100);
    const amountDueCents = monthlyPriceCents + (wantsDeepClean ? DEEP_CLEAN_CENTS : 0);
    const planLabel = PLAN_LABELS[membershipPlan];

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const stripeKey = await resolveSecret(supabase, "STRIPE_SECRET_KEY");
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const existing = await stripe.customers.list({ email, limit: 1 });
    let customerId = existing.data[0]?.id;
    const name = `${bookingData.firstName || ""} ${bookingData.lastName || ""}`.trim();
    if (customerId) {
      await stripe.customers.update(customerId, {
        name: name || undefined,
        phone: bookingData.phone || undefined,
      });
    } else {
      const customer = await stripe.customers.create({
        email,
        name: name || undefined,
        phone: bookingData.phone || undefined,
      });
      customerId = customer.id;
    }

    const membershipProduct = await stripe.products.create({
      name: `Novara Membership — ${planLabel}`,
      description: `Recurring cleaning membership (${homeSizeId.replace("_", "-")} sq ft)`,
      metadata: { home_size_id: homeSizeId, membership_plan: membershipPlan, funnel: "book" },
    });
    const recurringPrice = await stripe.prices.create({
      product: membershipProduct.id,
      currency: "usd",
      unit_amount: monthlyPriceCents,
      recurring: { interval: "month" },
      nickname: `${planLabel} — $${(monthlyPriceCents / 100).toFixed(0)}/mo`,
    });

    // deno-lint-ignore no-explicit-any
    const addInvoiceItems: Array<{ price: string; quantity: number }> = [];
    if (wantsDeepClean) {
      const deepCleanPrice = await stripe.prices.create({
        product: membershipProduct.id,
        currency: "usd",
        unit_amount: DEEP_CLEAN_CENTS,
        nickname: "First Clean Deep Clean",
      });
      addInvoiceItems.push({ price: deepCleanPrice.id, quantity: 1 });
    }

    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    let preferredDayOfWeek = "";
    if (bookingData.serviceDate) {
      const d = new Date(`${bookingData.serviceDate}T12:00:00`);
      if (!Number.isNaN(d.getTime())) preferredDayOfWeek = days[d.getDay()];
    }

    const sharedMetadata: Record<string, string> = {
      membership_plan: membershipPlan,
      home_size_id: homeSizeId,
      is_membership_signup: "true",
      funnel: "book",
      monthly_price_cents: String(monthlyPriceCents),
      preferred_day_of_week: preferredDayOfWeek,
      preferred_time_window: String(bookingData.timeSlot || ""),
      first_service_date: String(bookingData.serviceDate || ""),
      first_time_slot: String(bookingData.timeSlot || ""),
      deep_clean_included: wantsDeepClean ? "true" : "false",
      deep_cleaned_before: String(bookingData.deepCleanedBefore || ""),
      first_name: String(bookingData.firstName || ""),
      last_name: String(bookingData.lastName || ""),
      phone: String(bookingData.phone || ""),
      address: String(bookingData.address || ""),
      city: String(bookingData.city || ""),
      state: String(bookingData.state || ""),
      zip_code: String(bookingData.zipCode || ""),
    };

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: recurringPrice.id }],
      ...(addInvoiceItems.length ? { add_invoice_items: addInvoiceItems } : {}),
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      metadata: sharedMetadata,
      description: `Novara ${planLabel} — public booking funnel`,
    });

    const { clientSecret, paymentIntentId, amount, invoiceId } = await invoiceClientSecret(stripe, subscription);
    const chargeCents = amount > 0 ? amount : amountDueCents;

    const resumeBytes = new Uint8Array(20);
    crypto.getRandomValues(resumeBytes);
    const checkoutResumeToken = Array.from(resumeBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

    const serviceType = wantsDeepClean ? "deep" : "standard";
    const tracking = bookingData.tracking || null;

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .insert({
        email,
        first_name: bookingData.firstName || "",
        last_name: bookingData.lastName || "",
        phone: bookingData.phone || "",
        address: bookingData.address || "",
        city: bookingData.city || "",
        state: bookingData.state || "",
        zip_code: bookingData.zipCode || "",
        home_size_id: homeSizeId,
        service_type: serviceType,
        offer_type: serviceType,
        add_ons: Array.isArray(bookingData.addOns) ? bookingData.addOns : [],
        service_date: bookingData.serviceDate,
        time_slot: bookingData.timeSlot,
        membership_plan: membershipPlan,
        uses_credit: true,
        base_price_cents: monthlyPriceCents,
        deposit_cents: chargeCents,
        total_estimate_cents: chargeCents,
        payment_intent_id: paymentIntentId || null,
        stripe_invoice_id: invoiceId || null,
        customer_id: customerId,
        status: "pending_payment",
        checkout_resume_token: checkoutResumeToken,
        payment_option: "full",
        booking_channel: "web",
        estimated_duration_hours: getEstimatedHours(homeSizeId),
        team_notes: `GLOW ${membershipPlan.toUpperCase()} — first month collected in-funnel${wantsDeepClean ? " (includes first-clean deep)" : ""}`,
        referral_code: bookingData.referralCode || null,
        tracking,
        utm_source: bookingData.utmSource || tracking?.utm_source || null,
        utm_medium: bookingData.utmMedium || tracking?.utm_medium || null,
        utm_campaign: bookingData.utmCampaign || tracking?.utm_campaign || null,
        utm_content: bookingData.utmContent || tracking?.utm_content || null,
        utm_term: bookingData.utmTerm || tracking?.utm_term || null,
        landing_page: bookingData.landingPage || tracking?.landing_page || null,
        referrer: bookingData.referrer || tracking?.referrer || null,
        fbclid: bookingData.fbclid || tracking?.fbclid || null,
        gclid: bookingData.gclid || tracking?.gclid || null,
        first_visit_at: bookingData.firstVisitTimestamp || tracking?.first_visit_timestamp || null,
      })
      .select("id, booking_number")
      .single();

    if (bookingError || !booking) {
      logStep("Booking insert failed", bookingError);
      throw bookingError || new Error("Could not create the membership booking.");
    }

    await stripe.subscriptions.update(subscription.id, {
      metadata: { ...sharedMetadata, existing_booking_id: booking.id },
    });
    if (invoiceId) {
      try {
        await stripe.invoices.update(invoiceId, {
          metadata: {
            booking_id: booking.id,
            funnel: "book",
            purpose: "membership_first",
            membership_plan: membershipPlan,
          },
        });
      } catch (invErr) {
        logStep("Invoice metadata update skipped", {
          error: invErr instanceof Error ? invErr.message : String(invErr),
        });
      }
    }
    if (paymentIntentId) {
      try {
        await stripe.paymentIntents.update(paymentIntentId, {
          metadata: {
            booking_id: booking.id,
            funnel: "book",
            purpose: "membership_first",
          },
        });
      } catch (piErr) {
        logStep("PaymentIntent metadata update skipped", {
          error: piErr instanceof Error ? piErr.message : String(piErr),
        });
      }
    }

    logStep("Membership intent created", {
      bookingId: booking.id,
      subscriptionId: subscription.id,
      amount: chargeCents,
      plan: membershipPlan,
    });

    return json({
      clientSecret,
      amount: chargeCents,
      bookingId: booking.id,
      subscriptionId: subscription.id,
      checkoutResumeToken,
      requiresPayment: true,
      bookingNumber: booking.booking_number,
    });
  } catch (error) {
    const errorMessage = error instanceof Error
      ? error.message
      : (typeof error === "object" && error !== null
        ? ((error as { message?: string }).message || JSON.stringify(error))
        : String(error));
    logStep("ERROR", { message: errorMessage });
    return json({ error: errorMessage }, 500);
  }
});

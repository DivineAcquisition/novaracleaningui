import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { getEstimatedHours } from "../_shared/payout-utils.ts";
import { resolveSecret } from "../_shared/app-secrets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-expiry",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-PAYMENT-INTENT] ${step}${detailsStr}`);
};

// ─── v4.0 Pricing — single source of truth ──────────────
//
// Pricing math lives in `_shared/pricing.ts` (mirrored in `src/lib/
// pricing.ts`). DO NOT redefine bases or discounts here — drift between
// the two is exactly what caused the v3 "$216 quote → $432 charge" bug.
import { calculatePriceCents, HOME_SIZE_RANGES } from "../_shared/pricing.ts";

const DEPOSIT_PERCENT = 0.5;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    // Parse and normalize the request body - support multiple payload shapes
    const rawBody = await req.json();
    
    // Support both direct booking data AND wrapped { bookingData: {...} } format
    const bookingData = rawBody.bookingData || rawBody;
    
    // Normalize email field - accept both 'email' and 'customerEmail'
    const customerEmail = (bookingData.email || bookingData.customerEmail || rawBody.email || rawBody.customerEmail || '').trim();
    
    logStep("Received booking data", { 
      serviceType: bookingData.serviceType,
      paymentOption: bookingData.paymentOption,
      membershipPlan: bookingData.membershipPlan,
      hasEmail: !!customerEmail,
      hasCustomerEmail: !!bookingData.customerEmail,
      hasRawEmail: !!rawBody.email,
      hasHomeSizeId: !!bookingData.homeSizeId,
    });

    // Normalize the email field for downstream use
    bookingData.email = customerEmail;

    // Validate required fields before proceeding
    if (!customerEmail || !bookingData.homeSizeId) {
      logStep("Validation failed - missing required fields", {
        hasEmail: !!customerEmail,
        hasHomeSizeId: !!bookingData.homeSizeId,
        receivedKeys: Object.keys(bookingData),
      });
      return new Response(
        JSON.stringify({ 
          error: "Missing required booking data",
          details: !customerEmail ? "Email is required" : "Home size is required",
          code: "VALIDATION_ERROR" 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Read STRIPE_SECRET_KEY through the DB override layer first
    // (public.app_secrets.STRIPE_SECRET_KEY) and fall back to the env
    // var. This is what routes brand-new charges to the correct
    // Stripe account (NovaraCleaning) without needing dashboard
    // access to rotate Edge Function secrets.
    const stripeKey = await resolveSecret(supabaseClient, "STRIPE_SECRET_KEY");
    const stripe = new Stripe(stripeKey, {
      apiVersion: "2025-08-27.basil",
    });

    // ─── Single-source pricing ──────────────────────────────────────────
    // Validate home size first so we get a clean 400 if it's bogus.
    const knownSize = HOME_SIZE_RANGES.find((h) => h.id === bookingData.homeSizeId);
    if (!knownSize) {
      logStep("Invalid home size ID", { homeSizeId: bookingData.homeSizeId });
      return new Response(
        JSON.stringify({
          error: "Invalid home size selected",
          details: "Please go back and select a valid home size.",
          code: "INVALID_HOME_SIZE",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const membershipPlan: string = bookingData.membershipPlan || "none";
    const incomingAddOns: string[] = Array.isArray(bookingData.addOns) ? bookingData.addOns : [];
    const calc = calculatePriceCents(
      bookingData.homeSizeId as string,
      bookingData.serviceType as string,
      incomingAddOns,
      membershipPlan,
      !!bookingData.useCredit,
      "B",
    );
    const basePrice = calc.serviceListCents; // pre-discount list (kept on booking.base_price_cents)
    const subtotal = calc.subtotalCents;
    const addOnsTotal = calc.addOnsCents;
    const serviceTierDiscount = calc.discountCents;
    // `newCustomerDiscount` / `membershipDiscount` are kept as variable names
    // because downstream code (logging, metadata) references them. All flat
    // legacy discounts (promo codes, 50% acquisition, 50% referral) are now
    // intentionally ZERO — discounts come exclusively from the per-service
    // rules in _shared/pricing.ts (15% standard, 25% deep, 50% off standard
    // portion of combo).
    const newCustomerDiscount = serviceTierDiscount;
    const membershipDiscount = 0;

    // Booking history is still tracked for analytics (referral / activation
    // reports), but does NOT influence pricing anymore.
    const { data: previousBookings } = await supabaseClient
      .from("bookings")
      .select("id, status")
      .eq("email", bookingData.email)
      .in("status", ["confirmed", "completed"])
      .order("created_at", { ascending: false });
    const bookingNumber = (previousBookings?.length || 0) + 1;
    const isNewCustomer = bookingNumber === 1;
    void isNewCustomer;

    // Referral codes still attach to the booking row (so the referrer
    // gets a referral credit when the booking completes via
    // complete-booking) but they no longer subtract from the customer's
    // total. The 50%-off-via-referral stack was retired with the new
    // pricing rules.
    let referralDiscountCents = 0;
    let referralCode = "";
    if (bookingData.referralCode) {
      const { data: referrer } = await supabaseClient
        .from("customers")
        .select("id, email")
        .eq("referral_code", bookingData.referralCode)
        .maybeSingle();
      if (referrer && referrer.email !== bookingData.email) {
        referralCode = String(bookingData.referralCode).toUpperCase();
        logStep("Referral code attached (no discount stack)", { referralCode, referrerEmail: referrer.email });
      } else if (referrer && referrer.email === bookingData.email) {
        logStep("Referral code rejected - cannot refer yourself");
      } else {
        logStep("Invalid referral code");
      }
    }

    // Calculate credit coverage. Already included in `calc.totalCents`
    // when useCredit was passed to calculatePriceCents, but we keep the
    // local variable for logging consistency.
    const creditCoverage = bookingData.useCredit ? Math.min(basePrice, 15000) : 0;
    const estimatedHours = getEstimatedHours(bookingData.homeSizeId as string);

    // Promo codes are no longer honored — discounts are per-service-tier in pricing.ts.
    let promoDiscountCents = 0;
    let promoCode = '';
    if (bookingData.promoCode) {
      logStep("Promo code received but discounts are disabled in v4", {
        code: String(bookingData.promoCode).toUpperCase(),
      });
      promoCode = String(bookingData.promoCode).toUpperCase();
    }

    logStep("Customer booking history", { 
      bookingNumber, 
      isNewCustomer, 
      previousBookings: previousBookings?.length || 0, 
      newCustomerDiscount, 
      referralDiscountCents,
      promoDiscountCents 
    });

    // ── Account-credit (wallet) ledger lookup ──────────────────────────
    // If the customer is signed in and asked to apply wallet credit, look
    // up their available balance and deduct up to the post-promo total.
    // The credit ledger lives in public.customer_credits and is created
    // via the admin-grant-credit endpoint or referral redemption flow.
    // Capture-time deduction (status → 'applied') happens after
    // payment succeeds; here we only RESERVE a quote so the customer
    // sees the right total at checkout.
    let walletCreditCents = 0;
    let walletCustomerId: string | null = null;
    try {
      const requestedWallet = Math.max(0, Math.round(Number(bookingData.applyWalletCents || 0)));
      if (requestedWallet > 0 && bookingData.email) {
        const { data: walletCustomer } = await supabaseClient
          .from("customers")
          .select("id")
          .eq("email", String(bookingData.email).toLowerCase())
          .maybeSingle();
        if (walletCustomer?.id) {
          walletCustomerId = walletCustomer.id;
          const { data: balanceData } = await supabaseClient.rpc(
            "get_customer_credit_balance",
            { _customer_id: walletCustomer.id },
          );
          const available = Number((balanceData as { balance_cents?: number })?.balance_cents || 0);
          const pricedSoFar = Math.max(0, subtotal - membershipDiscount - newCustomerDiscount - creditCoverage - referralDiscountCents - promoDiscountCents);
          walletCreditCents = Math.min(requestedWallet, available, pricedSoFar);
          logStep("Wallet credit reserved", { requested: requestedWallet, available, applied: walletCreditCents });
        }
      }
    } catch (walletErr) {
      logStep("Wallet credit lookup failed (non-blocking)", { error: walletErr instanceof Error ? walletErr.message : String(walletErr) });
    }

    // v4: total is whatever the pricing module said, minus any wallet
    // credit. All "discounts" are already baked into calc.totalCents.
    let totalAmount = Math.max(0, calc.totalCents - walletCreditCents);
    logStep("Base calculation (v4)", {
      subtotal,
      serviceTierDiscount,
      creditCoverage,
      referralDiscountCents,
      promoDiscountCents,
      walletCreditCents,
      totalAmount,
    });

    // Cleaner payout = flat 35% of customer-paid revenue (Foundation
    // tier default at booking time — no cleaner has been assigned yet).
    // dispatch-job recomputes using the actual assigned cleaner's tier
    // % when the job goes out for offer, so this is just the booking-
    // time placeholder that complete-booking and process-payout fall
    // back to if dispatch never ran.
    const DEFAULT_BOOKING_PAY_PCT = 35;
    const cleanerPayoutCents = Math.floor((totalAmount * DEFAULT_BOOKING_PAY_PCT) / 100);
    const platformFeeCents = totalAmount - cleanerPayoutCents;

    logStep("Payout calculation (revenue share)", {
      totalAmount,
      payPercentage: DEFAULT_BOOKING_PAY_PCT,
      cleanerPayoutCents,
      platformFeeCents,
    });

    // Determine amount to charge.
    //
    // Customer-facing UX has retired the "Pay in Full" option entirely;
    // every customer pays a 50% deposit at booking and the remaining 50%
    // is auto-charged after the cleaner marks complete (see complete-
    // booking). To stop a stale `bookingData.paymentOption === 'full'`
    // (e.g. persisted from before the toggle was removed, or set by
    // a future admin tool) from accidentally charging the full amount,
    // we IGNORE 'full' here and force deposit unless the request comes
    // in for a member booking using their cleaning credit.
    //
    // `useCredit: true` still charges the $1 card-verification minimum
    // so the saved card can be auto-charged later if the credit is
    // already exhausted.
    let amountToCharge = 0;
    let fullPaymentDiscount = 0;

    if (bookingData.useCredit) {
      amountToCharge = 100; // $1 minimum authorization to capture card
      logStep("Member using credit - $1 card authorization required", { depositAmount: amountToCharge });
    } else {
      amountToCharge = Math.max(100, Math.round(totalAmount * DEPOSIT_PERCENT));
      logStep("50% deposit payment (paymentOption='full' ignored if sent)", {
        depositAmount: amountToCharge,
        totalAmount,
        clientSentPaymentOption: bookingData.paymentOption,
      });
    }

    // Check if customer exists in Stripe
    const customers = await stripe.customers.list({
      email: bookingData.email,
      limit: 1,
    });

    let customerId: string | undefined;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      logStep("Found existing customer", { customerId });
    } else {
      const customer = await stripe.customers.create({
        email: bookingData.email,
        name: `${bookingData.firstName} ${bookingData.lastName}`,
        phone: bookingData.phone,
      });
      customerId = customer.id;
      logStep("Created new customer", { customerId });
    }

    // CRITICAL: Always create PaymentIntent — no bookings without payment verification.
    // `setup_future_usage: 'off_session'` attaches the PaymentMethod to the
    // Stripe Customer so the remaining balance can be auto-charged after the
    // cleaner marks the service complete (see complete-booking). The card is
    // saved for one-time bookings *and* deposit bookings — that way the
    // post-service auto-charge works regardless of payment option.
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountToCharge,
      currency: "usd",
      customer: customerId,
      automatic_payment_methods: {
        enabled: true,
      },
      setup_future_usage: "off_session",
      metadata: {
        serviceType: bookingData.serviceType,
        homeSizeId: bookingData.homeSizeId,
        serviceDate: bookingData.serviceDate,
        timeSlot: bookingData.timeSlot,
        paymentOption: bookingData.paymentOption,
        bookingNumber: String(bookingNumber),
        isNewCustomer: String(isNewCustomer),
        referralCode: referralCode || '',
        promoCode: promoCode || '',
      },
    });

    const paymentIntentId = paymentIntent.id;
    const clientSecret = paymentIntent.client_secret;
    logStep("Created payment intent", { paymentIntentId, amount: amountToCharge, bookingNumber });

    // Reserve the time slot before creating booking
    if (bookingData.startTime && bookingData.endTime) {
      logStep("Attempting to reserve time slot", { 
        date: bookingData.serviceDate, 
        startTime: bookingData.startTime,
        endTime: bookingData.endTime 
      });

      // Ensure the time slot exists (upsert)
      await supabaseClient
        .from('availability_slots')
        .upsert({
          service_date: bookingData.serviceDate,
          time_slot: bookingData.timeSlot,
          start_time: bookingData.startTime,
          end_time: bookingData.endTime,
          max_capacity: 5,
          current_bookings: 0
        }, { 
          onConflict: 'service_date,start_time',
          ignoreDuplicates: true 
        });

      const { data: reserved, error: reserveError } = await supabaseClient
        .rpc('reserve_time_slot', {
          _date: bookingData.serviceDate,
          _start_time: bookingData.startTime,
          _end_time: bookingData.endTime
        });

      if (reserveError || !reserved) {
        logStep("Warning: slot reservation failed, continuing with payment", { error: reserveError });
      } else {
        logStep("Time slot reserved successfully");
      }
    } else {
      logStep("Warning: startTime/endTime not provided, skipping slot reservation");
    }

    // Store provisional booking in database - ALWAYS as pending_payment
    const { data: booking, error: bookingError } = await supabaseClient
      .from("bookings")
      .insert({
        email: bookingData.email,
        first_name: bookingData.firstName,
        last_name: bookingData.lastName,
        phone: bookingData.phone,
        address: bookingData.address || '',
        city: bookingData.city || '',
        state: bookingData.state || '',
        zip_code: bookingData.zipCode,
        home_size_id: bookingData.homeSizeId,
        service_type: bookingData.serviceType,
        offer_type: bookingData.serviceType, // 'combo' / 'standard' / 'deep' — used by reports + GHL sync
        add_ons: relevantAddOns,
        service_date: bookingData.serviceDate,
        time_slot: bookingData.timeSlot,
        membership_plan: membershipPlan,
        uses_credit: bookingData.useCredit || false,
        base_price_cents: basePrice,
        deposit_cents: bookingData.paymentOption === 'deposit'
          ? (bookingData.useCredit ? 100 : amountToCharge)
          : 0,
        total_estimate_cents: totalAmount,
        payment_intent_id: paymentIntentId,
        customer_id: customerId,
        status: 'pending_payment', // CRITICAL: Always pending until payment verified
        // Always 'deposit' for customer-facing bookings — see comment
        // on amountToCharge above. Members using credit are also
        // recorded as 'deposit' since the $1 authorization is
        // functionally a deposit hold.
        payment_option: 'deposit',
        full_payment_discount: fullPaymentDiscount,
        platform_fee_cents: platformFeeCents,
        cleaner_payout_cents: cleanerPayoutCents,
        payout_status: 'pending',
        booking_number: bookingNumber,
        estimated_duration_hours: estimatedHours,
        team_notes: referralCode 
          ? `Referral code used: ${referralCode}${promoCode ? ` | Promo code: PROMO:${promoCode}` : ''}${walletCreditCents > 0 ? ` | Wallet credit: $${(walletCreditCents / 100).toFixed(2)}` : ''}`
          : (promoCode ? `Promo code: PROMO:${promoCode}${walletCreditCents > 0 ? ` | Wallet credit: $${(walletCreditCents / 100).toFixed(2)}` : ''}` : (walletCreditCents > 0 ? `Wallet credit: $${(walletCreditCents / 100).toFixed(2)}` : null)),
        // Canonical referral attribution column (replaces metadata trick
        // used in stripe-webhook which never worked because bookings has
        // no metadata column).
        referral_code: referralCode || null,
        // How much wallet credit was reserved for this booking. The
        // actual ledger deduction happens in stripe-webhook on
        // payment_intent.succeeded via apply_customer_credit_to_booking.
        applied_credit_cents: walletCreditCents,

        // ─── Attribution tracking (AlphaLux-style) ──────────────────
        // The client captures UTM / landing / referrer in localStorage
        // via UTMTracker, then posts the bag here at booking creation.
        // We store the full JSON in `tracking` plus the most-queried
        // fields in dedicated columns so admin reports can SQL-filter
        // without digging into JSONB.
        tracking: bookingData.tracking || null,
        utm_source: bookingData.utmSource || bookingData.tracking?.utm_source || null,
        utm_medium: bookingData.utmMedium || bookingData.tracking?.utm_medium || null,
        utm_campaign: bookingData.utmCampaign || bookingData.tracking?.utm_campaign || null,
        utm_content: bookingData.utmContent || bookingData.tracking?.utm_content || null,
        utm_term: bookingData.utmTerm || bookingData.tracking?.utm_term || null,
        landing_page: bookingData.landingPage || bookingData.tracking?.landing_page || null,
        referrer: bookingData.referrer || bookingData.tracking?.referrer || null,
        fbclid: bookingData.fbclid || bookingData.tracking?.fbclid || null,
        gclid: bookingData.gclid || bookingData.tracking?.gclid || null,
        first_visit_at: bookingData.firstVisitTimestamp || bookingData.tracking?.first_visit_timestamp || null,
      })
      .select()
      .single();

    if (bookingError) {
      logStep("Error creating booking", { error: bookingError });
      throw bookingError;
    }

    logStep("Booking created successfully", { bookingId: booking.id });


    return new Response(
      JSON.stringify({
        clientSecret,
        amount: amountToCharge,
        bookingId: booking.id,
        requiresPayment: true, // ALWAYS true - no bookings without payment verification
        bookingNumber,
        isNewCustomer,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("Error in create-payment-intent", { error: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});

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
import { calculatePriceCents, HOME_SIZE_RANGES, DEPOSIT_PERCENT } from "../_shared/pricing.ts";
import {
  FOCUSED_SAME_DAY_DEFAULTS,
  FOCUSED_SAME_DAY_SETTINGS_KEY,
  calculateFocusedPrice,
  isSameDayAvailableNow,
  isServiceDateToday,
  mergeFocusedSameDaySettings,
  withSameDayUpcharge,
  type FocusedAreaSelection,
  type FocusedCondition,
} from "../_shared/focused-same-day.ts";

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
    const isFocused = bookingData.serviceType === "focused";

    // Load admin-tunable focused/same-day rates (fallback to code defaults).
    let focusedSettings = FOCUSED_SAME_DAY_DEFAULTS;
    try {
      const { data: settingsRow } = await supabaseClient
        .from("app_settings")
        .select("value")
        .eq("key", FOCUSED_SAME_DAY_SETTINGS_KEY)
        .maybeSingle();
      if (settingsRow?.value) focusedSettings = mergeFocusedSameDaySettings(settingsRow.value);
    } catch (_) { /* defaults */ }

    const focusedAreas: FocusedAreaSelection[] = Array.isArray(bookingData.focusedAreas)
      ? bookingData.focusedAreas.map((a: any) => ({
          areaId: String(a.areaId || a.area_id || ""),
          quantity: Math.max(1, Math.floor(Number(a.quantity) || 1)),
        })).filter((a: FocusedAreaSelection) => a.areaId)
      : [];
    const conditionLevel = (["light", "normal", "heavy", "severe"].includes(bookingData.conditionLevel)
      ? bookingData.conditionLevel
      : "normal") as FocusedCondition;

    let isSameDay = Boolean(bookingData.isSameDay);
    if (isSameDay) {
      if (!isServiceDateToday(String(bookingData.serviceDate || ""), focusedSettings)) {
        return new Response(
          JSON.stringify({ error: "Same-day is only available for today's date.", code: "SAME_DAY_DATE" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (!isSameDayAvailableNow(focusedSettings)) {
        return new Response(
          JSON.stringify({
            error: `Same-day is only available before ${focusedSettings.same_day_cutoff}.`,
            code: "SAME_DAY_CUTOFF",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (!bookingData.sameDayAcknowledgedAt) {
        return new Response(
          JSON.stringify({
            error: "Same-day disclosure must be acknowledged before payment.",
            code: "SAME_DAY_ACK_REQUIRED",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    if (isFocused && focusedAreas.length === 0) {
      return new Response(
        JSON.stringify({ error: "Select at least one area for a focused clean.", code: "FOCUSED_AREAS_REQUIRED" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let calc = calculatePriceCents(
      bookingData.homeSizeId as string,
      isFocused ? "standard" : bookingData.serviceType as string,
      isFocused ? [] : incomingAddOns,
      membershipPlan,
      !!bookingData.useCredit,
      "B",
    );
    let sameDayUpchargeCents = 0;
    let estimatedHours = getEstimatedHours(bookingData.homeSizeId as string);

    if (isFocused) {
      const focused = calculateFocusedPrice(focusedAreas, conditionLevel, isSameDay, focusedSettings);
      const toC = (n: number) => Math.round(n * 100);
      calc = {
        basePriceCents: toC(focused.areasSubtotal),
        serviceListCents: toC(focused.serviceTotal),
        serviceFinalCents: toC(focused.serviceTotal),
        discountCents: 0,
        addOnsCents: 0,
        subtotalCents: toC(focused.serviceTotal),
        totalCents: toC(focused.total),
        depositCents: toC(focused.deposit),
        remainingCents: 0,
        hours: focused.hours,
      };
      sameDayUpchargeCents = toC(focused.sameDayUpcharge);
      estimatedHours = focused.hours;
    } else if (isSameDay) {
      const withSd = withSameDayUpcharge(calc.totalCents / 100, true, focusedSettings);
      sameDayUpchargeCents = Math.round(withSd.sameDayUpcharge * 100);
      calc = {
        ...calc,
        totalCents: Math.round(withSd.total * 100),
        depositCents: Math.round(withSd.deposit * 100),
        remainingCents: Math.round(withSd.balanceDue * 100),
      };
    }

    const basePrice = calc.serviceListCents; // pre-discount list (kept on booking.base_price_cents)
    const subtotal = calc.subtotalCents;
    const addOnsTotal = calc.addOnsCents;
    const serviceTierDiscount = isFocused ? 0 : calc.discountCents;
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

    // Promo codes are no longer honored — the only discounts in v4 are
    // the per-service-tier rules in _shared/pricing.ts. A code on the
    // payload is logged for analytics but never reduces the charge.
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
        // Reserve wallet credit by EMAIL (case-insensitive) so the credit is
        // honored whenever the booking email matches the credited customer —
        // even if no exact customer row is resolved here. The capture-time
        // deduction (auto_apply_wallet_credit_on_confirm) is also email-based.
        const { data: balanceData } = await supabaseClient.rpc(
          "get_customer_credit_balance_by_email",
          { _email: String(bookingData.email) },
        );
        const available = Number((balanceData as { balance_cents?: number })?.balance_cents || 0);
        if (available > 0) {
          const { data: walletCustomers } = await supabaseClient
            .from("customers")
            .select("id")
            .ilike("email", String(bookingData.email).trim())
            .limit(1);
          walletCustomerId = walletCustomers?.[0]?.id || null;
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

    // Amount to charge:
    //   • Focused cleans → paid in full (only pay-in-full customer path)
    //   • Same-day on whole-home → normal 50% deposit (includes same-day fee)
    //   • Member credit → $1 card authorization
    let amountToCharge = 0;
    let fullPaymentDiscount = 0;
    let paymentOptionStored: "deposit" | "full" = "deposit";

    if (bookingData.useCredit) {
      amountToCharge = 100; // $1 minimum authorization to capture card
      logStep("Member using credit - $1 card authorization required", { depositAmount: amountToCharge });
    } else if (isFocused) {
      amountToCharge = Math.max(100, totalAmount);
      paymentOptionStored = "full";
      logStep("Focused clean — charge in full", { amountToCharge, totalAmount, sameDayUpchargeCents });
    } else {
      amountToCharge = Math.max(100, Math.round(totalAmount * DEPOSIT_PERCENT));
      logStep("50% deposit payment", {
        depositAmount: amountToCharge,
        totalAmount,
        sameDayUpchargeCents,
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
        paymentOption: paymentOptionStored,
        bookingNumber: String(bookingNumber),
        isNewCustomer: String(isNewCustomer),
        referralCode: referralCode || '',
        promoCode: promoCode || '',
        isSameDay: String(isSameDay),
        sameDayUpchargeCents: String(sameDayUpchargeCents),
      },
    });

    const paymentIntentId = paymentIntent.id;
    const clientSecret = paymentIntent.client_secret;
    logStep("Created payment intent", { paymentIntentId, amount: amountToCharge, bookingNumber });

    // Ensure the availability slot row exists for display, but DO NOT
    // reserve/hold it here. Capacity is only consumed when the booking is
    // actually confirmed (finalize-booking → runPostConfirmFanout →
    // reserveBookingSlot). This keeps abandoned / incomplete
    // pending_payment bookings from holding a slot that was never paid for.
    if (bookingData.startTime && bookingData.endTime) {
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
      logStep("Ensured availability slot row exists (no hold placed until confirmation)", {
        date: bookingData.serviceDate,
        startTime: bookingData.startTime,
        endTime: bookingData.endTime,
      });
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
        add_ons: incomingAddOns,
        service_date: bookingData.serviceDate,
        time_slot: bookingData.timeSlot,
        membership_plan: membershipPlan,
        uses_credit: bookingData.useCredit || false,
        base_price_cents: basePrice,
        // Amount collected at booking (full total for focused; 50% otherwise).
        deposit_cents: bookingData.useCredit ? 100 : amountToCharge,
        total_estimate_cents: totalAmount,
        payment_intent_id: paymentIntentId,
        customer_id: customerId,
        status: 'pending_payment', // CRITICAL: Always pending until payment verified
        payment_option: paymentOptionStored,
        full_payment_discount: fullPaymentDiscount,
        platform_fee_cents: platformFeeCents,
        cleaner_payout_cents: cleanerPayoutCents,
        payout_status: 'pending',
        booking_number: bookingNumber,
        estimated_duration_hours: estimatedHours,
        focused_areas: isFocused ? focusedAreas : [],
        condition_level: isFocused || bookingData.conditionLevel ? conditionLevel : null,
        is_same_day: isSameDay,
        same_day_upcharge_cents: sameDayUpchargeCents,
        same_day_acknowledged_at: isSameDay ? bookingData.sameDayAcknowledgedAt : null,
        same_day_sourcing_deadline_at: isSameDay
          ? new Date(Date.now() + focusedSettings.sourcing_deadline_minutes * 60_000).toISOString()
          : null,
        hard_deadline_at: isSameDay
          ? new Date(Date.now() + focusedSettings.sourcing_deadline_minutes * 60_000).toISOString()
          : null,
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

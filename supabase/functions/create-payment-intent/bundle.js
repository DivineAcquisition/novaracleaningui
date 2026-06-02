// index.ts
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

// ../_shared/payout-utils.ts
var TIER_REVENUE_SHARE = {
  foundation: 35,
  proven: 40,
  elite: 45
};
var DEFAULT_PAY_TIER = "foundation";
var DEFAULT_PAY_PERCENTAGE = TIER_REVENUE_SHARE[DEFAULT_PAY_TIER];
var HOME_SIZE_HOURS = {
  "0_999": 2,
  "1000_1500": 2.5,
  "1501_2000": 3,
  "2001_2500": 3.5,
  "2501_3000": 4,
  "3001_3500": 4.5,
  "3501_4000": 5,
  "4001_4500": 5.5,
  "4501_5000": 6,
  "5000_plus": 8
};
function getEstimatedHours(homeSizeId) {
  return HOME_SIZE_HOURS[homeSizeId] || 4;
}

// ../_shared/app-secrets.ts
var cache = /* @__PURE__ */ new Map();
async function resolveSecret(supabase, name) {
  if (cache.has(name)) return cache.get(name) ?? "";
  let value = "";
  try {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", name).maybeSingle();
    if (data?.value && typeof data.value === "string") {
      value = data.value.trim();
    }
  } catch (err) {
    console.warn(`[app-secrets] DB read failed for ${name}`, err);
  }
  if (!value) {
    value = (Deno.env.get(name) || "").trim();
  }
  cache.set(name, value);
  return value;
}

// ../_shared/pricing.ts
var HOME_SIZE_RANGES = [
  { id: "0_999", label: "0 \u2013 999 sq ft", minSqft: 0, maxSqft: 999, bedroomRange: "Studio \u2013 1 BR", baseHours: 2, standardPrice: 150, cleaners: "1" },
  { id: "1000_1500", label: "1,000 \u2013 1,500 sq ft", minSqft: 1e3, maxSqft: 1500, bedroomRange: "1\u20132 BR condos/homes", baseHours: 2.5, standardPrice: 190, cleaners: "1" },
  { id: "1501_2000", label: "1,501 \u2013 2,000 sq ft", minSqft: 1501, maxSqft: 2e3, bedroomRange: "2\u20133 BR apartments", baseHours: 3, standardPrice: 225, cleaners: "1" },
  { id: "2001_2500", label: "2,001 \u2013 2,500 sq ft", minSqft: 2001, maxSqft: 2500, bedroomRange: "3\u20134 BR homes", baseHours: 3.5, standardPrice: 260, cleaners: "1" },
  { id: "2501_3000", label: "2,501 \u2013 3,000 sq ft", minSqft: 2501, maxSqft: 3e3, bedroomRange: "4 BR homes", baseHours: 4, standardPrice: 300, cleaners: "1-2" },
  { id: "3001_3500", label: "3,001 \u2013 3,500 sq ft", minSqft: 3001, maxSqft: 3500, bedroomRange: "4\u20135 BR homes", baseHours: 4.5, standardPrice: 340, cleaners: "1-2" },
  { id: "3501_4000", label: "3,501 \u2013 4,000 sq ft", minSqft: 3501, maxSqft: 4e3, bedroomRange: "5 BR homes", baseHours: 5, standardPrice: 375, cleaners: "2" },
  { id: "4001_4500", label: "4,001 \u2013 4,500 sq ft", minSqft: 4001, maxSqft: 4500, bedroomRange: "5+ BR homes", baseHours: 5.5, standardPrice: 415, cleaners: "2" },
  { id: "4501_5000", label: "4,501 \u2013 5,000 sq ft", minSqft: 4501, maxSqft: 5e3, bedroomRange: "5+ BR large homes", baseHours: 6, standardPrice: 450, cleaners: "2" },
  { id: "5000_plus", label: "5,000+ sq ft", minSqft: 5e3, maxSqft: 999999, bedroomRange: "6+ BR estates", baseHours: 0, standardPrice: 0, cleaners: "Custom" }
];
var SERVICE_TIER_PRICING = {
  standard: { label: "Standard Clean", multiplier: 1 },
  deep: { label: "Deep Clean", multiplier: 1.5 },
  combo: { label: "Deep + Standard Combo", multiplier: 2.5 },
  moveInOut: { label: "Move-In / Move-Out", multiplier: 2 }
};
var SERVICE_ZONES = {
  A: { id: "A", modifier: 1.15 },
  B: { id: "B", modifier: 1 },
  C: { id: "C", modifier: 0.9 }
};
var ADD_ONS = {
  fridge: { price: 30 },
  oven: { price: 30 },
  windows: { price: 40 }
};
var SERVICE_DISCOUNT_RATES = {
  standard: 0.15,
  deep: 0.25,
  combo: 0,
  moveInOut: 0
};
var DEPOSIT_PERCENT = 0.5;
function getHomeSize(homeSizeId) {
  return HOME_SIZE_RANGES.find((h) => h.id === homeSizeId);
}
function getZonePrice(basePrice, zone = "B") {
  return Math.round(basePrice * SERVICE_ZONES[zone].modifier);
}
function getServiceListPrice(homeSizeId, serviceType, zone = "B") {
  const home = getHomeSize(homeSizeId);
  if (!home || home.standardPrice === 0) return 0;
  const tier = SERVICE_TIER_PRICING[serviceType];
  if (!tier) return 0;
  return getZonePrice(home.standardPrice * tier.multiplier, zone);
}
function getServiceFinalPrice(homeSizeId, serviceType, zone = "B", membershipPlan = "none") {
  const list = getServiceListPrice(homeSizeId, serviceType, zone);
  if (list === 0) return 0;
  if (membershipPlan !== "none") return list;
  const home = getHomeSize(homeSizeId);
  if (!home) return list;
  const stdList = getZonePrice(home.standardPrice, zone);
  const deepList = getZonePrice(home.standardPrice * SERVICE_TIER_PRICING.deep.multiplier, zone);
  switch (serviceType) {
    case "standard":
      return Math.round(stdList * (1 - SERVICE_DISCOUNT_RATES.standard) * 100) / 100;
    case "deep":
      return Math.round(deepList * (1 - SERVICE_DISCOUNT_RATES.deep) * 100) / 100;
    case "combo":
      return Math.round((stdList * 0.5 + deepList) * 100) / 100;
    case "moveInOut":
    default:
      return list;
  }
}
function calculatePrice(homeSizeId, serviceType, addOns = [], membershipPlan = "none", useCredit = false, zone = "B") {
  const home = getHomeSize(homeSizeId);
  if (!home) {
    return { basePrice: 0, serviceListPrice: 0, serviceFinalPrice: 0, serviceDiscount: 0, addOnsTotal: 0, subtotal: 0, total: 0, creditCoverage: 0, deposit: 0, balanceDue: 0, hours: 0 };
  }
  const basePrice = getZonePrice(home.standardPrice, zone);
  const serviceListPrice = getServiceListPrice(homeSizeId, serviceType, zone);
  const serviceFinalPrice = getServiceFinalPrice(homeSizeId, serviceType, zone, membershipPlan);
  const serviceDiscount = Math.max(0, serviceListPrice - serviceFinalPrice);
  let addOnsTotal = 0;
  if (serviceType === "moveInOut") {
    addOnsTotal = addOns.filter((a) => a === "windows").reduce((sum, a) => sum + (ADD_ONS[a]?.price || 0), 0);
  } else {
    addOnsTotal = addOns.reduce((sum, a) => sum + (ADD_ONS[a]?.price || 0), 0);
  }
  const subtotal = serviceListPrice + addOnsTotal;
  const creditCoverage = useCredit ? Math.min(basePrice, 150) : 0;
  const total = Math.max(0, serviceFinalPrice + addOnsTotal - creditCoverage);
  const deposit = useCredit ? 0 : Math.round(total * DEPOSIT_PERCENT * 100) / 100;
  const balanceDue = Math.max(0, total - deposit);
  return {
    basePrice,
    serviceListPrice,
    serviceFinalPrice,
    serviceDiscount,
    addOnsTotal,
    subtotal,
    total,
    creditCoverage,
    deposit,
    balanceDue,
    hours: home.baseHours
  };
}
function calculatePriceCents(homeSizeId, serviceType, addOns = [], membershipPlan = "none", useCredit = false, zone = "B") {
  const c = calculatePrice(homeSizeId, serviceType, addOns, membershipPlan, useCredit, zone);
  const toC = (n) => Math.round(n * 100);
  return {
    basePriceCents: toC(c.basePrice),
    serviceListCents: toC(c.serviceListPrice),
    serviceFinalCents: toC(c.serviceFinalPrice),
    discountCents: toC(c.serviceDiscount),
    addOnsCents: toC(c.addOnsTotal),
    subtotalCents: toC(c.subtotal),
    totalCents: toC(c.total),
    depositCents: toC(c.deposit),
    remainingCents: toC(c.balanceDue),
    hours: c.hours
  };
}

// index.ts
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-expiry",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
var logStep = (step, details) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[CREATE-PAYMENT-INTENT] ${step}${detailsStr}`);
};
var DEPOSIT_PERCENT2 = 0.5;
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    logStep("Function started");
    const rawBody = await req.json();
    const bookingData = rawBody.bookingData || rawBody;
    const customerEmail = (bookingData.email || bookingData.customerEmail || rawBody.email || rawBody.customerEmail || "").trim();
    logStep("Received booking data", {
      serviceType: bookingData.serviceType,
      paymentOption: bookingData.paymentOption,
      membershipPlan: bookingData.membershipPlan,
      hasEmail: !!customerEmail,
      hasCustomerEmail: !!bookingData.customerEmail,
      hasRawEmail: !!rawBody.email,
      hasHomeSizeId: !!bookingData.homeSizeId
    });
    bookingData.email = customerEmail;
    if (!customerEmail || !bookingData.homeSizeId) {
      logStep("Validation failed - missing required fields", {
        hasEmail: !!customerEmail,
        hasHomeSizeId: !!bookingData.homeSizeId,
        receivedKeys: Object.keys(bookingData)
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
    const stripeKey = await resolveSecret(supabaseClient, "STRIPE_SECRET_KEY");
    const stripe = new Stripe(stripeKey, {
      apiVersion: "2025-08-27.basil"
    });
    const knownSize = HOME_SIZE_RANGES.find((h) => h.id === bookingData.homeSizeId);
    if (!knownSize) {
      logStep("Invalid home size ID", { homeSizeId: bookingData.homeSizeId });
      return new Response(
        JSON.stringify({
          error: "Invalid home size selected",
          details: "Please go back and select a valid home size.",
          code: "INVALID_HOME_SIZE"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const membershipPlan = bookingData.membershipPlan || "none";
    const incomingAddOns = Array.isArray(bookingData.addOns) ? bookingData.addOns : [];
    const calc = calculatePriceCents(
      bookingData.homeSizeId,
      bookingData.serviceType,
      incomingAddOns,
      membershipPlan,
      !!bookingData.useCredit,
      "B"
    );
    const basePrice = calc.serviceListCents;
    const subtotal = calc.subtotalCents;
    const addOnsTotal = calc.addOnsCents;
    const serviceTierDiscount = calc.discountCents;
    const newCustomerDiscount = serviceTierDiscount;
    const membershipDiscount = 0;
    const { data: previousBookings } = await supabaseClient.from("bookings").select("id, status").eq("email", bookingData.email).in("status", ["confirmed", "completed"]).order("created_at", { ascending: false });
    const bookingNumber = (previousBookings?.length || 0) + 1;
    const isNewCustomer = bookingNumber === 1;
    void isNewCustomer;
    let referralDiscountCents = 0;
    let referralCode = "";
    if (bookingData.referralCode) {
      const { data: referrer } = await supabaseClient.from("customers").select("id, email").eq("referral_code", bookingData.referralCode).maybeSingle();
      if (referrer && referrer.email !== bookingData.email) {
        referralCode = String(bookingData.referralCode).toUpperCase();
        logStep("Referral code attached (no discount stack)", { referralCode, referrerEmail: referrer.email });
      } else if (referrer && referrer.email === bookingData.email) {
        logStep("Referral code rejected - cannot refer yourself");
      } else {
        logStep("Invalid referral code");
      }
    }
    const creditCoverage = bookingData.useCredit ? Math.min(basePrice, 15e3) : 0;
    const estimatedHours = getEstimatedHours(bookingData.homeSizeId);
    let promoDiscountCents = 0;
    let promoCode = "";
    if (bookingData.promoCode) {
      logStep("Promo code received but discounts are disabled in v4", {
        code: String(bookingData.promoCode).toUpperCase()
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
    let walletCreditCents = 0;
    let walletCustomerId = null;
    try {
      const requestedWallet = Math.max(0, Math.round(Number(bookingData.applyWalletCents || 0)));
      if (requestedWallet > 0 && bookingData.email) {
        const { data: walletCustomer } = await supabaseClient.from("customers").select("id").eq("email", String(bookingData.email).toLowerCase()).maybeSingle();
        if (walletCustomer?.id) {
          walletCustomerId = walletCustomer.id;
          const { data: balanceData } = await supabaseClient.rpc(
            "get_customer_credit_balance",
            { _customer_id: walletCustomer.id }
          );
          const available = Number(balanceData?.balance_cents || 0);
          const pricedSoFar = Math.max(0, subtotal - membershipDiscount - newCustomerDiscount - creditCoverage - referralDiscountCents - promoDiscountCents);
          walletCreditCents = Math.min(requestedWallet, available, pricedSoFar);
          logStep("Wallet credit reserved", { requested: requestedWallet, available, applied: walletCreditCents });
        }
      }
    } catch (walletErr) {
      logStep("Wallet credit lookup failed (non-blocking)", { error: walletErr instanceof Error ? walletErr.message : String(walletErr) });
    }
    let totalAmount = Math.max(0, calc.totalCents - walletCreditCents);
    logStep("Base calculation (v4)", {
      subtotal,
      serviceTierDiscount,
      creditCoverage,
      referralDiscountCents,
      promoDiscountCents,
      walletCreditCents,
      totalAmount
    });
    const DEFAULT_BOOKING_PAY_PCT = 35;
    const cleanerPayoutCents = Math.floor(totalAmount * DEFAULT_BOOKING_PAY_PCT / 100);
    const platformFeeCents = totalAmount - cleanerPayoutCents;
    logStep("Payout calculation (revenue share)", {
      totalAmount,
      payPercentage: DEFAULT_BOOKING_PAY_PCT,
      cleanerPayoutCents,
      platformFeeCents
    });
    let amountToCharge = 0;
    let fullPaymentDiscount = 0;
    if (bookingData.useCredit) {
      amountToCharge = 100;
      logStep("Member using credit - $1 card authorization required", { depositAmount: amountToCharge });
    } else {
      amountToCharge = Math.max(100, Math.round(totalAmount * DEPOSIT_PERCENT2));
      logStep("50% deposit payment (paymentOption='full' ignored if sent)", {
        depositAmount: amountToCharge,
        totalAmount,
        clientSentPaymentOption: bookingData.paymentOption
      });
    }
    const customers = await stripe.customers.list({
      email: bookingData.email,
      limit: 1
    });
    let customerId;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      logStep("Found existing customer", { customerId });
    } else {
      const customer = await stripe.customers.create({
        email: bookingData.email,
        name: `${bookingData.firstName} ${bookingData.lastName}`,
        phone: bookingData.phone
      });
      customerId = customer.id;
      logStep("Created new customer", { customerId });
    }
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountToCharge,
      currency: "usd",
      customer: customerId,
      automatic_payment_methods: {
        enabled: true
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
        referralCode: referralCode || "",
        promoCode: promoCode || ""
      }
    });
    const paymentIntentId = paymentIntent.id;
    const clientSecret = paymentIntent.client_secret;
    logStep("Created payment intent", { paymentIntentId, amount: amountToCharge, bookingNumber });
    if (bookingData.startTime && bookingData.endTime) {
      logStep("Attempting to reserve time slot", {
        date: bookingData.serviceDate,
        startTime: bookingData.startTime,
        endTime: bookingData.endTime
      });
      await supabaseClient.from("availability_slots").upsert({
        service_date: bookingData.serviceDate,
        time_slot: bookingData.timeSlot,
        start_time: bookingData.startTime,
        end_time: bookingData.endTime,
        max_capacity: 5,
        current_bookings: 0
      }, {
        onConflict: "service_date,start_time",
        ignoreDuplicates: true
      });
      const { data: reserved, error: reserveError } = await supabaseClient.rpc("reserve_time_slot", {
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
    const { data: booking, error: bookingError } = await supabaseClient.from("bookings").insert({
      email: bookingData.email,
      first_name: bookingData.firstName,
      last_name: bookingData.lastName,
      phone: bookingData.phone,
      address: bookingData.address || "",
      city: bookingData.city || "",
      state: bookingData.state || "",
      zip_code: bookingData.zipCode,
      home_size_id: bookingData.homeSizeId,
      service_type: bookingData.serviceType,
      offer_type: bookingData.serviceType,
      // 'combo' / 'standard' / 'deep' — used by reports + GHL sync
      add_ons: incomingAddOns,
      service_date: bookingData.serviceDate,
      time_slot: bookingData.timeSlot,
      membership_plan: membershipPlan,
      uses_credit: bookingData.useCredit || false,
      base_price_cents: basePrice,
      deposit_cents: bookingData.paymentOption === "deposit" ? bookingData.useCredit ? 100 : amountToCharge : 0,
      total_estimate_cents: totalAmount,
      payment_intent_id: paymentIntentId,
      customer_id: customerId,
      status: "pending_payment",
      // CRITICAL: Always pending until payment verified
      // Always 'deposit' for customer-facing bookings — see comment
      // on amountToCharge above. Members using credit are also
      // recorded as 'deposit' since the $1 authorization is
      // functionally a deposit hold.
      payment_option: "deposit",
      full_payment_discount: fullPaymentDiscount,
      platform_fee_cents: platformFeeCents,
      cleaner_payout_cents: cleanerPayoutCents,
      payout_status: "pending",
      booking_number: bookingNumber,
      estimated_duration_hours: estimatedHours,
      team_notes: referralCode ? `Referral code used: ${referralCode}${promoCode ? ` | Promo code: PROMO:${promoCode}` : ""}${walletCreditCents > 0 ? ` | Wallet credit: $${(walletCreditCents / 100).toFixed(2)}` : ""}` : promoCode ? `Promo code: PROMO:${promoCode}${walletCreditCents > 0 ? ` | Wallet credit: $${(walletCreditCents / 100).toFixed(2)}` : ""}` : walletCreditCents > 0 ? `Wallet credit: $${(walletCreditCents / 100).toFixed(2)}` : null,
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
      first_visit_at: bookingData.firstVisitTimestamp || bookingData.tracking?.first_visit_timestamp || null
    }).select().single();
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
        requiresPayment: true,
        // ALWAYS true - no bookings without payment verification
        bookingNumber,
        isNewCustomer
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("Error in create-payment-intent", { error: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500
      }
    );
  }
});

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveSecret } from "../_shared/app-secrets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-expiry",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-CHECKOUT] ${step}${detailsStr}`);
};

// ─── Pricing (delegates to _shared/pricing.ts — v4 single SOT) ──────────
//
// This function bundles a membership sign-up Checkout Session with the
// member's first clean. The first-clean price uses the same v4 base
// table the customer sees on /book; the membership recurring price
// comes from the same MEMBERSHIP_PRICES table the React app reads.
import {
  HOME_SIZE_RANGES,
  SERVICE_TIER_PRICING,
  ADD_ONS as SHARED_ADD_ONS,
  MEMBERSHIP_PRICES,
  getServiceFinalPrice,
} from "../_shared/pricing.ts";
import {
  ghlIsConfigured,
  upsertContact,
  createOpportunity,
  fmtMoney,
} from "../_shared/ghl-client.ts";
import { buildGhlCustomFields } from "../_shared/ghl-field-map.ts";
import { sendSms } from "../_shared/sms.ts";

const ADD_ON_PRICING: Record<string, { label: string; price: number }> = {
  fridge:  { label: "Inside Fridge",     price: SHARED_ADD_ONS.fridge.price },
  oven:    { label: "Inside Oven",       price: SHARED_ADD_ONS.oven.price },
  windows: { label: "Interior Windows",  price: SHARED_ADD_ONS.windows.price },
};

const SERVICE_PRICING: Record<string, { label: string; multiplier: number }> = {
  standard:  { label: SERVICE_TIER_PRICING.standard.label,  multiplier: SERVICE_TIER_PRICING.standard.multiplier },
  deep:      { label: SERVICE_TIER_PRICING.deep.label,      multiplier: SERVICE_TIER_PRICING.deep.multiplier },
  moveInOut: { label: SERVICE_TIER_PRICING.moveInOut.label, multiplier: SERVICE_TIER_PRICING.moveInOut.multiplier },
};

const HOME_SIZE_PRICING = HOME_SIZE_RANGES.map((h) => ({ id: h.id, basePrice: h.standardPrice }));

const MEMBERSHIP_PLAN_LABELS: Record<string, string> = {
  monthly: 'Glow Monthly (1x/mo)',
  biweekly: 'Glow Bi-Weekly (2x/mo)',
  weekly: 'Glow Weekly (4x/mo)',
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");
    
    const body = await req.json();
    
    // ─── STANDALONE SUBSCRIPTION PATH ───────────────────
    if (body.mode === 'subscription' && body.membershipPlan && body.homeSizeId) {
      logStep("Standalone subscription path", { plan: body.membershipPlan, homeSize: body.homeSizeId });
      
      const {
        membershipPlan,
        homeSizeId,
        email: bodyEmail,
        // Optional scheduling preferences captured during signup so the
        // first booking can be scheduled immediately after checkout.
        preferredDayOfWeek,
        preferredTimeWindow,
        // Exact first-clean date/time when the membership signup comes
        // from the booking funnel (the customer already picked a slot).
        // The subscription webhook prefers these over the computed
        // preferred day.
        firstServiceDate,
        firstTimeSlot,
        firstName: bodyFirstName,
        lastName: bodyLastName,
        phone: bodyPhone,
        address: bodyAddress,
        city: bodyCity,
        state: bodyState,
        zipCode: bodyZip,
        // When an admin/VA kicks off a membership for an existing
        // booking, this links the subscription back to that booking row
        // so the webhook converts it to a membership clean instead of
        // creating a duplicate.
        existingBookingId,
        // First-clean deep-clean handling. Memberships historically forced
        // a mandatory +$75 deep clean on month one. We now ask the customer
        // whether their home has been professionally deep cleaned recently
        // and let them decline. `includeDeepClean` defaults to true for any
        // caller that doesn't send it (backwards compatible). When declined
        // we record it so the team/cleaner knows a surge may apply if the
        // home turns out to need a deep clean on arrival.
        includeDeepClean,
        deepCleanedBefore,
        // Admin / VA overrides (Internal Booking recurring path). These were
        // previously ignored on the subscription branch, so a price override
        // never reached Stripe and the deposit was never collected.
        //   priceOverride?: { total?: cents, deposit?: cents }
        //     total   — replaces the monthly recurring membership rate.
        //     deposit — one-time first-clean deposit added to the first
        //               invoice of the subscription Checkout.
        //   invoiceMode?  — 'deposit_plus_remaining' | 'deposit_plus_preauth'
        //                   | 'full_now' | 'none' (controls deposit posture)
        //   depositPercent? 0..1 (used to derive a deposit when an explicit
        //               priceOverride.deposit isn't supplied)
        priceOverride,
        invoiceMode,
        depositPercent,
        csrName,
        promoCode,
      } = body;
      const wantsDeepClean = includeDeepClean !== false;
      
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      );

      // Resolve Stripe key via the DB-override layer so SQL key
      // rotations propagate on next cold start.
      const stripeKey = await resolveSecret(supabase, "STRIPE_SECRET_KEY");
      const stripe = new Stripe(stripeKey, {
        apiVersion: "2025-08-27.basil",
      });

      // Resolve the customer's email. An explicitly supplied body email
      // ALWAYS wins — the admin/VA flow creates subscriptions on behalf of
      // a customer, so we must not let the caller's own auth token (e.g.
      // the signed-in admin) hijack the email. Only fall back to the auth
      // token's email when the body didn't carry one (the logged-in
      // self-serve /membership flow).
      let email = bodyEmail;
      if (!email) {
        const authHeader = req.headers.get("Authorization");
        if (authHeader) {
          const token = authHeader.replace("Bearer ", "");
          const { data } = await supabase.auth.getUser(token);
          if (data?.user?.email) {
            email = data.user.email;
          }
        }
      }

      // Email is preferred (lets us reuse an existing Stripe customer and
      // prefill the Checkout page) but NOT required. The public booking
      // funnel reaches the membership step before collecting an email, so
      // when it's missing we let Stripe Checkout collect it — subscription
      // mode always requires an email on Stripe's hosted page, and the
      // webhook reads it back off the resulting customer.

      // Look up membership price
      const prices = MEMBERSHIP_PRICES[homeSizeId];
      if (!prices) {
        return new Response(
          JSON.stringify({ error: `Invalid home size: ${homeSizeId}` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }

      const planKey = membershipPlan as keyof typeof prices;
      const catalogMonthlyDollars = prices[planKey];
      if (!catalogMonthlyDollars) {
        return new Response(
          JSON.stringify({ error: `Invalid membership plan: ${membershipPlan}` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }

      // ─── Admin price override + deposit resolution ──────────────────────
      // The monthly recurring price is the admin override when supplied,
      // otherwise the catalog rate. Stored in cents so it survives intact
      // through Stripe + the subscription webhook (which reads
      // `monthly_price_cents` back off the subscription metadata).
      const catalogMonthlyCents = Math.round(catalogMonthlyDollars * 100);
      const overrideTotalCents =
        priceOverride && typeof priceOverride.total === "number" &&
        priceOverride.total >= 0
          ? Math.round(priceOverride.total)
          : null;
      const monthlyPriceCents = overrideTotalCents ?? catalogMonthlyCents;
      const priceOverrideApplied = overrideTotalCents !== null;

      // First-clean deposit. Prefer an explicit cents amount from the caller
      // (so the hosted page charges exactly what the VA saw in the live
      // quote). Otherwise derive it from the deposit percent against the
      // monthly rate. Only deposit invoice modes collect a deposit here.
      const wantsDeposit =
        invoiceMode === "deposit_plus_remaining" ||
        invoiceMode === "deposit_plus_preauth";
      const depositPct = typeof depositPercent === "number"
        ? Math.max(0, Math.min(1, depositPercent))
        : 0.5;
      let depositCents = 0;
      if (priceOverride && typeof priceOverride.deposit === "number" &&
          priceOverride.deposit > 0) {
        depositCents = Math.round(priceOverride.deposit);
      } else if (wantsDeposit) {
        depositCents = Math.round(monthlyPriceCents * depositPct);
      }
      const collectsDeposit = wantsDeposit && depositCents > 0;

      const planLabel = MEMBERSHIP_PLAN_LABELS[membershipPlan] || membershipPlan;
      const homePricing = HOME_SIZE_PRICING.find(h => h.id === homeSizeId);
      const sqftLabel = homePricing ? homeSizeId.replace('_', '-') : homeSizeId;

      // Check for existing Stripe customer (only when we have an email to
      // match on — otherwise Stripe Checkout creates the customer).
      let customerId: string | undefined;
      if (email) {
        const customers = await stripe.customers.list({ email, limit: 1 });
        customerId = customers.data.length > 0 ? customers.data[0].id : undefined;
      }

      // ─── Build real Stripe Price objects for a Payment Link ─────────────
      // Payment Links require persisted Price ids (no inline price_data), so we
      // create a Product + a recurring Price at EXACTLY the amount entered in
      // the internal booking (override wins over catalog). This guarantees the
      // price the VA typed is the price Stripe charges — the inline price_data
      // path was not reliably reflecting the override.
      const membershipProduct = await stripe.products.create({
        name: `Novara Membership — ${planLabel}`,
        description: priceOverrideApplied
          ? `Recurring cleaning membership for ${sqftLabel} sq ft home (custom rate)`
          : `Recurring cleaning membership for ${sqftLabel} sq ft home`,
        metadata: {
          home_size_id: homeSizeId,
          membership_plan: membershipPlan,
          price_override_applied: priceOverrideApplied ? "true" : "false",
        },
      });

      const recurringPrice = await stripe.prices.create({
        product: membershipProduct.id,
        currency: "usd",
        unit_amount: monthlyPriceCents,
        recurring: { interval: "month" },
        nickname: `${planLabel} — ${fmtMoney(monthlyPriceCents)}/mo`,
      });

      const lineItems: Array<{ price: string; quantity: number }> = [
        { price: recurringPrice.id, quantity: 1 },
      ];

      // Optional one-time $75 first-clean deep clean (added to the first
      // invoice). Created as a one-time Price under the same product.
      if (wantsDeepClean) {
        const deepCleanPrice = await stripe.prices.create({
          product: membershipProduct.id,
          currency: "usd",
          unit_amount: 7500,
          nickname: "First Clean Deep Clean",
        });
        lineItems.push({ price: deepCleanPrice.id, quantity: 1 });
      }

      // Optional one-time first-clean deposit — the exact amount the VA saw in
      // the live quote, rolled into the subscription's first invoice.
      if (collectsDeposit) {
        const depositPrice = await stripe.prices.create({
          product: membershipProduct.id,
          currency: "usd",
          unit_amount: depositCents,
          nickname: "First Clean Deposit",
        });
        lineItems.push({ price: depositPrice.id, quantity: 1 });
      }

      // ─── Map the membership/recurring lead into GHL NOW ─────────────────
      // Previously a recurring membership only reached GHL AFTER the customer
      // paid (the customer.subscription.created webhook). That meant a VA who
      // created an Internal Booking recurring signup saw NOTHING in the CRM
      // until conversion — "recurring internal bookings don't map to GHL at
      // all". Upsert the contact + an OPEN membership opportunity here, then
      // thread the ids through Stripe metadata so the webhook promotes the
      // SAME opportunity to "won" on payment instead of creating a duplicate.
      // Fully best-effort: a GHL hiccup never blocks the checkout link.
      let ghlContactId = "";
      let ghlOpportunityId = "";
      if (ghlIsConfigured() && (email || bodyPhone)) {
        try {
          const GLOW_LABEL: Record<string, string> = {
            monthly: "Monthly", biweekly: "Bi-Weekly", weekly: "Weekly",
          };
          const leadName = [bodyFirstName, bodyLastName].filter(Boolean).join(" ").trim();

          // Build the FULL, canonical custom-field bag — the exact same mapper
          // one-time customer bookings use — so a recurring/membership internal
          // booking maps with the same fields and formatting (service date/
          // time, home size, address market, deposit, csr, billing/service
          // frequency, monthly totals, etc.). Previously the recurring path
          // sent a thin ~12-field subset, so the CRM record looked half-empty
          // and inconsistent with customer bookings.
          const baseFields = buildGhlCustomFields({
            booking: {
              email: email || undefined,
              phone: bodyPhone || undefined,
              first_name: bodyFirstName || undefined,
              last_name: bodyLastName || undefined,
              service_type: "standard",
              service_date: firstServiceDate ? String(firstServiceDate) : undefined,
              time_slot: (firstTimeSlot || preferredTimeWindow)
                ? String(firstTimeSlot || preferredTimeWindow)
                : undefined,
              home_size_id: homeSizeId,
              membership_plan: membershipPlan,
              base_price_cents: monthlyPriceCents,
              total_estimate_cents: monthlyPriceCents,
              deposit_cents: collectsDeposit ? depositCents : 0,
              payment_option: collectsDeposit ? "deposit" : "full",
              address: bodyAddress || undefined,
              city: bodyCity || undefined,
              state: bodyState || undefined,
              zip_code: bodyZip || undefined,
              sdr_rep_name: csrName ? String(csrName) : undefined,
              booking_channel: "internal",
              status: "pending_payment",
            },
            cleaners: [],
            stripeCustomerId: customerId || undefined,
          });

          // Membership-lead specifics that override the generic mapper:
          // the lead hasn't paid yet (mapper would mark a plan-bearing row
          // "Active"), and capture the preferred cadence + headline price.
          const membershipCustomFields = {
            ...baseFields,
            membership_status: "Not Started",
            membership_plan: membershipPlan,
            novara_glow_plan: GLOW_LABEL[membershipPlan] || "",
            monthly_membership_price: fmtMoney(monthlyPriceCents),
            preferred_day_of_week: preferredDayOfWeek ? String(preferredDayOfWeek) : "",
            preferred_time_window: preferredTimeWindow ? String(preferredTimeWindow) : "",
          };
          ghlContactId = (await upsertContact({
            email: email || undefined,
            phone: bodyPhone || undefined,
            firstName: bodyFirstName || undefined,
            lastName: bodyLastName || undefined,
            address1: bodyAddress || undefined,
            city: bodyCity || undefined,
            state: bodyState || undefined,
            postalCode: bodyZip || undefined,
            source: "Novara Membership Signup",
            tags: ["membership", "lead - new", `member-${membershipPlan}`],
            customFieldsByKey: membershipCustomFields,
          })) || "";
          if (ghlContactId) {
            ghlOpportunityId = (await createOpportunity({
              contactId: ghlContactId,
              name: `Novara Membership — ${planLabel}${leadName ? ` (${leadName})` : email ? ` (${email})` : ""}`,
              status: "open",
              monetaryValue: monthlyPriceCents ? Math.round(monthlyPriceCents / 100) : undefined,
              source: "Novara Membership Signup",
              customFieldsByKey: membershipCustomFields,
            })) || "";
          }
          logStep("GHL membership lead mapped", { ghlContactId, ghlOpportunityId });
        } catch (ghlErr) {
          logStep("GHL membership lead mapping failed (non-blocking)", {
            error: ghlErr instanceof Error ? ghlErr.message : String(ghlErr),
          });
        }
      }

      // Push the schedule + customer hints into both the Checkout
      // Session metadata AND the resulting Subscription metadata. The
      // subscription metadata is what the `customer.subscription.*`
      // webhook handler reads — without it the handler has no way to
      // tell `monthly` from `weekly` once the new Stripe account has
      // no hard-coded price IDs.
      const sharedMetadata: Record<string, string> = {
        membership_plan: membershipPlan,
        home_size_id: homeSizeId,
        is_membership_signup: 'true',
        monthly_price_cents: String(monthlyPriceCents),
        price_override_applied: priceOverrideApplied ? 'true' : 'false',
        catalog_monthly_price_cents: String(catalogMonthlyCents),
        deposit_cents: String(collectsDeposit ? depositCents : 0),
        invoice_mode: invoiceMode ? String(invoiceMode) : '',
        csr_name: csrName ? String(csrName) : '',
        promo_code: promoCode ? String(promoCode) : '',
        preferred_day_of_week: preferredDayOfWeek ? String(preferredDayOfWeek) : '',
        preferred_time_window: preferredTimeWindow ? String(preferredTimeWindow) : '',
        first_service_date: firstServiceDate ? String(firstServiceDate) : '',
        first_time_slot: firstTimeSlot ? String(firstTimeSlot) : '',
        existing_booking_id: existingBookingId ? String(existingBookingId) : '',
        deep_clean_included: wantsDeepClean ? 'true' : 'false',
        deep_cleaned_before: deepCleanedBefore ? String(deepCleanedBefore) : '',
        first_name: bodyFirstName ? String(bodyFirstName) : '',
        last_name: bodyLastName ? String(bodyLastName) : '',
        phone: bodyPhone ? String(bodyPhone) : '',
        address: bodyAddress ? String(bodyAddress) : '',
        city: bodyCity ? String(bodyCity) : '',
        state: bodyState ? String(bodyState) : '',
        zip_code: bodyZip ? String(bodyZip) : '',
        // GHL ids of the pre-created membership lead so the subscription
        // webhook promotes the SAME contact/opportunity to "won" on payment
        // instead of spawning a duplicate.
        ghl_contact_id: ghlContactId,
        ghl_opportunity_id: ghlOpportunityId,
      };

      // ─── Create a Payment Link (replaces Checkout Sessions) ─────────────
      // A reusable hosted link the customer opens to start their subscription.
      // The subscription metadata is what the customer.subscription.* webhook
      // reads to provision credits + auto-book the first clean.
      const paymentLink = await stripe.paymentLinks.create({
        line_items: lineItems,
        metadata: sharedMetadata,
        subscription_data: {
          metadata: sharedMetadata,
          description: `Novara ${planLabel} — ${homeSizeId.replace('_', '-')} sqft`,
        },
        phone_number_collection: { enabled: true },
        allow_promotion_codes: true,
        after_completion: {
          type: "redirect",
          redirect: { url: `${req.headers.get("origin")}/membership/success?plan=${membershipPlan}` },
        },
      });

      const session = { id: paymentLink.id, url: paymentLink.url };

      logStep("Subscription payment link created", {
        paymentLinkId: paymentLink.id,
        monthlyPriceCents,
        priceOverrideApplied,
        depositCents: collectsDeposit ? depositCents : 0,
        invoiceMode: invoiceMode || null,
      });

      // ─── Send the checkout link to the CUSTOMER (not just the admin) ────
      // Internal bookings previously only surfaced the link to the VA, so the
      // customer never received it. Text + email the link to the customer by
      // default (caller can opt out with notifyCustomer:false). Best-effort —
      // a delivery hiccup never blocks returning the link to the admin.
      const notify: { sms: boolean; email: boolean } = { sms: false, email: false };
      const wantNotify = body.notifyCustomer !== false;
      if (wantNotify && session.url) {
        const firstNm = bodyFirstName ? String(bodyFirstName) : "there";
        const planNm = MEMBERSHIP_PLAN_LABELS[membershipPlan] || planLabel;
        const dateBit = firstServiceDate ? ` Your first clean is set for ${firstServiceDate}.` : "";
        if (bodyPhone) {
          try {
            notify.sms = await sendSms(supabase, {
              toPhone: String(bodyPhone),
              type: "confirmation",
              message: `Hi ${firstNm}! Here's your secure Novara ${planNm} signup link: ${session.url} — add your card to activate your membership.${dateBit}`,
            });
          } catch (smsErr) {
            logStep("Customer membership SMS failed (non-blocking)", {
              error: smsErr instanceof Error ? smsErr.message : String(smsErr),
            });
          }
        }
        if (email) {
          try {
            await supabase.functions.invoke("send-membership-email", {
              body: {
                type: "checkout_link",
                email,
                data: {
                  name: firstNm,
                  plan: planNm,
                  url: session.url,
                  monthlyAmount: monthlyPriceCents,
                  depositAmount: collectsDeposit ? depositCents : 0,
                  firstServiceDate: firstServiceDate ? String(firstServiceDate) : "",
                },
              },
            });
            notify.email = true;
          } catch (emailErr) {
            logStep("Customer membership email failed (non-blocking)", {
              error: emailErr instanceof Error ? emailErr.message : String(emailErr),
            });
          }
        }
      }

      return new Response(
        JSON.stringify({ url: session.url, sessionId: session.id, notify }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // ─── BOOKING CHECKOUT PATH (existing) ───────────────
    const { bookingData } = body;
    logStep("Booking data received", { 
      serviceType: bookingData.serviceType, 
      homeSizeId: bookingData.homeSizeId,
      membershipPlan: bookingData.membershipPlan,
      useCredit: bookingData.useCredit 
    });

    const {
      homeSizeId,
      serviceType,
      addOns = [],
      membershipPlan,
      useCredit,
      email,
      firstName,
      lastName,
      phone,
      address,
      city,
      state,
      zipCode,
      serviceDate,
      timeSlot
    } = bookingData;

    // === SERVER-SIDE VALIDATION ===
    const validationErrors: string[] = [];
    
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) validationErrors.push("Valid email is required");
    if (!firstName || firstName.trim().length < 2) validationErrors.push("First name must be at least 2 characters");
    if (!lastName || lastName.trim().length < 2) validationErrors.push("Last name must be at least 2 characters");
    if (!phone || !/^\d{10}$/.test(phone.replace(/\D/g, ''))) validationErrors.push("Valid 10-digit phone number is required");
    if (!address || address.trim().length < 5) validationErrors.push("Complete street address is required");
    if (address && !/\d+/.test(address)) validationErrors.push("Address must include a street number");
    if (!city || city.trim().length < 2) validationErrors.push("Valid city name is required");
    if (!state || !/^[A-Z]{2}$/i.test(state)) validationErrors.push("Valid 2-letter state code is required");
    if (!zipCode || !/^\d{5}$/.test(zipCode)) validationErrors.push("Valid 5-digit ZIP code is required");
    if (!homeSizeId) validationErrors.push("Home size selection is required");
    if (!serviceType) validationErrors.push("Service type is required");
    if (!serviceDate) validationErrors.push("Service date is required");
    if (!timeSlot) validationErrors.push("Time slot is required");
    
    if (validationErrors.length > 0) {
      logStep("Validation failed", { errors: validationErrors });
      return new Response(
        JSON.stringify({ error: "Validation failed", details: validationErrors }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }
    
    logStep("Validation passed");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const stripeKey = await resolveSecret(supabase, "STRIPE_SECRET_KEY");
    const stripe = new Stripe(stripeKey, {
      apiVersion: "2025-08-27.basil",
    });

    const isMemberUsingCredit = useCredit === true;
    
    // Check for existing Stripe customer
    const customers = await stripe.customers.list({ email, limit: 1 });
    let customerId = customers.data.length > 0 ? customers.data[0].id : undefined;

    let lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

    // Get base price for home size
    const homePricing = HOME_SIZE_PRICING.find(h => h.id === homeSizeId);
    if (!homePricing) {
      throw new Error(`Invalid home size: ${homeSizeId}`);
    }
    
    const servicePricing = SERVICE_PRICING[serviceType as keyof typeof SERVICE_PRICING];
    if (!servicePricing) {
      throw new Error(`Invalid service type: ${serviceType}`);
    }

    // v4: use the per-service final price (15%/25%/combo rule applied).
    const totalServicePrice = getServiceFinalPrice(homeSizeId, serviceType, "B");

    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: {
          name: `${servicePricing.label} (${homeSizeId.replace('_', '-')} sqft)`,
          description: `Cleaning service for ${homeSizeId.replace('_', '-')} sq ft home`,
        },
        unit_amount: Math.round(totalServicePrice * 100),
      },
      quantity: 1,
    });
    logStep("Added service to line items (v4 pricing)", { homeSizeId, serviceType, totalServicePrice });
    
    // Add-ons
    if (addOns.length > 0) {
      addOns.forEach((addon: string) => {
        if (serviceType === 'moveInOut' && (addon === 'fridge' || addon === 'oven')) {
          logStep(`Skipping ${addon} - included in Move-In/Out`);
          return;
        }
        
        const addonPricing = ADD_ON_PRICING[addon as keyof typeof ADD_ON_PRICING];
        if (!addonPricing) {
          logStep(`Unknown add-on: ${addon}`);
          return;
        }
        
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: {
              name: addonPricing.label,
              description: `Add-on service: ${addonPricing.label}`,
            },
            unit_amount: addonPricing.price * 100,
          },
          quantity: 1,
        });
        logStep(`Added ${addon} add-on`, { price: addonPricing.price });
      });
    }

    logStep("Line items built", { count: lineItems.length });

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : email,
      line_items: lineItems,
      mode: 'payment',
      success_url: `${req.headers.get("origin")}/book/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.get("origin")}/book/checkout`,
      metadata: {
        booking_data: JSON.stringify(bookingData),
        use_credit: String(useCredit),
        service_type: serviceType,
        home_size_id: homeSizeId,
        is_membership_signup: 'false',
      },
      payment_intent_data: {
        setup_future_usage: "off_session",
      },
      ...(isMemberUsingCredit && {
        payment_method_collection: "always",
      }),
    });

    logStep("Checkout session created", { sessionId: session.id, url: session.url });

    // Store provisional booking
    const depositCents = useCredit ? 0 : 3900;
    const totalEstimateCents = totalServicePrice * 100;

    const { data: booking, error: dbError } = await supabase
      .from('bookings')
      .insert({
        email,
        first_name: firstName,
        last_name: lastName,
        phone,
        address,
        city,
        state,
        zip_code: zipCode,
        home_size_id: homeSizeId,
        service_type: serviceType,
        add_ons: addOns,
        membership_plan: membershipPlan,
        uses_credit: useCredit,
        service_date: serviceDate,
        time_slot: timeSlot,
        base_price_cents: Math.round(totalServicePrice * 100),
        deposit_cents: depositCents,
        total_estimate_cents: totalEstimateCents,
        checkout_session_id: session.id,
        status: 'pending_payment',
      })
      .select()
      .single();

    if (dbError) {
      logStep("Database error", dbError);
    } else {
      logStep("Booking created in database", { bookingId: booking.id });
    }

    return new Response(
      JSON.stringify({ url: session.url, sessionId: session.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

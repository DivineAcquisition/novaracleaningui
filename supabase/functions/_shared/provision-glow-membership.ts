// Shared Glow membership provisioning after a Stripe subscription is PAID.
// Used by customer.subscription.created (Payment Link — already active) and
// customer.subscription.updated (on-site Payment Element — incomplete → active).

import Stripe from "https://esm.sh/stripe@18.5.0";
import { pingEnsureMembershipAgreement } from "./ensure-membership-agreement.ts";
import { memberTag } from "./ghl-tags.ts";

// deno-lint-ignore no-explicit-any
type AnyClient = any;

export async function provisionGlowMembership(opts: {
  stripe: Stripe;
  supabase: AnyClient;
  subscription: Stripe.Subscription;
  // deno-lint-ignore no-explicit-any
  sendMembershipEmail: (type: string, email: string, data: any) => Promise<void>;
  logStep: (step: string, details?: unknown) => void;
}): Promise<void> {
  const { stripe, supabase, subscription, sendMembershipEmail, logStep } = opts;
  const status = String(subscription.status || "");
  if (status === "incomplete" || status === "incomplete_expired" || status === "canceled") {
    logStep("Skip Glow provisioning — subscription not paid yet", { subscriptionId: subscription.id, status });
    return;
  }

  const customerId = subscription.customer as string;
  logStep("Provisioning Glow membership", { subscriptionId: subscription.id, status });

  const subMeta = (subscription.metadata || {}) as Record<string, string>;
  const priceId = subscription.items.data[0]?.price.id;
  const unitAmount = subscription.items.data[0]?.price.unit_amount || 0;
  const LEGACY_PRICE_MAP: Record<string, string> = {
    price_1SR2UhGc7k6gIVcMiKbuq1mo: "monthly",
    price_1SR2VNGc7k6gIVcMMI6Fuxga: "biweekly",
    price_1SR2VYGc7k6gIVcML2W0jVKS: "weekly",
  };
  let plan: string = subMeta.membership_plan
    || LEGACY_PRICE_MAP[priceId]
    || (unitAmount >= 60000 ? "weekly" : unitAmount >= 25000 ? "biweekly" : "monthly");
  if (!["monthly", "biweekly", "weekly"].includes(plan)) plan = "monthly";

  const creditsPerMonth = { monthly: 1, biweekly: 2, weekly: 4 }[plan] || 1;
  const planLabels: Record<string, string> = {
    monthly: "Novara Monthly",
    biweekly: "Novara Bi-Weekly",
    weekly: "Novara Weekly",
  };

  const customer = await stripe.customers.retrieve(customerId);
  const email = (customer as Stripe.Customer).email || "";
  const name = (customer as Stripe.Customer).name || "";
  const phone = (customer as Stripe.Customer).phone || subMeta.phone || "";

  const monthlyPriceCentsMeta = subMeta.monthly_price_cents
    ? parseInt(subMeta.monthly_price_cents, 10) || unitAmount
    : unitAmount;

  // deno-lint-ignore no-explicit-any
  const subAny = subscription as any;
  // deno-lint-ignore no-explicit-any
  const itemAny = subscription.items?.data?.[0] as any;
  const periodStart = itemAny?.current_period_start ?? subAny.current_period_start;
  const periodEnd = itemAny?.current_period_end ?? subAny.current_period_end;

  const { data: existingCredits } = await supabase
    .from("membership_credits")
    .select("subscription_id, status")
    .eq("subscription_id", subscription.id)
    .maybeSingle();
  if (existingCredits?.status === "active") {
    logStep("Glow membership already provisioned", { subscriptionId: subscription.id });
    return;
  }

  const { error: creditsError } = await supabase
    .from("membership_credits")
    .upsert({
      customer_id: customerId,
      email,
      membership_plan: plan,
      credits_per_month: creditsPerMonth,
      credits_remaining: creditsPerMonth,
      credits_used: 0,
      current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      subscription_id: subscription.id,
      credit_available_date: new Date().toISOString(),
      home_size_id: subMeta.home_size_id || null,
      monthly_price_cents: monthlyPriceCentsMeta || null,
      preferred_day_of_week: subMeta.preferred_day_of_week || null,
      preferred_time_window: subMeta.preferred_time_window || null,
      status: "active",
    });

  if (creditsError) {
    logStep("Error creating membership credits", creditsError);
    return;
  }
  logStep("Membership credits upserted", { customerId, plan, credits: creditsPerMonth });

  try {
    const { data: existingCustomer } = await supabase
      .from("customers")
      .select("id, referral_code")
      .eq("email", email)
      .maybeSingle();

    let customerRecord = existingCustomer;
    if (!existingCustomer) {
      const { data: newCustomer, error: customerError } = await supabase
        .from("customers")
        .insert({
          email,
          first_name: name.split(" ")[0] || "",
          last_name: name.split(" ").slice(1).join(" ") || "",
        })
        .select()
        .single();
      if (customerError) logStep("Error creating customer", customerError);
      else customerRecord = newCustomer;
    }

    if (customerRecord && !customerRecord.referral_code) {
      const referralResponse = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-referral-code`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
        },
        body: JSON.stringify({ customerId: customerRecord.id, email }),
      });
      if (referralResponse.ok) {
        const { code } = await referralResponse.json();
        logStep("Referral code generated", { code, customerId: customerRecord.id });
      }
    }
  } catch (referralError) {
    logStep("Error handling referral code (non-blocking)", { error: referralError });
  }

  await sendMembershipEmail("welcome", email, {
    name,
    plan: planLabels[plan],
    credits: creditsPerMonth,
  });

  // In-funnel members sign the membership agreement on /book/details.
  // Payment Link / VA paths still get the once-per-email DocuSeal copy.
  if (!subMeta.existing_booking_id && subMeta.funnel !== "book") {
    try {
      const serviceAddress = [
        subMeta.address,
        subMeta.city,
        [subMeta.state, subMeta.zip_code].filter(Boolean).join(" "),
      ].filter(Boolean).join(", ");
      await pingEnsureMembershipAgreement(supabase, {
        email,
        name,
        phone,
        plan: planLabels[plan] || plan,
        serviceAddress: serviceAddress || null,
        firstServiceDate: subMeta.first_service_date || null,
        membershipRateCents: monthlyPriceCentsMeta || null,
        homeSizeId: subMeta.home_size_id || null,
      });
    } catch (agErr) {
      logStep("membership agreement ensure failed (non-blocking)", {
        error: agErr instanceof Error ? agErr.message : String(agErr),
      });
    }
  }

  try {
    await supabase
      .from("customers")
      .upsert({
        email,
        first_name: subMeta.first_name || (name.split(" ")[0] || ""),
        last_name: subMeta.last_name || (name.split(" ").slice(1).join(" ") || ""),
        phone: phone || null,
        address: subMeta.address || null,
        city: subMeta.city || null,
        state: subMeta.state || null,
        zip: subMeta.zip_code || null,
        membership_status: "active",
        membership_plan: plan,
        preferred_day_of_week: subMeta.preferred_day_of_week || null,
        preferred_time_window: subMeta.preferred_time_window || null,
      }, { onConflict: "email" });
  } catch (custErr) {
    logStep("customers upsert failed (non-blocking)", {
      error: custErr instanceof Error ? custErr.message : String(custErr),
    });
  }

  try {
    const { upsertContact, createOpportunity, updateOpportunity, fmtMoney } =
      await import("./ghl-client.ts");
    let salesPipelineId: string | undefined;
    let salesStageId: string | undefined;
    try {
      const { data: secs } = await supabase
        .from("app_secrets")
        .select("key, value")
        .in("key", ["GHL_SALES_PIPELINE_ID", "GHL_SALES_PIPELINE_STAGE_ID"]);
      for (const s of secs || []) {
        if (s.key === "GHL_SALES_PIPELINE_ID" && s.value) salesPipelineId = String(s.value).trim();
        if (s.key === "GHL_SALES_PIPELINE_STAGE_ID" && s.value) salesStageId = String(s.value).trim();
      }
    } catch (_) { /* fall back */ }

    const contactId = await upsertContact({
      email,
      phone: phone || null,
      firstName: subMeta.first_name || (name.split(" ")[0] || null),
      lastName: subMeta.last_name || (name.split(" ").slice(1).join(" ") || null),
      address1: subMeta.address || null,
      city: subMeta.city || null,
      state: subMeta.state || null,
      postalCode: subMeta.zip_code || null,
      source: "Novara Membership Signup",
      tags: ["member", memberTag(plan)].filter(Boolean) as string[],
      mergeTags: true,
      customFieldsByKey: {
        membership_status: "Active",
        membership_plan: plan,
        cleaning_type: planLabels[plan],
        market: subMeta.state || undefined,
        customer_source: "Novara Membership",
        stripe_customer_id: customerId,
        monthly_membership_price: fmtMoney(monthlyPriceCentsMeta),
        preferred_day_of_week: subMeta.preferred_day_of_week || undefined,
        preferred_time_window: subMeta.preferred_time_window || undefined,
      },
    });

    const preOppId = (subMeta.ghl_opportunity_id || "").trim();
    const oppName = `Novara Membership — ${planLabels[plan]} (${(name || email).trim()})`;
    const oppMonetary = monthlyPriceCentsMeta ? Math.round(monthlyPriceCentsMeta / 100) : undefined;
    const oppCustomFields = {
      membership_plan: plan,
      membership_status: "Active",
      preferred_day_of_week: subMeta.preferred_day_of_week || undefined,
      preferred_time_window: subMeta.preferred_time_window || undefined,
    };
    if (preOppId) {
      await updateOpportunity(preOppId, {
        name: oppName,
        status: "won",
        monetaryValue: oppMonetary,
        pipelineId: salesPipelineId,
        pipelineStageId: salesStageId,
        customFieldsByKey: oppCustomFields,
      });
      logStep("GHL membership opportunity promoted to won", { preOppId });
    } else if (contactId) {
      await createOpportunity({
        contactId,
        name: oppName,
        status: "won",
        source: "Novara Membership Signup",
        pipelineId: salesPipelineId,
        pipelineStageId: salesStageId,
        monetaryValue: oppMonetary,
        customFieldsByKey: oppCustomFields,
      });
    }
    logStep("GHL membership sync complete", { email, plan });
  } catch (ghlErr) {
    logStep("GHL membership sync failed (non-blocking)", {
      error: ghlErr instanceof Error ? ghlErr.message : String(ghlErr),
    });
  }

  try {
    const { mirrorToLeadConnector } = await import("./leadconnector-mirror.ts");
    await mirrorToLeadConnector({
      event: "membership.created",
      payload: {
        email,
        phone,
        name,
        plan,
        planLabel: planLabels[plan],
        creditsPerMonth,
        stripeCustomerId: customerId,
        subscriptionId: subscription.id,
        homeSizeId: subMeta.home_size_id || null,
        monthlyPriceCents: monthlyPriceCentsMeta,
        preferredDayOfWeek: subMeta.preferred_day_of_week || null,
        preferredTimeWindow: subMeta.preferred_time_window || null,
      },
    });
  } catch (mirrorErr) {
    logStep("LeadConnector mirror failed (non-blocking)", {
      error: mirrorErr instanceof Error ? mirrorErr.message : String(mirrorErr),
    });
  }

  if (phone && subMeta.funnel !== "book") {
    try {
      const { sendSms } = await import("./sms.ts");
      const dayLabel = subMeta.preferred_day_of_week
        ? subMeta.preferred_day_of_week.charAt(0).toUpperCase() + subMeta.preferred_day_of_week.slice(1)
        : null;
      const windowLabel = subMeta.preferred_time_window || null;
      const preferenceLine = dayLabel
        ? ` We'll prefer ${dayLabel}${windowLabel ? ` (${windowLabel})` : ""} for your recurring cleans.`
        : "";
      const smsMessage =
        `Novara: Welcome to ${planLabels[plan]}! ${creditsPerMonth} credit${creditsPerMonth > 1 ? "s" : ""}/mo unlocked.${preferenceLine} ` +
        `Schedule your first clean: https://app.novaracleaning.com/portal/book — Reply HELP for help.`;
      await sendSms(supabase, { toPhone: phone, message: smsMessage, type: "confirmation" });
    } catch (smsErr) {
      logStep("Welcome SMS failed (non-blocking)", {
        error: smsErr instanceof Error ? smsErr.message : String(smsErr),
      });
    }
  }

  try {
    const DOW_MAP: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6,
    };

    if (subMeta.existing_booking_id) {
      const wantsDeep = subMeta.deep_clean_included !== "false";
      const { data: existingRow } = await supabase
        .from("bookings")
        .select("add_ons, team_notes")
        .eq("id", subMeta.existing_booking_id)
        .maybeSingle();
      const addOns = Array.isArray(existingRow?.add_ons) ? [...existingRow.add_ons] : [];
      if (wantsDeep && !addOns.includes("firstCleanDeep")) addOns.push("firstCleanDeep");
      const skipBit = wantsDeep
        ? ""
        : " First-clean deep declined; surge may apply if condition requires a reset.";
      const { error: linkErr } = await supabase
        .from("bookings")
        .update({
          membership_plan: plan,
          uses_credit: true,
          customer_id: customerId,
          add_ons: addOns,
          ...(skipBit && !String(existingRow?.team_notes || "").includes("First-clean deep declined")
            ? { team_notes: `${existingRow?.team_notes || ""}${existingRow?.team_notes ? " ·" : ""}${skipBit}`.trim() }
            : {}),
        })
        .eq("id", subMeta.existing_booking_id);
      if (linkErr) {
        logStep("Linking existing booking to membership failed (non-blocking)", { error: linkErr.message });
      } else {
        logStep("Linked existing booking to new membership", { bookingId: subMeta.existing_booking_id, plan });
      }
    } else if (subMeta.home_size_id && subMeta.address && subMeta.city && subMeta.state) {
      let autoServiceDate: string | null = null;
      let autoTimeSlot = subMeta.first_time_slot || subMeta.preferred_time_window || "10:00 AM - 12:00 PM";

      if (subMeta.first_service_date && /^\d{4}-\d{2}-\d{2}$/.test(subMeta.first_service_date)) {
        autoServiceDate = subMeta.first_service_date;
      } else if (subMeta.preferred_day_of_week) {
        const targetDow = DOW_MAP[subMeta.preferred_day_of_week.toLowerCase()];
        if (targetDow !== undefined) {
          const candidate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
          candidate.setHours(0, 0, 0, 0);
          while (candidate.getDay() !== targetDow) {
            candidate.setDate(candidate.getDate() + 1);
          }
          autoServiceDate = candidate.toISOString().split("T")[0];
        }
      }

      if (autoServiceDate) {
        const autoDepositCents = subMeta.deposit_cents ? parseInt(subMeta.deposit_cents, 10) || 0 : 0;
        const wantsDeep = subMeta.deep_clean_included !== "false";
        const autoTeamNotes = [
          autoDepositCents > 0
            ? `MEMBERSHIP AUTO-BOOKING — $${(autoDepositCents / 100).toFixed(2)} first-clean deposit collected at signup. Confirm date with customer before dispatching`
            : "MEMBERSHIP AUTO-BOOKING — confirm date with customer before dispatching",
          wantsDeep
            ? "Includes first-clean deep."
            : "First-clean deep declined; surge may apply if condition requires a reset.",
        ].join(" ");

        const { error: autoBookErr } = await supabase.from("bookings").insert({
          email,
          first_name: subMeta.first_name || (name.split(" ")[0] || ""),
          last_name: subMeta.last_name || (name.split(" ").slice(1).join(" ") || ""),
          phone: phone || "",
          address: subMeta.address,
          city: subMeta.city,
          state: subMeta.state,
          zip_code: subMeta.zip_code || "",
          home_size_id: subMeta.home_size_id,
          service_type: wantsDeep ? "deep" : "standard",
          add_ons: wantsDeep ? ["firstCleanDeep"] : [],
          membership_plan: plan,
          uses_credit: true,
          service_date: autoServiceDate,
          time_slot: autoTimeSlot,
          base_price_cents: 0,
          deposit_cents: autoDepositCents,
          total_estimate_cents: autoDepositCents,
          status: "pending_details",
          customer_id: customerId,
          team_notes: autoTeamNotes,
        });

        if (autoBookErr) {
          logStep("Auto-booking creation failed (non-blocking)", { error: autoBookErr.message });
        } else {
          logStep("Auto-booking created for new member", { autoServiceDate, autoTimeSlot, plan, email });
        }
      }
    }
  } catch (autoErr) {
    logStep("First-clean handling error (non-blocking)", {
      error: autoErr instanceof Error ? autoErr.message : String(autoErr),
    });
  }
}

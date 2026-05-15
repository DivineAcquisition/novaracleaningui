import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { sendSms, formatServiceDate } from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[COMPLETE-BOOKING] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bookingId, cleanerId } = await req.json();
    logStep("Marking booking complete", { bookingId });
    
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get user from auth header (if present)
    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: userData } = await supabase.auth.getUser(token);
      userId = userData?.user?.id ?? null;
    }

    // Fetch booking first (needed to verify cleaner assignment)
    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .single();

    if (fetchError || !booking) {
      throw new Error("Booking not found");
    }

    if (!booking.cleaner_id) {
      throw new Error("No cleaner assigned to this booking");
    }

    // Auth check: admin OR assigned cleaner
    let isAuthorized = false;

    if (userId) {
      // JWT path: check if admin
      const { data: roleCheck } = await supabase
        .from("user_roles")
        .select("*")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();
      
      if (roleCheck) {
        isAuthorized = true;
      } else {
        // Check if user is the assigned cleaner
        const { data: cleaner } = await supabase
          .from("cleaners")
          .select("user_id")
          .eq("id", booking.cleaner_id)
          .single();
        if (cleaner?.user_id === userId) {
          isAuthorized = true;
        }
      }
    }

    // No JWT: allow if cleanerId in body matches booking.cleaner_id (public /contractor/jobs page)
    if (!isAuthorized && cleanerId && cleanerId === booking.cleaner_id) {
      isAuthorized = true;
    }

    if (!isAuthorized) {
      throw new Error("Unauthorized");
    }

    logStep("Booking validated");

    // Mark booking as completed
    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", bookingId);

    if (updateError) throw updateError;

    logStep("Booking marked complete, charging remaining balance");

    // ─── Auto-charge remaining balance off-session ──────────────────────
    // For deposit bookings, charge the remaining 50% to the saved card.
    // For paid-in-full bookings, this is a no-op. Idempotent: if we've
    // already charged (balance_payment_intent_id set), skip.
    let balanceChargeStatus: "skipped_full_payment" | "skipped_no_balance" |
      "already_charged" | "charged" | "failed" = "skipped_no_balance";
    let balanceChargeError: string | null = null;
    try {
      const remainingCents = Math.max(
        0,
        (booking.total_estimate_cents || 0) - (booking.deposit_cents || 0),
      );
      if (booking.payment_option === "full") {
        balanceChargeStatus = "skipped_full_payment";
        logStep("No balance charge needed — paid in full");
      } else if (remainingCents <= 0) {
        balanceChargeStatus = "skipped_no_balance";
        logStep("No balance to charge");
      } else if (booking.balance_payment_intent_id) {
        balanceChargeStatus = "already_charged";
        logStep("Balance already charged on a previous call");
      } else {
        const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
        if (!stripeKey) {
          throw new Error("STRIPE_SECRET_KEY not configured");
        }
        const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

        // Resolve the Stripe customer + saved payment method.
        let customerId: string | null = null;
        if (booking.customer_id && typeof booking.customer_id === "string" && booking.customer_id.startsWith("cus_")) {
          customerId = booking.customer_id;
        } else {
          const found = await stripe.customers.list({ email: booking.email, limit: 1 });
          customerId = found.data[0]?.id ?? null;
        }
        if (!customerId) {
          throw new Error(`No Stripe customer found for ${booking.email}`);
        }

        const pms = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
        const pmId = pms.data[0]?.id;
        if (!pmId) {
          throw new Error("No saved card on file for off-session charge");
        }

        const charge = await stripe.paymentIntents.create({
          amount: remainingCents,
          currency: "usd",
          customer: customerId,
          payment_method: pmId,
          off_session: true,
          confirm: true,
          description: `Remaining balance — ${booking.service_type} clean on ${booking.service_date}`,
          metadata: {
            bookingId,
            bookingNumber: String(booking.booking_number ?? ""),
            chargeType: "balance_auto_charge",
          },
        });

        await supabase
          .from("bookings")
          .update({
            balance_payment_intent_id: charge.id,
            balance_charged_at: new Date().toISOString(),
            balance_amount_cents: remainingCents,
            payment_status: "paid",
          })
          .eq("id", bookingId);

        balanceChargeStatus = "charged";
        logStep("Balance charged off-session", {
          paymentIntentId: charge.id,
          status: charge.status,
          amountCents: remainingCents,
        });
      }
    } catch (chargeErr: any) {
      balanceChargeStatus = "failed";
      balanceChargeError = chargeErr?.message || String(chargeErr);
      logStep("Balance charge failed (non-blocking)", { error: balanceChargeError });
      // Persist the failure so admins can retry from the dashboard.
      try {
        await supabase.from("webhook_failures").insert({
          booking_id: bookingId,
          webhook_url: "stripe:balance_auto_charge",
          payload: { bookingId, error: balanceChargeError },
          error_message: balanceChargeError,
          retry_count: 0,
        });
      } catch (_) { /* ignore logging errors */ }
    }

    // Trigger payout
    const payoutResponse = await supabase.functions.invoke('process-payout', {
      body: { bookingId },
    });

    if (payoutResponse.error) {
      logStep("Payout trigger failed", { error: payoutResponse.error });
    } else {
      logStep("Payout triggered successfully");
    }

    // Send completion email to cleaner
    if (booking.cleaner_id) {
      try {
        const { data: cleaner } = await supabase
          .from("cleaners")
          .select("first_name, email")
          .eq("id", booking.cleaner_id)
          .single();

        if (cleaner?.email) {
          const estimatedEarnings = booking.total_estimate_cents
            ? Math.round(booking.total_estimate_cents * 0.45)
            : 0;

          await supabase.functions.invoke('send-cleaner-email', {
            body: {
              type: 'completion',
              email: cleaner.email,
              data: {
                cleanerFirstName: cleaner.first_name,
                bookingId,
                serviceDate: booking.service_date,
                customerName: `${booking.first_name || ''} ${booking.last_name || ''}`.trim(),
                earnings: estimatedEarnings,
                payoutStatus: payoutResponse.error ? 'processing' : 'initiated',
              },
            },
          });
          logStep("Cleaner completion email sent");
        }
      } catch (emailError) {
        logStep("Cleaner email failed (non-critical)", { error: emailError });
      }
    }

    // Send thank-you email to customer
    try {
      await supabase.functions.invoke('send-booking-email', {
        body: {
          type: 'completion',
          email: booking.email,
          data: {
            firstName: booking.first_name,
            bookingId,
            serviceDate: booking.service_date,
            timeSlot: booking.time_slot,
            serviceType: booking.service_type,
            address: booking.address,
            city: booking.city,
            state: booking.state,
            zipCode: booking.zip_code,
            totalAmount: booking.total_estimate_cents,
          },
        },
      });
      logStep("Customer thank-you email sent");
    } catch (emailError) {
      logStep("Customer email failed (non-critical)", { error: emailError });
    }

    // Customer SMS — service complete + balance charge confirmation.
    try {
      if (booking.phone) {
        const dateLabel = formatServiceDate(booking.service_date);
        let smsBody = `Novara Cleaning: Your cleaning${dateLabel ? ` on ${dateLabel}` : ""} is complete — thank you!`;
        if (balanceChargeStatus === "charged") {
          const remainingCents = Math.max(
            0,
            (booking.total_estimate_cents || 0) - (booking.deposit_cents || 0),
          );
          smsBody += ` Your remaining balance of $${(remainingCents / 100).toFixed(2)} has been charged to the card on file.`;
        } else if (balanceChargeStatus === "skipped_full_payment") {
          smsBody += ` Paid in full at booking — nothing more to do.`;
        } else if (balanceChargeStatus === "failed") {
          smsBody += ` We had trouble charging the balance on your card — our team will reach out shortly.`;
        }
        smsBody += ` Reply STOP to opt out.`;
        await sendSms(supabase, {
          toPhone: booking.phone,
          message: smsBody,
          type: "confirmation",
        });
        logStep("Customer completion SMS sent");
      }
    } catch (smsErr) {
      logStep("Customer completion SMS failed (non-blocking)", {
        error: smsErr instanceof Error ? smsErr.message : String(smsErr),
      });
    }

    // Trigger Zapier webhook for completed booking
    try {
      await supabase.functions.invoke('send-zapier-webhook', {
        body: { bookingId }
      });
      logStep("Zapier webhook triggered");
    } catch (webhookError) {
      logStep("Zapier webhook failed (non-critical)", { error: webhookError });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Booking completed and payout initiated",
        balanceCharge: {
          status: balanceChargeStatus,
          error: balanceChargeError,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});

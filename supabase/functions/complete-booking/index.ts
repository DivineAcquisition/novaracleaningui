import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { sendSms, formatServiceDate } from "../_shared/sms.ts";
import { mirrorToLeadConnector } from "../_shared/leadconnector-mirror.ts";
import { resolveSecret } from "../_shared/app-secrets.ts";

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

    // ─── Recompute cleaner payout using actual assigned cleaner ────
    //
    // create-payment-intent writes cleaner_payout_cents at booking
    // time using the DEFAULT 40% (Foundation) because no cleaner is
    // assigned yet. By the time complete-booking runs, the actual
    // assigned cleaner's tier may be Proven (45%) or Elite (50%) — and
    // for multi-cleaner jobs we have to use the highest tier on the
    // team. Recompute now so the payouts ledger and process-payout see
    // the correct number.
    let recomputedPayoutCents = booking.cleaner_payout_cents || 0;
    let recomputedPayPct = 40;
    try {
      const { data: assigns } = await supabase
        .from("job_assignments")
        .select(
          "id, cleaner_id, role, pay_percentage_snapshot, cleaners(pay_percentage)",
        )
        .eq("job_id", booking.job_id || "")
        .in("status", ["Confirmed", "Accepted", "accepted", "In Progress", "completed"]);

      const team: Array<{ id: string; pct: number }> = [];
      if (assigns?.length) {
        for (const a of assigns) {
          const pct = Number(
            (a as any).pay_percentage_snapshot
              || ((a as any).cleaners?.pay_percentage)
              || 0,
          ) || 35;
          team.push({ id: a.cleaner_id, pct });
        }
      }
      // Always include the booking's primary cleaner_id even if no
      // job_assignment row exists (admin-assigned booking).
      if (booking.cleaner_id && !team.find((t) => t.id === booking.cleaner_id)) {
        const { data: c } = await supabase
          .from("cleaners")
          .select("pay_percentage")
          .eq("id", booking.cleaner_id)
          .maybeSingle();
        team.push({ id: booking.cleaner_id, pct: Number(c?.pay_percentage) || 35 });
      }

      if (team.length > 0) {
        const revenue = booking.final_charge_cents
          || booking.total_estimate_cents
          || 0;
        recomputedPayPct = team.reduce((m, t) => Math.max(m, t.pct), 35);
        const pool = Math.floor((revenue * recomputedPayPct) / 100);
        const perCleaner = Math.floor(pool / team.length);
        recomputedPayoutCents = perCleaner;

        // Update each assignment's estimated_pay_cents to the final
        // per-cleaner number, and stamp the booking with the pool/lead
        // share so process-payout transfers the right amount.
        if (assigns?.length) {
          await Promise.all(
            assigns.map((a) =>
              supabase
                .from("job_assignments")
                .update({
                  estimated_pay_cents: perCleaner,
                  pay_percentage_snapshot: recomputedPayPct,
                })
                .eq("id", a.id),
            ),
          );
        }
        logStep("Recomputed payout (revenue share)", {
          revenue,
          payPct: recomputedPayPct,
          cleanerCount: team.length,
          perCleaner,
        });
      }
    } catch (recalcErr) {
      logStep("Pay recompute failed (non-blocking)", { error: String(recalcErr) });
    }

    // Mark booking as completed and stamp the (possibly updated)
    // cleaner_payout_cents so process-payout uses it.
    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        cleaner_payout_cents: recomputedPayoutCents,
      })
      .eq("id", bookingId);

    if (updateError) throw updateError;

    // Keep dispatch rows in sync with bookings.status. Historically only the
    // booking flipped to completed, so job_assignments stayed Confirmed /
    // In Progress and cleaner dashboards kept showing the job as upcoming.
    if (booking.job_id) {
      try {
        await supabase
          .from("job_assignments")
          .update({ status: "Completed" })
          .eq("job_id", booking.job_id)
          .in("status", [
            "Confirmed",
            "Accepted",
            "accepted",
            "Assigned",
            "assigned",
            "In Progress",
            "in_progress",
          ]);
        await supabase
          .from("jobs")
          .update({ status: "Completed" })
          .eq("id", booking.job_id);
      } catch (syncErr) {
        logStep("Assignment/job completion sync failed (non-blocking)", {
          error: String(syncErr),
        });
      }
    }

    logStep("Booking marked complete, charging remaining balance");

    // ─── Referral reward grant ────────────────────────────────────────
    // If this booking used a referral_code, grant the REFERRER a $50
    // wallet credit (customer_credits) now that the referred booking
    // actually completed. Atomic + idempotent: we mark the referrals
    // row 'redeemed' first, and only grant if it was previously 'pending'.
    try {
      const refCode = (booking as any).referral_code as string | null;
      if (refCode) {
        const { data: referrer } = await supabase
          .from("customers")
          .select("id, email, first_name")
          .eq("referral_code", refCode)
          .maybeSingle();
        if (referrer?.id && referrer.email !== booking.email) {
          const { data: refRow } = await supabase
            .from("referrals")
            .select("id, status, credit_cents")
            .eq("referred_booking_id", bookingId)
            .maybeSingle();
          const rewardCents = (refRow?.credit_cents as number | null) || 5000;
          if (refRow && refRow.status === "pending") {
            await supabase
              .from("referrals")
              .update({ status: "redeemed", redeemed_at: new Date().toISOString() })
              .eq("id", refRow.id);
            await supabase.rpc("grant_customer_credit", {
              _customer_id: referrer.id,
              _amount_cents: rewardCents,
              _source: "referral",
              _reason: `Referral reward for ${booking.first_name || "guest"} completing booking ${(booking as any).booking_number || bookingId}`,
              _granted_by: null,
              _expires_at: null,
              _referral_id: refRow.id,
              _booking_id: bookingId,
            });
            logStep("Referral reward granted", { referrerId: referrer.id, rewardCents });
          }
        }
      }
    } catch (referralErr) {
      logStep("Referral reward grant failed (non-blocking)", {
        error: referralErr instanceof Error ? referralErr.message : String(referralErr),
      });
    }

    // ─── Auto-charge remaining balance off-session ──────────────────────
    // For deposit bookings, charge the remaining 50% to the saved card.
    // For paid-in-full bookings, this is a no-op. Idempotent: if we've
    // already charged (balance_payment_intent_id set), skip.
    let balanceChargeStatus: "skipped_full_payment" | "skipped_no_balance" |
      "already_charged" | "charged" | "captured_hold" | "failed" = "skipped_no_balance";
    let balanceChargeError: string | null = null;
    let photoUploadToken: string | null = null;
    let photoUploadUrl: string | null = null;
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
        const stripeKey = await resolveSecret(supabase, "STRIPE_SECRET_KEY");
        if (!stripeKey) {
          throw new Error("STRIPE_SECRET_KEY not configured");
        }
        const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

        // ─── Path 1: capture an existing pre-authorized hold ─────────
        //
        // The cron-driven prepare-completion-hold worker normally places
        // a manual-capture (auth-only) PaymentIntent on the saved card
        // ~5 days before service. If we have an authorized hold here,
        // capture it for the actual final amount instead of creating a
        // fresh off-session charge — money was already reserved on the
        // customer's card so capture cannot decline.
        const heldPiId = booking.completion_hold_pi_id as string | null;
        const heldStatus = booking.completion_hold_status as string | null;
        const heldAmount = (booking.completion_hold_amount_cents as number | null) ?? 0;

        if (heldPiId && heldStatus === "authorized") {
          try {
            const heldPi = await stripe.paymentIntents.retrieve(heldPiId);
            if (heldPi.status === "requires_capture") {
              // Capture for the SMALLER of the held auth and the actual
              // remaining balance. If the actual cost ran higher
              // (overtime etc.) we capture the held amount in full and
              // create a small supplemental off-session charge for the
              // overage below.
              const captureAmount = Math.min(heldAmount, remainingCents);
              const captured = await stripe.paymentIntents.capture(heldPiId, {
                amount_to_capture: captureAmount,
              });
              await supabase
                .from("bookings")
                .update({
                  balance_payment_intent_id: heldPiId,
                  balance_charged_at: new Date().toISOString(),
                  balance_amount_cents: captureAmount,
                  payment_status: "paid",
                  completion_hold_status: "captured",
                  completion_hold_captured_at: new Date().toISOString(),
                  completion_hold_captured_amount: captureAmount,
                })
                .eq("id", bookingId);
              try {
                await supabase.from("completion_hold_log").insert({
                  booking_id: bookingId,
                  attempt: booking.completion_hold_attempts ?? 1,
                  outcome: "captured",
                  payment_intent_id: heldPiId,
                  amount_cents: captureAmount,
                });
              } catch (_) { /* best effort */ }

              balanceChargeStatus = "captured_hold";
              logStep("Hold captured", {
                paymentIntentId: heldPiId,
                amountCents: captureAmount,
                heldAmountCents: heldAmount,
                actualRemainingCents: remainingCents,
                stripeStatus: captured.status,
              });

              // ─── Supplemental for overage (off-session) ────────────
              const overageCents = remainingCents - captureAmount;
              if (overageCents > 0) {
                try {
                  const pms = await stripe.paymentMethods.list({
                    customer: heldPi.customer as string,
                    type: "card",
                    limit: 1,
                  });
                  const pmId = pms.data[0]?.id;
                  if (pmId) {
                    const supplemental = await stripe.paymentIntents.create({
                      amount: overageCents,
                      currency: "usd",
                      customer: heldPi.customer as string,
                      payment_method: pmId,
                      off_session: true,
                      confirm: true,
                      description: `Overage — ${booking.service_type} clean on ${booking.service_date}`,
                      metadata: {
                        bookingId,
                        bookingNumber: String(booking.booking_number ?? ""),
                        chargeType: "completion_overage",
                      },
                    }, {
                      idempotencyKey: `overage-${bookingId}-${overageCents}`,
                    });
                    logStep("Supplemental overage charged", {
                      paymentIntentId: supplemental.id,
                      amountCents: overageCents,
                    });
                  }
                } catch (overageErr) {
                  logStep("Supplemental overage charge failed (non-blocking)", {
                    error: overageErr instanceof Error ? overageErr.message : String(overageErr),
                  });
                }
              }
            } else {
              // The PI exists but isn't capturable anymore (likely
              // expired or already captured). Fall through to the
              // off-session path below.
              logStep("Hold not in requires_capture state — falling back", {
                heldPiId,
                heldStatus: heldPi.status,
              });
            }
          } catch (captureErr) {
            logStep("Hold capture failed — falling back to off-session", {
              error: captureErr instanceof Error ? captureErr.message : String(captureErr),
            });
          }
        }

        // ─── Path 2: legacy off-session charge ──────────────────────
        //
        // Only runs when there's no usable pre-authorized hold (cron
        // never got to it, hold expired, capture failed, etc.). Same
        // behavior as before this change — verifies the card is still
        // on file and creates a fresh off-session PaymentIntent for
        // the remaining balance.
        if (balanceChargeStatus !== "captured_hold") {
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
          }, {
            // Idempotency key keyed on booking + amount so a duplicate /
            // concurrent invocation (double-click "Mark complete", cron
            // overlap, retry) returns the SAME PaymentIntent instead of
            // charging the card again. A legitimately different balance
            // (after a service adjustment) uses a new key.
            idempotencyKey: `balance-${bookingId}-${remainingCents}`,
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

    // Send completion email to cleaner. Earnings figure now uses the
    // cleaner's actual pay_percentage (40 / 45 / 50) rather than the
    // legacy hardcoded 0.45. We prefer the booking's stored
    // cleaner_payout_cents (already correct from process-payout) and
    // fall back to revenue × cleaner.pay_percentage.
    if (booking.cleaner_id) {
      try {
        const { data: cleaner } = await supabase
          .from("cleaners")
          .select("first_name, email, phone, pay_percentage, pay_tier")
          .eq("id", booking.cleaner_id)
          .single();

        if (cleaner?.email) {
          const revenue = booking.final_charge_cents
            || booking.total_estimate_cents
            || 0;
          const pct = Number(cleaner.pay_percentage) || 35;
          const estimatedEarnings = booking.cleaner_payout_cents
            || Math.floor((revenue * pct) / 100);

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
                payPercentage: pct,
                jobRevenueCents: revenue,
                payoutStatus: payoutResponse.error ? 'processing' : 'initiated',
              },
            },
          });
          logStep("Cleaner completion email sent");
        }

        // Mint a single-use photo-upload token (idempotent) so both the SMS
        // and the contractor portal can link the cleaner to the public
        // before/after upload form. Minted regardless of phone so the portal
        // always has an upload link even when SMS can't be delivered.
        try {
          let token = (booking as any).photo_upload_token as string | null;
          if (!token) {
            const bytes = new Uint8Array(20);
            crypto.getRandomValues(bytes);
            token = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
            await supabase
              .from("bookings")
              .update({ photo_upload_token: token })
              .eq("id", bookingId);
          }
          photoUploadToken = token;
          // AFTER-photos link (before photos are requested before the job via
          // the day-of reminder).
          photoUploadUrl = `https://contractor.novaracleaning.com/cleaner/job-photos/${token}?phase=after`;

          // Text the cleaner the AFTER-photo link (best-effort). The send is
          // gated by an ATOMIC claim on after_photo_link_sent_at so it fires
          // exactly once per booking even when complete-booking runs more than
          // once (e.g. a cleaner already triggered it via cleaner-mark-complete
          // and an admin later re-runs the full completion here, or the endpoint
          // is hit twice). Only the call that flips it from NULL texts.
          if (cleaner?.phone) {
            const { data: claimedPhoto } = await supabase
              .from("bookings")
              .update({ after_photo_link_sent_at: new Date().toISOString() })
              .eq("id", bookingId)
              .is("after_photo_link_sent_at", null)
              .select("id");
            const shouldSendPhotoSms = Array.isArray(claimedPhoto) && claimedPhoto.length > 0;
            if (shouldSendPhotoSms) {
              const msg = `Novara: Job marked completed. Please upload your AFTER photos here so we can wrap this up and release your payout:\n${photoUploadUrl}\n\nReply STOP to opt out.`;
              await supabase.functions.invoke("send-ghl-sms", {
                body: {
                  phone: cleaner.phone,
                  email: cleaner.email || undefined,
                  firstName: cleaner.first_name || undefined,
                  message: msg,
                  type: "cleaner_photo_request",
                },
              });
              logStep("Cleaner photo-upload SMS sent");
            } else {
              logStep("Cleaner photo-upload SMS already sent — skipping");
            }
          }
        } catch (smsErr) {
          logStep("Cleaner photo upload link/SMS failed (non-critical)", { error: smsErr });
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

    // Post-clean testimonial video offer (50% off the 2nd clean once a
    // video + answers are submitted). Non-blocking — dynamic import keeps
    // this isolated from the completion path.
    try {
      const { sendTestimonialOffer } = await import("../_shared/testimonial-offer.ts");
      const { submitUrl } = await sendTestimonialOffer(supabase, {
        id: bookingId,
        email: booking.email,
        first_name: booking.first_name,
      });
      logStep("Testimonial offer sent", { submitUrl });
    } catch (testimonialErr) {
      logStep("Testimonial offer failed (non-blocking)", {
        error: testimonialErr instanceof Error ? testimonialErr.message : String(testimonialErr),
      });
    }

    // Mint the tokenized feedback link now so every completed job has one
    // immediately (single-purpose, job-specific, expiring). The SMS itself
    // goes out via the send-rating-reminders sweep ~2h after completion so
    // it doesn't stack on top of the completion texts above. Non-blocking.
    try {
      const { ensureJobFeedback, feedbackUrl } = await import("../_shared/job-feedback-offer.ts");
      const fb = await ensureJobFeedback(supabase, bookingId);
      logStep("Feedback link minted", { feedbackUrl: feedbackUrl(fb.token) });
    } catch (feedbackErr) {
      logStep("Feedback link mint failed (non-blocking)", {
        error: feedbackErr instanceof Error ? feedbackErr.message : String(feedbackErr),
      });
    }

    // Trigger Zapier webhook for completed booking — this fans out to
    // GHL PIT (syncBookingLifecycle marks the opportunity won + updates
    // remaining_balance / deposit_paid fields), LeadConnector inbound,
    // and legacy Zapier targets.
    try {
      await supabase.functions.invoke('send-zapier-webhook', {
        body: { bookingId }
      });
      logStep("Zapier + GHL sync triggered");
    } catch (webhookError) {
      logStep("send-zapier-webhook failed (non-critical)", { error: webhookError });
    }

    // Direct LeadConnector mirror with the completion-specific context
    // (balance-charge result, payout status) so the GHL workflow can
    // route the won opportunity into the right downstream automation.
    try {
      await mirrorToLeadConnector({
        event: "booking.completed",
        payload: {
          booking_id: bookingId,
          email: booking.email,
          phone: booking.phone,
          first_name: booking.first_name,
          last_name: booking.last_name,
          service_date: booking.service_date,
          time_slot: booking.time_slot,
          balance_charge: {
            status: balanceChargeStatus,
            error: balanceChargeError,
          },
        },
      });
    } catch (mirrorErr) {
      logStep("LeadConnector mirror failed (non-critical)", mirrorErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Booking completed and payout initiated",
        balanceCharge: {
          status: balanceChargeStatus,
          error: balanceChargeError,
        },
        photoUploadToken,
        photoUploadUrl,
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

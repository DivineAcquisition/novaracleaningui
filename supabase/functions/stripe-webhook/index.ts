import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendSms, formatServiceDate, formatTimeSlot } from "../_shared/sms.ts";
import { smsActionTail } from "../_shared/booking-policy.ts";
import {
  confirmationSmsBalanceTail,
  remainingDueAfterUpfrontCents,
} from "../_shared/booking-balance.ts";
import { resolveSecret } from "../_shared/app-secrets.ts";
import { memberTag } from "../_shared/ghl-tags.ts";
import { pingEnsureMembershipAgreement } from "../_shared/ensure-membership-agreement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[STRIPE-WEBHOOK] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Read Stripe credentials through the DB override layer first so we
  // can rotate keys via SQL (public.app_secrets) without redeploying
  // every Stripe-using Edge Function. The webhook secret MUST match
  // whatever endpoint Stripe is firing from — when you point the
  // NovaraCleaning account's webhook at this URL, drop the new whsec_
  // into app_secrets and signature verification picks it up on the
  // next cold start.
  const supabaseTmp = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const stripeKey = await resolveSecret(supabaseTmp, "STRIPE_SECRET_KEY");
  const stripe = new Stripe(stripeKey, {
    apiVersion: "2025-08-27.basil",
  });

  const signature = req.headers.get("stripe-signature");
  const webhookSecret = await resolveSecret(supabaseTmp, "STRIPE_WEBHOOK_SECRET");

  if (!webhookSecret) {
    logStep("ERROR: No webhook secret configured");
    return new Response(
      JSON.stringify({ error: "Webhook secret not configured" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }

  try {
    const body = await req.text();
    const event = await stripe.webhooks.constructEventAsync(body, signature!, webhookSecret);
    logStep("Event received", { type: event.type, id: event.id });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Helper function to send membership emails
    const sendMembershipEmail = async (type: string, email: string, data: any) => {
      try {
        const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-membership-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
          },
          body: JSON.stringify({ type, email, data }),
        });
        
        if (!response.ok) {
          logStep("Email send failed", { status: response.status });
        } else {
          logStep("Email sent successfully", { type, email });
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logStep("Error sending email", { error: errorMessage });
      }
    };

    // Whether the booking row has the home-detail questionnaire
    // answered. Mirrors REQUIRED_DETAIL_FIELDS in finalize-booking.
    const hasHomeDetails = (b: Record<string, unknown>) => {
      const reqd = ["address", "city", "state", "bedrooms", "bathrooms", "dwelling_type"];
      return reqd.every((f) => {
        const v = b[f];
        if (v === null || v === undefined) return false;
        if (typeof v === "string" && v.trim() === "") return false;
        return true;
      });
    };

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        logStep("Processing payment intent success", { paymentIntentId: paymentIntent.id });
        
        // Find booking by payment_intent_id
        const { data: booking, error: bookingFetchError } = await supabase
          .from('bookings')
          .select('*')
          .eq('payment_intent_id', paymentIntent.id)
          .maybeSingle();

        if (bookingFetchError) {
          logStep("Error fetching booking", { error: bookingFetchError });
          break;
        }

        if (!booking) {
          logStep("Booking not found for payment intent");
          break;
        }

        // Idempotency: skip status update if already confirmed, but ALWAYS run downstream actions
        const alreadyConfirmed = booking.status === 'confirmed';

        // Stamp the payment-cleared milestone. finalize-booking gates on
        // this column (payment_received_at) instead of the looser
        // status text, so it stays accurate even if a future change
        // adds new intermediate statuses.
        if (!booking.payment_received_at) {
          await supabase
            .from('bookings')
            .update({ payment_received_at: new Date().toISOString() })
            .eq('id', booking.id);
        }

        // Legacy VA rows may already be 'confirmed' with the deposit
        // outstanding; release held confirmation emails now. Newer internal
        // bookings stay pending_payment until this PI clears and are promoted
        // below — booking-confirm-comms runs after that promote.
        if (alreadyConfirmed) {
          try {
            await supabase.functions.invoke("booking-confirm-comms", {
              body: { bookingId: booking.id },
            });
            logStep("Confirmation comms released after deposit (PI)", { bookingId: booking.id });
          } catch (commsErr) {
            logStep("Confirmation comms after deposit failed (non-blocking)", {
              error: commsErr instanceof Error ? commsErr.message : String(commsErr),
            });
          }
        }

        // Thank-you + account/referral SMS fires once the deposit clears —
        // not while the internal booking is still pending payment. Idempotent;
        // also re-invoked later on full confirm for belt-and-suspenders.
        try {
          await supabase.functions.invoke("send-post-booking-sms", {
            body: { bookingId: booking.id },
          });
          logStep("Post-booking GHL SMS triggered after deposit (PI)", { bookingId: booking.id });
        } catch (ghlSmsErr) {
          logStep("Post-booking GHL SMS after deposit failed (non-blocking)", {
            error: ghlSmsErr instanceof Error ? ghlSmsErr.message : String(ghlSmsErr),
          });
        }

        // ── Apply wallet credit ledger deduction ──────────────────────
        // If the booking reserved customer_credits at quote time
        // (create-payment-intent set bookings.applied_credit_cents), now
        // that the payment cleared we atomically deduct those credits
        // from the ledger. Idempotent: if the rows are already marked
        // 'applied' the RPC is a no-op on the spent rows.
        try {
          const reserved = Number((booking as any).applied_credit_cents || 0);
          const bookingEmail = (booking as any).email as string | null;
          if (reserved > 0 && bookingEmail) {
            // Only spend the credit if no consumed row already exists
            // for this booking (cheap idempotency check).
            const { data: alreadyApplied } = await supabase
              .from('customer_credits')
              .select('id', { count: 'exact', head: false })
              .eq('applied_to_booking_id', booking.id)
              .eq('status', 'applied');
            if (!alreadyApplied || alreadyApplied.length === 0) {
              // Deduct by EMAIL so the spend works even when bookings.customer_id
              // is a Stripe `cus_…` id (not the credited customer uuid).
              const { data: applyResult } = await supabase.rpc(
                'apply_customer_credit_to_booking_by_email',
                { _email: bookingEmail, _booking_id: booking.id, _max_cents: reserved },
              );
              logStep('Wallet credit applied to booking', { bookingId: booking.id, applyResult });
            }
          }
        } catch (creditErr) {
          logStep('Wallet credit ledger deduction failed (non-blocking)', {
            error: creditErr instanceof Error ? creditErr.message : String(creditErr),
          });
        }

        // Home-detail gate. Booking is only "confirmed" (and therefore
        // eligible for the confirmation email / SMS / auto-dispatch /
        // calendar event) when the customer ALSO answered the property
        // questionnaire on /book/details. If they haven't, we mark the
        // row as 'pending_details' and fire a Telnyx SMS + email asking
        // them to come back and finish.
        //
        // Internal/admin bookings skip this gate — VAs collect details on
        // the call, and holding them at pending_details after deposit
        // would leave paid jobs unconfirmed.
        const detailsComplete = hasHomeDetails(booking);
        const isAdminChannel = booking.booking_channel === "admin";

        if (alreadyConfirmed) {
          logStep("Booking already confirmed - skipping status update but running downstream actions", { bookingId: booking.id });
        } else if (!detailsComplete && !isAdminChannel) {
          logStep("Payment cleared but home details missing — holding at pending_details", {
            bookingId: booking.id,
          });
          await supabase
            .from('bookings')
            .update({ status: 'pending_details' })
            .eq('id', booking.id)
            .in('status', ['pending_payment', 'pending_details', 'booked']);

          // INTENTIONALLY do NOT fire send-details-reminder here. The
          // customer is typically still in the browser tab on
          // /book/details right after payment — sending them an SMS +
          // email immediately is noisy and annoying. The pg_cron job
          // 'send-details-reminder-every-5min' picks up bookings whose
          // payment_received_at is at least 5 minutes old AND still
          // in pending_details, so they only get a nudge if they've
          // actually walked away from the funnel.
          logStep("Reminder deferred to cron (5-min grace window)", { bookingId: booking.id });
          break;
        } else {
          logStep("Processing booking confirmation", { bookingId: booking.id, currentStatus: booking.status });

          // Update booking status to confirmed with optimistic locking
          const { error: updateError } = await supabase
            .from('bookings')
            .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
            .eq('id', booking.id)
            .eq('status', booking.status); // Only update if status hasn't changed

          if (updateError) {
            logStep("Error updating booking status", updateError);
            break;
          }
          logStep("Booking confirmed via webhook", { bookingId: booking.id });
        }
        
        // Re-fetch booking to get latest state (may have been updated by verify-payment)
        const { data: freshBooking, error: refetchError } = await supabase
          .from('bookings')
          .select('*')
          .eq('id', booking.id)
          .single();
        
        if (refetchError || !freshBooking) {
          logStep("Error re-fetching booking", { error: refetchError });
          break;
        }
        
        // Use freshBooking for all downstream actions (has latest idempotency flags)
        const confirmedBooking = freshBooking;

        // Create invoice for remaining balance if deposit was paid (skip if already has invoice).
        //
        // DISABLED by default: the new flow saves the card on file at booking
        // (setup_future_usage='off_session') and auto-charges the remaining
        // balance when the cleaner marks the service complete (see
        // complete-booking → off-session PaymentIntent). To re-enable the
        // legacy email-invoice fallback, set INVOICE_FALLBACK_ENABLED=true
        // in the function env.
        const INVOICE_FALLBACK_ENABLED = Deno.env.get("INVOICE_FALLBACK_ENABLED") === "true";
        if (INVOICE_FALLBACK_ENABLED && confirmedBooking.payment_option === 'deposit' && !confirmedBooking.stripe_invoice_id) {
          const remainingBalanceCents = confirmedBooking.total_estimate_cents - confirmedBooking.deposit_cents;
          
          if (remainingBalanceCents > 0) {
            logStep("Creating invoice for remaining balance", { 
              remainingBalance: remainingBalanceCents,
              serviceDate: confirmedBooking.service_date
            });

            try {
              // Get or create Stripe customer
              const customers = await stripe.customers.list({ 
                email: confirmedBooking.email, 
                limit: 1 
              });
              
              let customerId = customers.data[0]?.id;
              if (!customerId) {
                const customer = await stripe.customers.create({
                  email: confirmedBooking.email,
                  name: `${confirmedBooking.first_name} ${confirmedBooking.last_name}`,
                  phone: confirmedBooking.phone,
                });
                customerId = customer.id;
              }

              // Create invoice
              const invoice = await stripe.invoices.create({
                customer: customerId,
                collection_method: 'send_invoice',
                days_until_due: Math.max(0, Math.ceil((new Date(confirmedBooking.service_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))),
                description: `Remaining balance for ${confirmedBooking.service_type} cleaning on ${confirmedBooking.service_date}`,
                metadata: {
                  booking_id: confirmedBooking.id,
                  booking_number: confirmedBooking.booking_number?.toString() || '',
                },
              });

              // Add line item for remaining balance
              await stripe.invoiceItems.create({
                customer: customerId,
                invoice: invoice.id,
                amount: remainingBalanceCents,
                currency: 'usd',
                description: `Remaining Balance - ${confirmedBooking.service_type} Cleaning Service`,
              });

              // Finalize and send invoice
              const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id, {
                auto_advance: true,
              });

              await stripe.invoices.sendInvoice(invoice.id);

              // Update booking with invoice ID and hosted invoice URL
              await supabase
                .from('bookings')
                .update({ 
                  stripe_invoice_id: invoice.id,
                  hosted_invoice_url: finalizedInvoice.hosted_invoice_url || null
                })
                .eq('id', confirmedBooking.id);

              logStep("Invoice created and sent", { 
                invoiceId: invoice.id,
                invoiceUrl: finalizedInvoice.hosted_invoice_url 
              });
            } catch (invoiceError) {
              const errorMessage = invoiceError instanceof Error ? invoiceError.message : String(invoiceError);
              logStep("Error creating invoice (non-critical)", { error: errorMessage });
              // Don't fail the webhook - booking is still confirmed
            }
          }
        }

        // Trigger auto-dispatch for the booking
        logStep("Triggering auto-dispatch for booking");
        try {
          await supabase.functions.invoke('auto-dispatch-booking', {
            body: { bookingId: confirmedBooking.id }
          });
          logStep("Auto-dispatch triggered successfully");
        } catch (dispatchError) {
          logStep("Auto-dispatch failed (non-critical)", { error: dispatchError });
          // Don't fail the webhook - booking is still confirmed
        }

        // Create Google Calendar event for the booking
        logStep("Creating Google Calendar event for booking");
        try {
          await supabase.functions.invoke('create-google-calendar-event', {
            body: { bookingId: confirmedBooking.id }
          });
          logStep("Google Calendar event created successfully");
        } catch (calendarError) {
          logStep("Google Calendar event creation failed (non-critical)", { error: calendarError });
          // Don't fail the webhook - booking is still confirmed
        }

        // Deduct membership credit if booking uses credit (with idempotency and race condition checks)
        if (confirmedBooking.uses_credit && confirmedBooking.customer_id) {
          logStep("Attempting to deduct membership credit", { customerId: confirmedBooking.customer_id });
          
          const { data: creditRecord, error: creditFetchError } = await supabase
            .from('membership_credits')
            .select('*')
            .eq('customer_id', confirmedBooking.customer_id)
            .maybeSingle();

          if (creditFetchError) {
            logStep("Error fetching credit record", creditFetchError);
          } else if (creditRecord && creditRecord.credits_remaining > 0) {
            // Use atomic update with optimistic locking to prevent double deduction
            const { error: creditUpdateError } = await supabase
              .from('membership_credits')
              .update({
                credits_used: creditRecord.credits_used + 1,
                credits_remaining: Math.max(0, creditRecord.credits_remaining - 1),
              })
              .eq('customer_id', confirmedBooking.customer_id)
              .eq('credits_remaining', creditRecord.credits_remaining); // Optimistic locking

            if (creditUpdateError) {
              logStep("Error updating credits", creditUpdateError);
            } else {
              logStep("Credit deducted successfully", { 
                remainingCredits: creditRecord.credits_remaining - 1 
              });
            }
          } else {
            logStep("No credit available or record not found");
          }
        }

          // Send confirmation emails (skip if already sent)
          if (!confirmedBooking.confirmation_email_sent) {
            logStep("Sending confirmation emails", { email: confirmedBooking.email });
          
            try {
              // Send booking confirmation
              await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-booking-email`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
                },
                body: JSON.stringify({
                  type: 'confirmation',
                  email: confirmedBooking.email,
                  data: {
                    firstName: confirmedBooking.first_name,
                    lastName: confirmedBooking.last_name,
                    bookingId: confirmedBooking.id,
                    serviceDate: confirmedBooking.service_date,
                    timeSlot: confirmedBooking.time_slot,
                    serviceType: confirmedBooking.service_type,
                    homeSize: confirmedBooking.home_size_id,
                    address: confirmedBooking.address,
                    city: confirmedBooking.city,
                    state: confirmedBooking.state,
                    zipCode: confirmedBooking.zip_code,
                    totalAmount: confirmedBooking.total_estimate_cents,
                    depositAmount: confirmedBooking.deposit_cents,
                    balanceAmount: confirmedBooking.total_estimate_cents - (confirmedBooking.payment_option === 'full' ? confirmedBooking.total_estimate_cents - (confirmedBooking.full_payment_discount || 0) : confirmedBooking.deposit_cents),
                    paymentOption: confirmedBooking.payment_option,
                    useCredit: confirmedBooking.uses_credit,
                    addOns: confirmedBooking.add_ons,
                  },
                }),
              });

            // Send payment receipt
            await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-booking-email`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
              },
              body: JSON.stringify({
                type: 'payment_receipt',
                email: confirmedBooking.email,
                data: {
                  firstName: confirmedBooking.first_name,
                  lastName: confirmedBooking.last_name,
                  bookingId: confirmedBooking.id,
                  serviceDate: confirmedBooking.service_date,
                  timeSlot: confirmedBooking.time_slot,
                  serviceType: confirmedBooking.service_type,
                  totalAmount: confirmedBooking.payment_option === 'full' ? confirmedBooking.total_estimate_cents - (confirmedBooking.full_payment_discount || 0) : confirmedBooking.deposit_cents,
                  balanceAmount: remainingDueAfterUpfrontCents(confirmedBooking),
                  paymentOption: confirmedBooking.payment_option,
                },
              }),
            });

            logStep("Confirmation emails sent successfully");

              // Customer SMS confirmation — best-effort, non-blocking.
              // "Paid in full" only when remaining balance is actually $0.
              try {
                const dateLabel = formatServiceDate(confirmedBooking.service_date);
                const timeLabel = formatTimeSlot(confirmedBooking.time_slot);
                const tail = confirmationSmsBalanceTail(confirmedBooking, "emdash");
                const smsMsg =
                  `Novara Cleaning: Booking confirmed for ${dateLabel}` +
                  (timeLabel ? ` (${timeLabel})` : "") +
                  `.${tail} ${smsActionTail()}`;
                await sendSms(supabase, {
                  toPhone: confirmedBooking.phone,
                  message: smsMsg,
                  type: "confirmation",
                });
                logStep("Customer confirmation SMS sent");
              } catch (smsErr) {
                logStep("Customer confirmation SMS failed (non-blocking)", {
                  error: smsErr instanceof Error ? smsErr.message : String(smsErr),
                });
              }

              // Also fire the post-booking GHL SMS (account + referral
              // links). Idempotent on bookings.post_confirm_ghl_sms_sent
              // so it won't double-text if finalize-booking also runs.
              try {
                await supabase.functions.invoke("send-post-booking-sms", {
                  body: { bookingId: confirmedBooking.id },
                });
                logStep("Post-booking GHL SMS triggered");
              } catch (ghlSmsErr) {
                logStep("Post-booking GHL SMS failed (non-blocking)", {
                  error: ghlSmsErr instanceof Error ? ghlSmsErr.message : String(ghlSmsErr),
                });
              }

              // Mark confirmation email as sent to prevent duplicates on webhook retries
              await supabase
                .from('bookings')
                .update({ confirmation_email_sent: true })
                .eq('id', confirmedBooking.id);

              logStep("Set confirmation_email_sent flag", { bookingId: confirmedBooking.id });
          } catch (emailError) {
            logStep("Error sending emails (non-blocking)", { error: emailError });

            // Queue for retry on failure
            try {
              await supabase
                .from('email_retry_queue')
                .insert({
                  booking_id: confirmedBooking.id,
                  email_type: 'confirmation',
                  email_address: confirmedBooking.email,
                  email_data: {
                    firstName: confirmedBooking.first_name,
                    lastName: confirmedBooking.last_name,
                    bookingId: confirmedBooking.id,
                    serviceDate: confirmedBooking.service_date,
                    timeSlot: confirmedBooking.time_slot,
                    serviceType: confirmedBooking.service_type,
                    address: `${confirmedBooking.address}, ${confirmedBooking.city}, ${confirmedBooking.state} ${confirmedBooking.zip_code}`,
                    totalAmount: confirmedBooking.total_estimate_cents,
                  },
                  status: 'pending',
                  retry_count: 0,
                  next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
                });
              logStep("Queued confirmation email for retry");
            } catch (queueError) {
              logStep("Failed to queue email for retry", { error: queueError });
            }
          }
          } else {
            logStep("Confirmation email already sent - skipping", { bookingId: confirmedBooking.id });
          }

          // Legacy assign-cleaner removed — auto-dispatch-booking (line ~190) handles this via dispatch-job

          // Generate referral code for customer if they don't have one
          try {
            logStep("Checking/generating customer referral code", { email: confirmedBooking.email });
            
            // Find or create customer record
            const { data: existingCustomer } = await supabase
              .from('customers')
              .select('id, referral_code')
              .eq('email', confirmedBooking.email)
              .maybeSingle();
            
            if (existingCustomer && !existingCustomer.referral_code) {
              // Generate referral code for existing customer without one
              const referralResponse = await supabase.functions.invoke('generate-referral-code', {
                body: { customerId: existingCustomer.id, email: confirmedBooking.email },
              });
              
              if (referralResponse.error) {
                logStep("Referral code generation failed (non-blocking)", { error: referralResponse.error });
              } else {
                logStep("Referral code generated successfully", referralResponse.data);
              }
            } else if (!existingCustomer) {
              // Create new customer with referral code generation
              const { data: newCustomer, error: insertError } = await supabase
                .from('customers')
                .insert({
                  email: confirmedBooking.email,
                  first_name: confirmedBooking.first_name,
                  last_name: confirmedBooking.last_name,
                  phone: confirmedBooking.phone,
                  address: confirmedBooking.address,
                  city: confirmedBooking.city,
                  state: confirmedBooking.state,
                  zip: confirmedBooking.zip_code,
                })
                .select('id')
                .single();
              
              if (insertError) {
                logStep("Customer creation failed (non-blocking)", { error: insertError.message });
              } else if (newCustomer) {
                const referralResponse = await supabase.functions.invoke('generate-referral-code', {
                  body: { customerId: newCustomer.id, email: confirmedBooking.email },
                });
                
                if (referralResponse.error) {
                  logStep("Referral code generation failed (non-blocking)", { error: referralResponse.error });
                } else {
                  logStep("New customer created with referral code", referralResponse.data);
                }
              }
            } else {
              logStep("Customer already has referral code", { code: existingCustomer.referral_code });
            }
          } catch (referralGenError) {
            logStep("Error generating referral code (non-blocking)", { error: referralGenError });
          }

          // Send booking data to Zapier webhook
          try {
            logStep("Triggering Zapier webhook");
            const zapierResponse = await supabase.functions.invoke('send-zapier-webhook', {
              body: { bookingId: confirmedBooking.id },
            });
            
            if (zapierResponse.error) {
              logStep("Zapier webhook failed (non-blocking)", { error: zapierResponse.error });
            } else {
              logStep("Zapier webhook sent successfully", zapierResponse.data);
            }
          } catch (zapierError) {
            logStep("Error sending Zapier webhook (non-blocking)", { error: zapierError });
          }

          // Sync booking to Anything App Platform
          try {
            logStep("Syncing to Anything App Platform");
            const anythingResponse = await supabase.functions.invoke('sync-to-anything', {
              body: { bookingId: confirmedBooking.id },
            });
            
            if (anythingResponse.error) {
              logStep("Anything sync failed (non-blocking)", { error: anythingResponse.error });
            } else {
              logStep("Anything sync successful", anythingResponse.data);
            }
          } catch (anythingError) {
            logStep("Error syncing to Anything (non-blocking)", { error: anythingError });
          }

          // Track referral if a referral code was applied to this
          // booking. Reads from the canonical bookings.referral_code
          // column (added in 20260521 migration) instead of the
          // nonexistent metadata path used previously.
          const appliedReferralCode = (confirmedBooking as any).referral_code as string | null;
          if (appliedReferralCode) {
            try {
              logStep("Processing referral attribution", { code: appliedReferralCode });
              const { data: referrer } = await supabase
                .from('customers')
                .select('id, email')
                .eq('referral_code', appliedReferralCode)
                .maybeSingle();

              if (referrer?.id && referrer.email !== confirmedBooking.email) {
                // Idempotency: only insert one referrals row per booking.
                const { data: existingReferral } = await supabase
                  .from('referrals')
                  .select('id, status')
                  .eq('referred_booking_id', confirmedBooking.id)
                  .maybeSingle();
                if (!existingReferral) {
                  await supabase
                    .from('referrals')
                    .insert({
                      customer_id: referrer.id,
                      code: appliedReferralCode,
                      referrer_email: referrer.email,
                      referred_email: confirmedBooking.email,
                      referred_booking_id: confirmedBooking.id,
                      status: 'pending',
                      credit_cents: 5000,
                    });
                  logStep("Referral event recorded", { referrerId: referrer.id, bookingId: confirmedBooking.id });
                }
              }
            } catch (referralError) {
              logStep("Error processing referral (non-blocking)", { error: referralError });
            }
          }
        break;
      }

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        logStep("Processing checkout completion", { sessionId: session.id });

        // ── Partner Turnover Portal checkout ──────────────────────────
        // Turnover Checkout sessions carry metadata.kind = "turnover". Drive
        // finalization (verify → assign → notify) from the webhook so a
        // closed browser tab can never strand a paid turnover. Idempotent:
        // partner-turnover.turnover.finalize guards on pending_payment.
        if (session.metadata?.kind === "turnover") {
          try {
            await supabase.functions.invoke("partner-turnover", {
              body: { action: "turnover.finalize", sessionId: session.id },
            });
            logStep("Turnover finalized via webhook", { sessionId: session.id });
          } catch (turnoverErr) {
            logStep("Turnover finalize failed (non-blocking)", {
              error: turnoverErr instanceof Error ? turnoverErr.message : String(turnoverErr),
            });
          }
          break;
        }

        // ── Partner weekly batch (book a week, pay per clean) ─────────────
        // Mark the batch paid + assign every turnover from the webhook so a
        // closed tab can't strand a paid batch. Idempotent via the status guard.
        if (session.metadata?.kind === "turnover_batch") {
          try {
            const batchId = session.metadata.batch_id as string | undefined;
            const { data: claimed } = await supabase
              .from("booking_batches")
              .update({ status: "paid", stripe_payment_intent_id: (session.payment_intent as string) || null })
              .eq(batchId ? "id" : "stripe_checkout_session_id", batchId || session.id)
              .eq("status", "pending_payment")
              .select("id");
            if (claimed && claimed.length > 0) {
              const { finalizeBatch } = await import("../_shared/turnover-engine.ts");
              await finalizeBatch(supabase, claimed[0].id);
              logStep("Turnover batch finalized via webhook", { batchId: claimed[0].id });
            }
          } catch (batchErr) {
            logStep("Turnover batch finalize failed (non-blocking)", {
              error: batchErr instanceof Error ? batchErr.message : String(batchErr),
            });
          }
          break;
        }

        // Update booking status to 'booked'
        const { error: updateError } = await supabase
          .from('bookings')
          .update({ 
            status: 'booked',
            payment_intent_id: session.payment_intent as string,
            customer_id: session.customer as string,
          })
          .eq('checkout_session_id', session.id);
        
        if (updateError) {
          logStep("Error updating booking", updateError);
        } else {
          logStep("Booking confirmed", { sessionId: session.id });
        }
        break;
      }

      case 'customer.subscription.created': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        logStep("Processing subscription creation", { subscriptionId: subscription.id });

        // Plan resolution order, robust against Stripe-account swaps:
        //   1. subscription.metadata.membership_plan  ← set by create-checkout
        //   2. legacy hardcoded priceId map (old NovaraCleaning account)
        //   3. derive from price.unit_amount tier
        //   4. fall back to 'monthly'
        const subMeta = (subscription.metadata || {}) as Record<string, string>;
        const priceId = subscription.items.data[0]?.price.id;
        const unitAmount = subscription.items.data[0]?.price.unit_amount || 0;
        const LEGACY_PRICE_MAP: Record<string, string> = {
          'price_1SR2UhGc7k6gIVcMiKbuq1mo': 'monthly',
          'price_1SR2VNGc7k6gIVcMMI6Fuxga': 'biweekly',
          'price_1SR2VYGc7k6gIVcML2W0jVKS': 'weekly',
        };
        let plan: string = subMeta.membership_plan
          || LEGACY_PRICE_MAP[priceId]
          || (unitAmount >= 60000 ? 'weekly' : unitAmount >= 25000 ? 'biweekly' : 'monthly');
        if (!['monthly', 'biweekly', 'weekly'].includes(plan)) plan = 'monthly';

        const creditsPerMonth = { monthly: 1, biweekly: 2, weekly: 4 }[plan] || 1;
        const planLabels: Record<string, string> = {
          monthly: 'Novara Monthly',
          biweekly: 'Novara Bi-Weekly',
          weekly: 'Novara Weekly',
        };

        // Get customer email and name
        const customer = await stripe.customers.retrieve(customerId);
        const email = (customer as Stripe.Customer).email || '';
        const name = (customer as Stripe.Customer).name || '';
        const phone = (customer as Stripe.Customer).phone || subMeta.phone || '';

        const monthlyPriceCentsMeta = subMeta.monthly_price_cents
          ? parseInt(subMeta.monthly_price_cents, 10) || unitAmount
          : unitAmount;

        // Stripe API version 2025-08-27.basil moved `current_period_*`
        // from the Subscription root to each SubscriptionItem. Read
        // from the item first and fall back to the (now removed) root
        // for compatibility with older webhook replays.
        // deno-lint-ignore no-explicit-any
        const subAny = subscription as any;
        // deno-lint-ignore no-explicit-any
        const itemAny = subscription.items?.data?.[0] as any;
        const periodStart = itemAny?.current_period_start ?? subAny.current_period_start;
        const periodEnd = itemAny?.current_period_end ?? subAny.current_period_end;

        // Create membership_credits entry
        const { error: creditsError } = await supabase
          .from('membership_credits')
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
            status: 'active',
          });
        
        if (creditsError) {
          logStep("Error creating membership credits", creditsError);
        } else {
          logStep("Membership credits created", { customerId, plan, credits: creditsPerMonth });
          
          // Create or get customer record and generate referral code
          try {
            const { data: existingCustomer } = await supabase
              .from('customers')
              .select('id, referral_code')
              .eq('email', email)
              .maybeSingle();

            let customerRecord = existingCustomer;

            if (!existingCustomer) {
              // Create customer record
              const { data: newCustomer, error: customerError } = await supabase
                .from('customers')
                .insert({
                  email,
                  first_name: name.split(' ')[0] || '',
                  last_name: name.split(' ').slice(1).join(' ') || '',
                })
                .select()
                .single();

              if (customerError) {
                logStep("Error creating customer", customerError);
              } else {
                customerRecord = newCustomer;
              }
            }

            // Generate referral code if customer doesn't have one
            if (customerRecord && !customerRecord.referral_code) {
              const referralResponse = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-referral-code`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
                },
                body: JSON.stringify({
                  customerId: customerRecord.id,
                  email,
                }),
              });

              if (referralResponse.ok) {
                const { code } = await referralResponse.json();
                logStep("Referral code generated", { code, customerId: customerRecord.id });
              }
            }
          } catch (referralError) {
            logStep("Error handling referral code (non-blocking)", { error: referralError });
          }
          
          // Send welcome email
          await sendMembershipEmail('welcome', email, {
            name,
            plan: planLabels[plan],
            credits: creditsPerMonth,
          });

          // Membership agreement once at purchase. Idempotent per email;
          // skips when the customer already signed on the membership pay page.
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

          // Persist membership preferences on the customers row so the
          // portal + admin tools can show them without joining
          // membership_credits, and so GHL custom-field sync uses them
          // as the source of truth.
          try {
            await supabase
              .from('customers')
              .upsert({
                email,
                first_name: subMeta.first_name || (name.split(' ')[0] || ''),
                last_name: subMeta.last_name || (name.split(' ').slice(1).join(' ') || ''),
                phone: phone || null,
                address: subMeta.address || null,
                city: subMeta.city || null,
                state: subMeta.state || null,
                zip: subMeta.zip_code || null,
                membership_status: 'active',
                membership_plan: plan,
                preferred_day_of_week: subMeta.preferred_day_of_week || null,
                preferred_time_window: subMeta.preferred_time_window || null,
              }, { onConflict: 'email' });
          } catch (custErr) {
            logStep("customers upsert failed (non-blocking)", { error: custErr instanceof Error ? custErr.message : String(custErr) });
          }

          // ─── GHL sync on subscription creation ───────────
          // Mirror the new member into GoHighLevel: contact + open
          // opportunity in the pipeline so the team can pick the
          // first booking date manually if the customer didn't pick
          // one during signup. Custom fields capture the
          // membership tier, monthly price, and schedule
          // preferences so workflow automations (SMS, email
          // sequences) can route on them.
          try {
            const { upsertContact, createOpportunity, updateOpportunity, fmtMoney } =
              await import("../_shared/ghl-client.ts");
            // File the membership opportunity on the SALES pipeline (never
            // hiring/dispatch). Prefer the configured sales pipeline secret.
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
            } catch (_) { /* fall back to auto-discovery */ }

            const contactId = await upsertContact({
              email,
              phone: phone || null,
              firstName: subMeta.first_name || (name.split(' ')[0] || null),
              lastName: subMeta.last_name || (name.split(' ').slice(1).join(' ') || null),
              address1: subMeta.address || null,
              city: subMeta.city || null,
              state: subMeta.state || null,
              postalCode: subMeta.zip_code || null,
              source: "Novara Membership Signup",
              // Home size and preferred day are custom fields, not tags.
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

            // Promote the lead opportunity create-checkout already filed
            // (id threaded through subscription metadata) to "won" instead of
            // creating a duplicate. Fall back to creating one only when no
            // pre-created opportunity exists (e.g. legacy links).
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
            logStep("GHL membership sync failed (non-blocking)", { error: ghlErr instanceof Error ? ghlErr.message : String(ghlErr) });
          }

          // ─── Mirror to LeadConnector inbound webhook ─────
          // Lets the GHL workflow trigger "membership.created"
          // automations (welcome SMS, welcome email, dispatch to
          // the success squad) without a polling loop.
          try {
            const { mirrorToLeadConnector } = await import("../_shared/leadconnector-mirror.ts");
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
            logStep("LeadConnector mirror failed (non-blocking)", { error: mirrorErr instanceof Error ? mirrorErr.message : String(mirrorErr) });
          }

          // ─── Welcome SMS so the customer immediately knows
          //     where to schedule their first clean. Includes
          //     their preferred day / window in the copy if they
          //     selected one during signup. Best-effort.
          if (phone) {
            try {
              const { sendSms } = await import("../_shared/sms.ts");
              const dayLabel = subMeta.preferred_day_of_week
                ? subMeta.preferred_day_of_week.charAt(0).toUpperCase() + subMeta.preferred_day_of_week.slice(1)
                : null;
              const windowLabel = subMeta.preferred_time_window || null;
              const preferenceLine = dayLabel
                ? ` We'll prefer ${dayLabel}${windowLabel ? ` (${windowLabel})` : ''} for your recurring cleans.`
                : '';
              const smsMessage =
                `Novara: Welcome to ${planLabels[plan]}! ${creditsPerMonth} credit${creditsPerMonth > 1 ? 's' : ''}/mo unlocked.${preferenceLine} ` +
                `Schedule your first clean: https://app.novaracleaning.com/portal/book — Reply HELP for help.`;
              await sendSms(supabase, { toPhone: phone, message: smsMessage, type: "confirmation" });
            } catch (smsErr) {
              logStep("Welcome SMS failed (non-blocking)", { error: smsErr instanceof Error ? smsErr.message : String(smsErr) });
            }
          }

          // ─── First-clean handling for the new member ──────────────
          //
          // Three cases, in priority order:
          //   1. existing_booking_id — an admin/VA started the membership
          //      against a booking they already created. Convert that row
          //      into a membership clean (no duplicate, no double charge).
          //   2. first_service_date — the member picked an exact slot in
          //      the booking funnel. Honor it.
          //   3. preferred_day_of_week — compute the next matching date.
          //
          // Cases 2 & 3 still require a full service address; without it
          // we leave scheduling to the customer via /portal/book.
          if (!creditsError) {
            try {
              const DOW_MAP: Record<string, number> = {
                sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
                thursday: 4, friday: 5, saturday: 6,
              };

              if (subMeta.existing_booking_id) {
                // Case 1 — link/convert the admin-created booking.
                const { error: linkErr } = await supabase
                  .from("bookings")
                  .update({
                    membership_plan: plan,
                    uses_credit: true,
                    customer_id: customerId,
                    team_notes: "MEMBERSHIP BOOKING — recurring subscription started",
                  })
                  .eq("id", subMeta.existing_booking_id);
                if (linkErr) {
                  logStep("Linking existing booking to membership failed (non-blocking)", { error: linkErr.message });
                } else {
                  logStep("Linked existing booking to new membership", { bookingId: subMeta.existing_booking_id, plan });
                }
              } else if (
                subMeta.home_size_id && subMeta.address && subMeta.city && subMeta.state
              ) {
                // Resolve the first-clean date: explicit slot wins, else
                // compute from the preferred day of week.
                let autoServiceDate: string | null = null;
                let autoTimeSlot = subMeta.first_time_slot ||
                  subMeta.preferred_time_window || "10:00 AM - 12:00 PM";

                if (subMeta.first_service_date && /^\d{4}-\d{2}-\d{2}$/.test(subMeta.first_service_date)) {
                  // Case 2 — exact date picked in the funnel.
                  autoServiceDate = subMeta.first_service_date;
                } else if (subMeta.preferred_day_of_week) {
                  // Case 3 — next matching weekday, ≥3 days out.
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
                  // Reflect any admin first-clean deposit collected on the
                  // subscription Checkout so the booking row mirrors what was
                  // actually charged (instead of all-zeros). `deposit_cents`
                  // is set by create-checkout when a deposit invoice mode was
                  // used on the Internal Booking recurring path.
                  const autoDepositCents = subMeta.deposit_cents
                    ? parseInt(subMeta.deposit_cents, 10) || 0
                    : 0;
                  const autoTeamNotes = autoDepositCents > 0
                    ? `MEMBERSHIP AUTO-BOOKING — $${(autoDepositCents / 100).toFixed(2)} first-clean deposit collected at signup. Confirm date with customer before dispatching`
                    : "MEMBERSHIP AUTO-BOOKING — confirm date with customer before dispatching";

                  const { error: autoBookErr } = await supabase
                    .from("bookings")
                    .insert({
                      email,
                      first_name: subMeta.first_name || (name.split(" ")[0] || ""),
                      last_name: subMeta.last_name || (name.split(" ").slice(1).join(" ") || ""),
                      phone: phone || "",
                      address: subMeta.address,
                      city: subMeta.city,
                      state: subMeta.state,
                      zip_code: subMeta.zip_code || "",
                      home_size_id: subMeta.home_size_id,
                      service_type: "standard",
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
              logStep("First-clean handling error (non-blocking)", { error: autoErr instanceof Error ? autoErr.message : String(autoErr) });
            }
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const previousAttributes = event.data.previous_attributes as any;
        logStep("Processing subscription update", { subscriptionId: subscription.id });

        // Resilient period-end resolution — see customer.subscription.created.
        // deno-lint-ignore no-explicit-any
        const subAnyU = subscription as any;
        // deno-lint-ignore no-explicit-any
        const itemAnyU = subscription.items?.data?.[0] as any;
        const periodStartU = itemAnyU?.current_period_start ?? subAnyU.current_period_start;
        const periodEndU = itemAnyU?.current_period_end ?? subAnyU.current_period_end;

        const prevPeriodEnd = previousAttributes?.items?.data?.[0]?.current_period_end
          ?? previousAttributes?.current_period_end;
        const isRenewal = prevPeriodEnd && prevPeriodEnd !== periodEndU;
        
        if (isRenewal) {
          logStep("Detected subscription renewal", { subscriptionId: subscription.id });

          // Same resolution order as customer.subscription.created — see
          // notes there.
          const subMeta = (subscription.metadata || {}) as Record<string, string>;
          const priceId = subscription.items.data[0]?.price.id;
          const unitAmount = subscription.items.data[0]?.price.unit_amount || 0;
          const LEGACY_PRICE_MAP: Record<string, string> = {
            'price_1SR2UhGc7k6gIVcMiKbuq1mo': 'monthly',
            'price_1SR2VNGc7k6gIVcMMI6Fuxga': 'biweekly',
            'price_1SR2VYGc7k6gIVcML2W0jVKS': 'weekly',
          };
          let plan: string = subMeta.membership_plan
            || LEGACY_PRICE_MAP[priceId]
            || (unitAmount >= 60000 ? 'weekly' : unitAmount >= 25000 ? 'biweekly' : 'monthly');
          if (!['monthly', 'biweekly', 'weekly'].includes(plan)) plan = 'monthly';
          const creditsPerMonth: number = { monthly: 1, biweekly: 2, weekly: 4 }[plan] || 1;
          const planLabels: Record<string, string> = { 
            monthly: 'Novara Monthly', 
            biweekly: 'Novara Bi-Weekly', 
            weekly: 'Novara Weekly' 
          };
          
          // Get customer info
          const customerId = subscription.customer as string;
          const customer = await stripe.customers.retrieve(customerId);
          const email = (customer as Stripe.Customer).email || '';
          const name = (customer as Stripe.Customer).name || '';
          
          // Reset credits on renewal
          const { error: updateError } = await supabase
            .from('membership_credits')
            .update({
              credits_used: 0,
              credits_remaining: creditsPerMonth,
              current_period_start: periodStartU ? new Date(periodStartU * 1000).toISOString() : null,
              current_period_end: periodEndU ? new Date(periodEndU * 1000).toISOString() : null,
              credit_available_date: new Date().toISOString(),
            })
            .eq('subscription_id', subscription.id);
          
          if (updateError) {
            logStep("Error updating membership credits", updateError);
          } else {
            logStep("Membership credits renewed", { subscriptionId: subscription.id, credits: creditsPerMonth });
            
            // Send renewal and credit allocation emails
            const amount = subscription.items.data[0]?.price.unit_amount || 0;
            const renewalIso = periodEndU ? new Date(periodEndU * 1000).toISOString() : new Date().toISOString();
            await sendMembershipEmail('renewal', email, {
              name,
              plan: planLabels[plan],
              amount,
              renewalDate: renewalIso,
            });

            await sendMembershipEmail('credit_allocated', email, {
              name,
              plan: planLabels[plan],
              credits: creditsPerMonth,
              renewalDate: renewalIso,
            });

            // Send SMS notification if phone number available
            try {
              const { data: customerData } = await supabase
                .from('customers')
                .select('phone')
                .eq('id', customerId)
                .single();

              if (customerData?.phone) {
                const smsMessage = `Novara: ${creditsPerMonth} new cleaning credit${creditsPerMonth > 1 ? 's' : ''} added to your ${planLabels[plan]} membership! Book now: https://try.novaracleaning.com/book/zip`;

                await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-sms-notification`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
                  },
                  body: JSON.stringify({
                    toPhone: customerData.phone,
                    message: smsMessage,
                    type: 'confirmation',
                  }),
                });

                logStep("SMS notification sent for credit allocation", { phone: customerData.phone });
              }
            } catch (smsError) {
              logStep("Error sending SMS (non-blocking)", { error: smsError });
            }
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        logStep("Processing subscription cancellation", { subscriptionId: subscription.id });
        
        // Get customer and credits info before deletion
        const { data: creditsData } = await supabase
          .from('membership_credits')
          .select('*')
          .eq('subscription_id', subscription.id)
          .single();
        
        // Delete credits record
        const { error: deleteError } = await supabase
          .from('membership_credits')
          .delete()
          .eq('subscription_id', subscription.id);
        
        if (deleteError) {
          logStep("Error deleting membership credits", deleteError);
        } else {
          logStep("Membership credits removed", { subscriptionId: subscription.id });
          
          // Send cancellation email if we have customer data
          if (creditsData?.email) {
            const customer = await stripe.customers.retrieve(subscription.customer as string);
            const name = (customer as Stripe.Customer).name || '';
            const planLabels: Record<string, string> = { 
              monthly: 'Novara Monthly', 
              biweekly: 'Novara Bi-Weekly', 
              weekly: 'Novara Weekly' 
            };
            
            await sendMembershipEmail('subscription_cancelled', creditsData.email, {
              name,
              plan: planLabels[creditsData.membership_plan as string] || creditsData.membership_plan,
            });

            // Sync cancellation state into GHL: contact tag + reopen
            // the latest opportunity as 'lost' so the team can re-
            // engage. Best-effort, never throws.
            try {
              const { syncBookingLifecycle } = await import("../_shared/ghl-client.ts");
              await syncBookingLifecycle({
                contact: {
                  email: creditsData.email,
                  source: "Novara Membership Cancelled",
                  tags: ["member - cancelled"],
                  mergeTags: true,
                  customFieldsByKey: {
                    membership_status: "cancelled",
                    membership_plan: "",
                  },
                },
                opportunity: {
                  name: `Novara Membership — cancelled (${creditsData.email})`,
                  status: "lost",
                  source: "Novara Membership Cancelled",
                  customFieldsByKey: {
                    membership_status: "cancelled",
                  },
                },
              });
            } catch (ghlErr) {
              logStep("GHL cancel sync failed (non-blocking)", { error: ghlErr instanceof Error ? ghlErr.message : String(ghlErr) });
            }

            // Mark the customers row as cancelled and reset prefs so
            // downstream code doesn't treat them as a member.
            try {
              await supabase
                .from('customers')
                .update({ membership_status: 'cancelled', membership_plan: null })
                .eq('email', creditsData.email);
            } catch (custErr) {
              logStep("customers update on cancel failed", { error: custErr instanceof Error ? custErr.message : String(custErr) });
            }
          }
        }
        break;
      }

      case 'payment_method.attached':
      case 'payment_method.updated':
      case 'setup_intent.succeeded':
      case 'customer.updated': {
        // Customer added a new card / updated billing info via the
        // Stripe Customer Portal (or via setup intent during checkout).
        // We push a quick GHL contact update so the
        // `default_payment_method` custom field reflects the new card
        // brand + last4 immediately.
        let customerId: string | undefined;
        // deno-lint-ignore no-explicit-any
        const obj = event.data.object as any;
        if (event.type === 'customer.updated') {
          customerId = obj?.id;
        } else if (event.type === 'setup_intent.succeeded') {
          customerId = typeof obj?.customer === 'string' ? obj.customer : obj?.customer?.id;
        } else {
          customerId = typeof obj?.customer === 'string' ? obj.customer : obj?.customer?.id;
        }
        if (!customerId) {
          logStep("payment-method webhook skipped — no customer id", { eventType: event.type });
          break;
        }
        try {
          const customer = await stripe.customers.retrieve(customerId);
          if (!customer || (customer as any).deleted) break;
          // deno-lint-ignore no-explicit-any
          const cus: any = customer;
          const email = cus.email;
          if (!email) break;

          // Resolve the customer's default card → "Visa ending 4242"
          let defaultPaymentMethod = "";
          const pmRef = cus.invoice_settings?.default_payment_method;
          if (pmRef && typeof pmRef === "object") {
            defaultPaymentMethod = `${pmRef.card?.brand || 'card'} ending ${pmRef.card?.last4 || '????'}`;
          } else if (typeof pmRef === "string") {
            try {
              const pmObj = await stripe.paymentMethods.retrieve(pmRef);
              // deno-lint-ignore no-explicit-any
              const pm = pmObj as any;
              defaultPaymentMethod = `${pm.card?.brand || 'card'} ending ${pm.card?.last4 || '????'}`;
            } catch (_) { /* ignore */ }
          } else {
            // Fall back to the most recently attached card
            const pms = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 });
            if (pms.data.length > 0) {
              const pm: any = pms.data[0];
              defaultPaymentMethod = `${pm.card?.brand || 'card'} ending ${pm.card?.last4 || '????'}`;
            }
          }

          const { upsertContact } = await import("../_shared/ghl-client.ts");
          await upsertContact({
            email,
            phone: cus.phone || null,
            firstName: (cus.name || "").split(" ")[0] || null,
            lastName: (cus.name || "").split(" ").slice(1).join(" ") || null,
            source: "Novara Billing Update",
            customFieldsByKey: {
              default_payment_method: defaultPaymentMethod,
              stripe_customer_id: customerId,
            },
          });
          logStep("GHL contact updated with new payment method", { email, defaultPaymentMethod });

          // Mirror the event to the LeadConnector inbound webhook so
          // the GHL workflow can route a "card on file updated"
          // automation if the operator wants.
          const { mirrorToLeadConnector } = await import("../_shared/leadconnector-mirror.ts");
          await mirrorToLeadConnector({
            event: `stripe.${event.type}`,
            payload: {
              stripe_customer_id: customerId,
              email,
              phone: cus.phone || null,
              default_payment_method: defaultPaymentMethod,
            },
          });
        } catch (pmErr) {
          logStep("payment-method GHL sync failed (non-critical)", {
            error: pmErr instanceof Error ? pmErr.message : String(pmErr),
          });
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === "string"
          ? invoice.customer
          : invoice.customer?.id;
        const bookingId = invoice.metadata?.booking_id;
        const purpose = invoice.metadata?.purpose;

        if (customerId && invoice.payment_intent) {
          const piId = typeof invoice.payment_intent === "string"
            ? invoice.payment_intent
            : invoice.payment_intent.id;
          try {
            const pi = await stripe.paymentIntents.retrieve(piId);
            const pmId = typeof pi.payment_method === "string"
              ? pi.payment_method
              : pi.payment_method?.id;
            if (pmId) {
              const pm = await stripe.paymentMethods.retrieve(pmId);
              if (pm.customer && pm.customer !== customerId) {
                logStep("Invoice PM on different customer — skip save", { pmId, customerId });
              } else {
                if (!pm.customer) {
                  await stripe.paymentMethods.attach(pmId, { customer: customerId });
                }
                await stripe.customers.update(customerId, {
                  invoice_settings: { default_payment_method: pmId },
                });
                logStep("Card saved from invoice for off-session balance charges", {
                  customerId, pmId, purpose,
                });
              }
            }
          } catch (saveErr) {
            logStep("Save card from invoice failed (non-blocking)", {
              error: saveErr instanceof Error ? saveErr.message : String(saveErr),
            });
          }
        }

        if (bookingId && customerId && (purpose === "deposit" || purpose === "full_payment")) {
          await supabase.from("bookings").update({
            customer_id: customerId,
            payment_received_at: new Date().toISOString(),
          }).eq("id", bookingId);
          logStep("Booking updated from deposit/full invoice payment", { bookingId, purpose });

          // Internal bookings are created as pending_payment. Promote to
          // confirmed now that the deposit/full invoice has cleared so the
          // bookings tab and booking-confirm-comms see a real confirmation.
          const { data: promotedRows, error: promoteErr } = await supabase
            .from("bookings")
            .update({
              status: "confirmed",
              confirmed_at: new Date().toISOString(),
            })
            .eq("id", bookingId)
            .in("status", ["pending_payment", "pending_details", "booked"])
            .select("id");
          if (promoteErr) {
            logStep("Promote booking after invoice payment failed (non-blocking)", {
              bookingId,
              error: promoteErr.message,
            });
          } else {
            logStep("Booking confirmed after deposit/full invoice payment", {
              bookingId,
              purpose,
              promoted: (promotedRows || []).length > 0,
            });
          }

          // Money is in — release "Booking Confirmed" + "Payment Received".
          // Idempotent via bookings.confirmation_email_sent. Also covers
          // auto-dispatch + post-booking SMS.
          try {
            await supabase.functions.invoke("booking-confirm-comms", {
              body: { bookingId },
            });
            logStep("Confirmation comms released after invoice payment", { bookingId, purpose });
          } catch (commsErr) {
            logStep("Confirmation comms after invoice payment failed (non-blocking)", {
              error: commsErr instanceof Error ? commsErr.message : String(commsErr),
            });
          }

          // Downstream fan-out that used to run at VA booking-create time
          // (when rows were pre-confirmed). Now that confirmation waits on
          // payment, run the remaining pieces here. Each is idempotent /
          // non-blocking. booking-confirm-comms already handles dispatch +
          // post-booking SMS.
          for (const fn of [
            "create-google-calendar-event",
            "send-zapier-webhook",
            "sync-to-anything",
          ]) {
            try {
              await supabase.functions.invoke(fn, { body: { bookingId } });
              logStep(`${fn} triggered after deposit invoice`, { bookingId, purpose });
            } catch (fanoutErr) {
              logStep(`${fn} after deposit invoice failed (non-blocking)`, {
                error: fanoutErr instanceof Error ? fanoutErr.message : String(fanoutErr),
              });
            }
          }
        }

        // ── STR turnover invoice paid → mark paid + assign + calendar sync ──
        // The card was already saved to the customer above, so the balance (for
        // split) can be charged off-session on completion.
        const turnoverId = invoice.metadata?.turnover_id;
        if (turnoverId && invoice.metadata?.kind === "turnover") {
          try {
            const piId = typeof invoice.payment_intent === "string"
              ? invoice.payment_intent
              : invoice.payment_intent?.id || null;
            await supabase.functions.invoke("partner-turnover", {
              body: { action: "turnover.finalizeByInvoice", turnoverId, paymentIntentId: piId },
            });
            logStep("Turnover finalized from invoice payment", { turnoverId });
          } catch (e) {
            logStep("Turnover invoice finalize failed (non-blocking)", {
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }

        // ── Membership renewal: reset credits ────────────────────────────
        // invoice.billing_reason === 'subscription_cycle' fires reliably on
        // every auto-renewal. We use this instead of parsing
        // previous_attributes on customer.subscription.updated because
        // Stripe API 2025-08-27.basil removed current_period_end from the
        // subscription root and the nested previous_attributes path is
        // unreliable.
        if (invoice.billing_reason === "subscription_cycle" && invoice.subscription) {
          const renewSubId = typeof invoice.subscription === "string"
            ? invoice.subscription
            : (invoice.subscription as any).id;

          try {
            const renewSub = await stripe.subscriptions.retrieve(renewSubId);
            // deno-lint-ignore no-explicit-any
            const renewItemAny = renewSub.items?.data?.[0] as any;
            // deno-lint-ignore no-explicit-any
            const renewSubAny = renewSub as any;
            const renewPeriodStart = renewItemAny?.current_period_start ?? renewSubAny.current_period_start;
            const renewPeriodEnd = renewItemAny?.current_period_end ?? renewSubAny.current_period_end;

            const renewMeta = (renewSub.metadata || {}) as Record<string, string>;
            const renewPriceId = renewSub.items.data[0]?.price.id;
            const renewUnitAmount = renewSub.items.data[0]?.price.unit_amount || 0;
            const RENEWAL_LEGACY_MAP: Record<string, string> = {
              "price_1SR2UhGc7k6gIVcMiKbuq1mo": "monthly",
              "price_1SR2VNGc7k6gIVcMMI6Fuxga": "biweekly",
              "price_1SR2VYGc7k6gIVcML2W0jVKS": "weekly",
            };
            let renewPlan: string = renewMeta.membership_plan
              || RENEWAL_LEGACY_MAP[renewPriceId]
              || (renewUnitAmount >= 60000 ? "weekly" : renewUnitAmount >= 25000 ? "biweekly" : "monthly");
            if (!["monthly", "biweekly", "weekly"].includes(renewPlan)) renewPlan = "monthly";
            const renewCredits: number = ({ monthly: 1, biweekly: 2, weekly: 4 } as Record<string, number>)[renewPlan] || 1;

            // Idempotency: only reset if the period has actually advanced
            const { data: existingCredits } = await supabase
              .from("membership_credits")
              .select("id, current_period_end")
              .eq("subscription_id", renewSubId)
              .maybeSingle();

            if (!existingCredits) {
              logStep("No membership_credits row for renewal — subscription.created may have failed", { renewSubId });
            } else {
              const newPeriodEndIso = renewPeriodEnd ? new Date(renewPeriodEnd * 1000).toISOString() : null;
              const alreadyReset = existingCredits.current_period_end && newPeriodEndIso
                && existingCredits.current_period_end === newPeriodEndIso;

              if (alreadyReset) {
                logStep("Credits already reset for this period (idempotent skip)", { renewSubId });
              } else {
                const { error: renewCredError } = await supabase
                  .from("membership_credits")
                  .update({
                    credits_used: 0,
                    credits_remaining: renewCredits,
                    current_period_start: renewPeriodStart ? new Date(renewPeriodStart * 1000).toISOString() : null,
                    current_period_end: newPeriodEndIso,
                    credit_available_date: new Date().toISOString(),
                  })
                  .eq("subscription_id", renewSubId);

                if (renewCredError) {
                  logStep("Error resetting membership credits on renewal", { error: renewCredError.message, renewSubId });
                } else {
                  logStep("Membership credits reset via invoice.payment_succeeded", { renewSubId, plan: renewPlan, credits: renewCredits });

                  // Send renewal + credit_allocated emails
                  try {
                    if (customerId) {
                      const renewCus = await stripe.customers.retrieve(customerId);
                      const renewEmail = (renewCus as Stripe.Customer).email || "";
                      const renewName = (renewCus as Stripe.Customer).name || "";
                      if (renewEmail) {
                        const renewPlanLabels: Record<string, string> = {
                          monthly: "Novara Monthly",
                          biweekly: "Novara Bi-Weekly",
                          weekly: "Novara Weekly",
                        };
                        const renewalIso = newPeriodEndIso || new Date().toISOString();
                        await sendMembershipEmail("renewal", renewEmail, {
                          name: renewName,
                          plan: renewPlanLabels[renewPlan],
                          amount: renewUnitAmount,
                          renewalDate: renewalIso,
                        });
                        await sendMembershipEmail("credit_allocated", renewEmail, {
                          name: renewName,
                          plan: renewPlanLabels[renewPlan],
                          credits: renewCredits,
                          renewalDate: renewalIso,
                        });
                      }
                    }
                  } catch (renewEmailErr) {
                    logStep("Renewal emails failed (non-blocking)", { error: renewEmailErr instanceof Error ? renewEmailErr.message : String(renewEmailErr) });
                  }
                }
              }
            }
          } catch (renewErr) {
            logStep("Membership credit renewal failed (non-blocking)", { error: renewErr instanceof Error ? renewErr.message : String(renewErr), renewSubId });
          }
        }
        break;
      }

      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        const accountId = account.id;
        logStep("Processing account update", { accountId });
        
        // Find cleaner with this Stripe account
        const { data: cleaner } = await supabase
          .from("cleaners")
          .select("*")
          .eq("stripe_account_id", accountId)
          .maybeSingle();
        
        if (cleaner) {
          const onboardingComplete = account.details_submitted || false;
          const payoutsEnabled = account.payouts_enabled || false;
          
          logStep("Updating cleaner status", { 
            cleanerId: cleaner.id, 
            onboardingComplete, 
            payoutsEnabled 
          });
          
          await supabase
            .from("cleaners")
            .update({
              onboarding_complete: onboardingComplete,
              payouts_enabled: payoutsEnabled,
              status: onboardingComplete ? 'active' : 'pending',
              activated_at: onboardingComplete && !cleaner.activated_at ? new Date().toISOString() : cleaner.activated_at,
            })
            .eq("id", cleaner.id);
            
          logStep("Cleaner status updated");
        } else {
          logStep("No cleaner found for account", { accountId });
        }
        break;
      }

      // ─── Payroll: Connect transfer lifecycle → mark run cleared/failed ──
      case 'transfer.created':
      case 'transfer.updated':
      case 'transfer.paid': {
        // deno-lint-ignore no-explicit-any
        const transfer = event.data.object as any;
        const runId = transfer?.metadata?.payroll_run_id as string | undefined;
        const transferId = transfer?.id as string | undefined;
        try {
          let q = supabase.from("payroll_runs").update({
            status: "cleared",
            cleared_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          q = runId ? q.eq("id", runId) : q.eq("stripe_transfer_id", transferId);
          // Only clear runs that actually went out (don't resurrect drafts).
          const { data: updated } = await q.in("status", ["sent", "paid", "processing", "failed"]).select("id");
          logStep("Payroll run cleared via transfer event", { runId, transferId, count: (updated || []).length });
        } catch (err) {
          logStep("Payroll transfer-event handling failed (non-blocking)", { error: err instanceof Error ? err.message : String(err) });
        }
        break;
      }

      case 'transfer.reversed': {
        // deno-lint-ignore no-explicit-any
        const transfer = event.data.object as any;
        const runId = transfer?.metadata?.payroll_run_id as string | undefined;
        const transferId = transfer?.id as string | undefined;
        try {
          let q = supabase.from("payroll_runs").update({
            status: "failed",
            failure_reason: "Stripe transfer reversed",
            updated_at: new Date().toISOString(),
          });
          q = runId ? q.eq("id", runId) : q.eq("stripe_transfer_id", transferId);
          await q;
          logStep("Payroll run marked failed (transfer reversed)", { runId, transferId });
        } catch (_) { /* non-blocking */ }
        break;
      }

      default:
        logStep("Unhandled event type", { type: event.type });
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR processing webhook", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
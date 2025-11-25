import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

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

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
    apiVersion: "2025-08-27.basil",
  });

  const signature = req.headers.get("stripe-signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

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

        // Idempotency check - if already confirmed, skip processing
        if (booking.status === 'confirmed') {
          logStep("Booking already confirmed - skipping webhook processing", { bookingId: booking.id });
          break;
        }

        logStep("Processing booking confirmation", { bookingId: booking.id, currentStatus: booking.status });

        // Update booking status to confirmed with optimistic locking
        const { error: updateError } = await supabase
          .from('bookings')
          .update({ status: 'confirmed' })
          .eq('id', booking.id)
          .eq('status', booking.status); // Only update if status hasn't changed

        if (updateError) {
          logStep("Error updating booking status", updateError);
          break;
        }
        logStep("Booking confirmed via webhook", { bookingId: booking.id });

        // Create invoice for remaining balance if deposit was paid
        if (booking.payment_option === 'deposit') {
          const remainingBalanceCents = booking.total_estimate_cents - booking.deposit_cents;
          
          if (remainingBalanceCents > 0) {
            logStep("Creating invoice for remaining balance", { 
              remainingBalance: remainingBalanceCents,
              serviceDate: booking.service_date
            });

            try {
              // Get or create Stripe customer
              const customers = await stripe.customers.list({ 
                email: booking.email, 
                limit: 1 
              });
              
              let customerId = customers.data[0]?.id;
              if (!customerId) {
                const customer = await stripe.customers.create({
                  email: booking.email,
                  name: `${booking.first_name} ${booking.last_name}`,
                  phone: booking.phone,
                });
                customerId = customer.id;
              }

              // Create invoice
              const invoice = await stripe.invoices.create({
                customer: customerId,
                collection_method: 'send_invoice',
                days_until_due: Math.max(0, Math.ceil((new Date(booking.service_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))),
                description: `Remaining balance for ${booking.service_type} cleaning on ${booking.service_date}`,
                metadata: {
                  booking_id: booking.id,
                  booking_number: booking.booking_number?.toString() || '',
                },
              });

              // Add line item for remaining balance
              await stripe.invoiceItems.create({
                customer: customerId,
                invoice: invoice.id,
                amount: remainingBalanceCents,
                currency: 'usd',
                description: `Remaining Balance - ${booking.service_type} Cleaning Service`,
              });

              // Finalize and send invoice
              const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id, {
                auto_advance: true,
              });

              await stripe.invoices.sendInvoice(invoice.id);

              // Update booking with invoice ID
              await supabase
                .from('bookings')
                .update({ stripe_invoice_id: invoice.id })
                .eq('id', booking.id);

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
            body: { bookingId: booking.id }
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
            body: { bookingId: booking.id }
          });
          logStep("Google Calendar event created successfully");
        } catch (calendarError) {
          logStep("Google Calendar event creation failed (non-critical)", { error: calendarError });
          // Don't fail the webhook - booking is still confirmed
        }

        // Deduct membership credit if booking uses credit (with idempotency and race condition checks)
        if (booking.uses_credit && booking.customer_id) {
          logStep("Attempting to deduct membership credit", { customerId: booking.customer_id });
          
          const { data: creditRecord, error: creditFetchError } = await supabase
            .from('membership_credits')
            .select('*')
            .eq('customer_id', booking.customer_id)
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
              .eq('customer_id', booking.customer_id)
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

          // Send confirmation emails
          logStep("Sending confirmation emails", { email: booking.email });
          
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
                email: booking.email,
                data: {
                  firstName: booking.first_name,
                  lastName: booking.last_name,
                  bookingId: booking.id,
                  serviceDate: booking.service_date,
                  timeSlot: booking.time_slot,
                  serviceType: booking.service_type,
                  homeSize: booking.home_size_id,
                  address: booking.address,
                  city: booking.city,
                  state: booking.state,
                  zipCode: booking.zip_code,
                  totalAmount: booking.total_estimate_cents,
                  depositAmount: booking.deposit_cents,
                  balanceAmount: booking.total_estimate_cents - (booking.payment_option === 'full' ? booking.total_estimate_cents - (booking.full_payment_discount || 0) : booking.deposit_cents),
                  paymentOption: booking.payment_option,
                  useCredit: booking.uses_credit,
                  addOns: booking.add_ons,
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
                email: booking.email,
                data: {
                  firstName: booking.first_name,
                  lastName: booking.last_name,
                  bookingId: booking.id,
                  serviceDate: booking.service_date,
                  timeSlot: booking.time_slot,
                  serviceType: booking.service_type,
                  totalAmount: booking.payment_option === 'full' ? booking.total_estimate_cents - (booking.full_payment_discount || 0) : booking.deposit_cents,
                  balanceAmount: booking.payment_option === 'deposit' ? booking.total_estimate_cents - booking.deposit_cents : 0,
                  paymentOption: booking.payment_option,
                },
              }),
            });

            logStep("Confirmation emails sent successfully");
          } catch (emailError) {
            logStep("Error sending emails (non-blocking)", { error: emailError });
          }

          // Auto-assign cleaner if not already assigned
          if (!booking.cleaner_id) {
            try {
              logStep("Triggering auto-assignment");
              const assignResponse = await supabase.functions.invoke('assign-cleaner', {
                body: { bookingId: booking.id },
              });
              
              if (assignResponse.error) {
                logStep("Auto-assignment failed (non-blocking)", { error: assignResponse.error });
              } else {
                logStep("Cleaner assigned successfully", assignResponse.data);
              }
            } catch (assignError) {
              logStep("Error auto-assigning cleaner (non-blocking)", { error: assignError });
            }
          }

          // Send booking data to Zapier webhook
          try {
            logStep("Triggering Zapier webhook");
            const zapierResponse = await supabase.functions.invoke('send-zapier-webhook', {
              body: { bookingId: booking.id },
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
              body: { bookingId: booking.id },
            });
            
            if (anythingResponse.error) {
              logStep("Anything sync failed (non-blocking)", { error: anythingResponse.error });
            } else {
              logStep("Anything sync successful", anythingResponse.data);
            }
          } catch (anythingError) {
            logStep("Error syncing to Anything (non-blocking)", { error: anythingError });
          }

          // Track referral if referral code was used
          if (booking.metadata && (booking.metadata as any).referral_code) {
            try {
              const referralCode = (booking.metadata as any).referral_code;
              logStep("Processing referral", { code: referralCode });

              // Find the referrer
              const { data: referrer } = await supabase
                .from('customers')
                .select('id')
                .eq('referral_code', referralCode)
                .single();

              if (referrer && referrer.id) {
                // Create referral record
                const { error: referralError } = await supabase
                  .from('referrals')
                  .insert({
                    customer_id: referrer.id,
                    code: referralCode,
                    status: 'pending',
                    credit_cents: 5000, // $50 credit
                  });

                if (referralError) {
                  logStep("Error creating referral record", referralError);
                } else {
                  logStep("Referral tracked successfully", { referrerId: referrer.id });
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
        
        // Determine credits per month based on price
        const priceId = subscription.items.data[0]?.price.id;
        const planNameMap: Record<string, string> = {
          'price_1SR2UhGc7k6gIVcMiKbuq1mo': 'monthly',
          'price_1SR2VNGc7k6gIVcMMI6Fuxga': 'biweekly',
          'price_1SR2VYGc7k6gIVcML2W0jVKS': 'weekly',
        };
        
          const plan = planNameMap[priceId] || 'monthly';
          const creditsPerMonth = { monthly: 1, biweekly: 2, weekly: 4 }[plan];
          const planLabels: Record<string, string> = { 
            monthly: 'Novara Monthly', 
            biweekly: 'Novara Bi-Weekly', 
            weekly: 'Novara Weekly' 
          };
        
        // Get customer email and name
        const customer = await stripe.customers.retrieve(customerId);
        const email = (customer as Stripe.Customer).email || '';
        const name = (customer as Stripe.Customer).name || '';
        
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
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            subscription_id: subscription.id,
            credit_available_date: new Date().toISOString(),
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
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const previousAttributes = event.data.previous_attributes as any;
        logStep("Processing subscription update", { subscriptionId: subscription.id });
        
        // Check if this is a renewal (period changed)
        const isRenewal = previousAttributes?.current_period_end && 
                         previousAttributes.current_period_end !== subscription.current_period_end;
        
        if (isRenewal) {
          logStep("Detected subscription renewal", { subscriptionId: subscription.id });
          
          // Determine credits based on price
          const priceId = subscription.items.data[0]?.price.id;
          const planNameMap: Record<string, string> = {
            'price_1SR2UhGc7k6gIVcMiKbuq1mo': 'monthly',
            'price_1SR2VNGc7k6gIVcMMI6Fuxga': 'biweekly',
            'price_1SR2VYGc7k6gIVcML2W0jVKS': 'weekly',
          };
          
          const plan = planNameMap[priceId] || 'monthly';
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
              current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
              current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
              credit_available_date: new Date().toISOString(),
            })
            .eq('subscription_id', subscription.id);
          
          if (updateError) {
            logStep("Error updating membership credits", updateError);
          } else {
            logStep("Membership credits renewed", { subscriptionId: subscription.id, credits: creditsPerMonth });
            
            // Send renewal and credit allocation emails
            const amount = subscription.items.data[0]?.price.unit_amount || 0;
            await sendMembershipEmail('renewal', email, {
              name,
              plan: planLabels[plan],
              amount,
              renewalDate: new Date(subscription.current_period_end * 1000).toISOString(),
            });
            
            await sendMembershipEmail('credit_allocated', email, {
              name,
              plan: planLabels[plan],
              credits: creditsPerMonth,
              renewalDate: new Date(subscription.current_period_end * 1000).toISOString(),
            });

            // Send SMS notification if phone number available
            try {
              const { data: customerData } = await supabase
                .from('customers')
                .select('phone')
                .eq('id', customerId)
                .single();

              if (customerData?.phone) {
                const smsMessage = `Novara: ${creditsPerMonth} new cleaning credit${creditsPerMonth > 1 ? 's' : ''} added to your ${planLabels[plan]} membership! Book now: https://novaracleaning.com/book`;

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
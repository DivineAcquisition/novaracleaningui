/**
 * Payout to Cleaner
 * 
 * Equivalent to Next.js: /api/stripe/payout
 * 
 * Creates a Stripe Transfer to a cleaner's connected account
 * and logs it in the payouts table.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PayoutRequest {
  cleaner_id: string;
  amount: number; // Amount in cents
  booking_id?: string;
  description?: string;
  metadata?: Record<string, string>;
}

interface PayoutRecord {
  id?: string;
  cleaner_id: string;
  amount: number;
  booking_id?: string;
  stripe_transfer_id?: string;
  stripe_account_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  description?: string;
  failed_reason?: string;
  created_at?: string;
  processed_at?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
    });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Parse request
    const body: PayoutRequest = await req.json();
    
    const { cleaner_id, amount, booking_id, description, metadata } = body;

    // Validate required fields
    if (!cleaner_id) {
      return new Response(
        JSON.stringify({ success: false, error: "cleaner_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!amount || amount <= 0) {
      return new Response(
        JSON.stringify({ success: false, error: "amount must be a positive number (in cents)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Minimum transfer amount is $1 (100 cents)
    if (amount < 100) {
      return new Response(
        JSON.stringify({ success: false, error: "Minimum payout amount is $1.00 (100 cents)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[PAYOUT] Processing payout request", {
      cleaner_id,
      amount,
      booking_id,
    });

    // Fetch cleaner with Stripe account info
    const { data: cleaner, error: fetchError } = await supabase
      .from("cleaners")
      .select("id, first_name, last_name, email, stripe_account_id, charges_enabled, payouts_enabled")
      .eq("id", cleaner_id)
      .single();

    if (fetchError || !cleaner) {
      return new Response(
        JSON.stringify({ success: false, error: "Cleaner not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify cleaner has Stripe account
    if (!cleaner.stripe_account_id) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Cleaner does not have a Stripe account. Please complete onboarding first.",
          code: "NO_STRIPE_ACCOUNT"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify payouts are enabled
    if (!cleaner.payouts_enabled) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Cleaner's Stripe account is not fully set up. Payouts are not enabled.",
          code: "PAYOUTS_NOT_ENABLED"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check for duplicate payout if booking_id provided
    if (booking_id) {
      const { data: existingPayout } = await supabase
        .from("payouts")
        .select("id, status, stripe_transfer_id")
        .eq("cleaner_id", cleaner_id)
        .eq("booking_id", booking_id)
        .in("status", ["completed", "processing"])
        .maybeSingle();

      if (existingPayout) {
        console.log("[PAYOUT] Duplicate payout detected", {
          existingPayoutId: existingPayout.id,
          status: existingPayout.status,
        });

        return new Response(
          JSON.stringify({
            success: false,
            error: "A payout for this booking has already been processed",
            code: "DUPLICATE_PAYOUT",
            existing_payout_id: existingPayout.id,
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Create payout record first (status: processing)
    const payoutRecord: PayoutRecord = {
      cleaner_id,
      amount,
      booking_id,
      stripe_account_id: cleaner.stripe_account_id,
      status: "processing",
      description: description || `Payout to ${cleaner.first_name} ${cleaner.last_name}`,
    };

    const { data: insertedPayout, error: insertError } = await supabase
      .from("payouts")
      .insert(payoutRecord)
      .select()
      .single();

    if (insertError) {
      console.error("[PAYOUT] Failed to create payout record:", insertError);
      throw new Error("Failed to create payout record");
    }

    console.log("[PAYOUT] Payout record created", { 
      payoutId: insertedPayout.id 
    });

    // Create Stripe Transfer
    try {
      const transfer = await stripe.transfers.create({
        amount: amount,
        currency: "usd",
        destination: cleaner.stripe_account_id,
        description: description || `Payout for ${cleaner.first_name} ${cleaner.last_name}`,
        metadata: {
          payout_id: insertedPayout.id,
          cleaner_id: cleaner_id,
          cleaner_name: `${cleaner.first_name} ${cleaner.last_name}`,
          booking_id: booking_id || "",
          ...(metadata || {}),
        },
      });

      console.log("[PAYOUT] Stripe transfer created", {
        transferId: transfer.id,
        amount: transfer.amount,
      });

      // Update payout record with success
      const { error: updateError } = await supabase
        .from("payouts")
        .update({
          stripe_transfer_id: transfer.id,
          status: "completed",
          processed_at: new Date().toISOString(),
        })
        .eq("id", insertedPayout.id);

      if (updateError) {
        console.error("[PAYOUT] Failed to update payout record:", updateError);
        // Don't fail - transfer was successful
      }

      // Update cleaner's total earnings
      const { data: currentCleaner } = await supabase
        .from("cleaners")
        .select("total_earnings_cents")
        .eq("id", cleaner_id)
        .single();

      await supabase
        .from("cleaners")
        .update({
          total_earnings_cents: (currentCleaner?.total_earnings_cents || 0) + amount,
          last_payout_at: new Date().toISOString(),
        })
        .eq("id", cleaner_id);

      return new Response(
        JSON.stringify({
          success: true,
          payout_id: insertedPayout.id,
          transfer_id: transfer.id,
          amount: amount,
          amount_formatted: `$${(amount / 100).toFixed(2)}`,
          cleaner: {
            id: cleaner.id,
            name: `${cleaner.first_name} ${cleaner.last_name}`,
            email: cleaner.email,
          },
          status: "completed",
        }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );

    } catch (stripeError) {
      const errorMessage = stripeError instanceof Error ? stripeError.message : String(stripeError);
      
      console.error("[PAYOUT] Stripe transfer failed:", errorMessage);

      // Update payout record with failure
      await supabase
        .from("payouts")
        .update({
          status: "failed",
          failed_reason: errorMessage,
        })
        .eq("id", insertedPayout.id);

      // Check for specific Stripe errors
      let userMessage = errorMessage;
      let errorCode = "TRANSFER_FAILED";

      if (errorMessage.includes("insufficient funds")) {
        userMessage = "Insufficient funds in platform account";
        errorCode = "INSUFFICIENT_FUNDS";
      } else if (errorMessage.includes("account")) {
        userMessage = "There's an issue with the cleaner's Stripe account. Please contact support.";
        errorCode = "ACCOUNT_ERROR";
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: userMessage,
          code: errorCode,
          payout_id: insertedPayout.id,
        }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[PAYOUT] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage 
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});

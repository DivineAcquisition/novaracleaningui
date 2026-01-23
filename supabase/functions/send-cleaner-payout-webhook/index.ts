import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ZAPIER_CLEANER_PAYOUT_URL = Deno.env.get("ZAPIER_CLEANER_PAYOUT_WEBHOOK_URL") || "";
const GHL_CLEANER_PAYOUT_URL = Deno.env.get("GHL_CLEANER_PAYOUT_WEBHOOK_URL") || "";

const logStep = (step: string, details?: any) => {
  console.log(`[SEND-CLEANER-PAYOUT-WEBHOOK] ${step}`, details ? JSON.stringify(details) : '');
};

// Format currency
function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Format date for display
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { 
    weekday: 'short', 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const { 
      cleanerId, 
      payoutId,
      bookingIds,
      payoutType = 'standard', // standard, bonus, tip, adjustment
      amount,
      stripeTransferId,
      status = 'initiated'
    } = await req.json();
    
    logStep("Processing cleaner payout webhook", { cleanerId, payoutType, amount, status });

    if (!cleanerId) {
      throw new Error("cleanerId is required");
    }

    // Fetch cleaner details
    const { data: cleaner, error: cleanerError } = await supabase
      .from('cleaners')
      .select('*')
      .eq('id', cleanerId)
      .single();

    if (cleanerError || !cleaner) {
      throw new Error(`Cleaner not found: ${cleanerError?.message}`);
    }

    // Fetch booking details if booking IDs provided
    let bookings: any[] = [];
    if (bookingIds && bookingIds.length > 0) {
      const { data: bookingData } = await supabase
        .from('bookings')
        .select('id, booking_number, service_date, service_type, total_estimate_cents, cleaner_payout_cents, tip_cents')
        .in('id', bookingIds);
      
      bookings = bookingData || [];
    }

    // Calculate totals
    const totalPayoutCents = amount || bookings.reduce((sum, b) => sum + (b.cleaner_payout_cents || 0), 0);
    const totalTipsCents = bookings.reduce((sum, b) => sum + (b.tip_cents || 0), 0);
    const bookingCount = bookings.length;

    logStep("Calculated payout totals", { 
      totalPayoutCents, 
      totalTipsCents, 
      bookingCount,
      cleanerName: `${cleaner.first_name} ${cleaner.last_name}`
    });

    // Build the payload for external webhooks
    const payload = {
      // Event Info
      "Event Type": status === 'completed' ? "Payout Completed" : "Payout Initiated",
      "Payout Status": status.charAt(0).toUpperCase() + status.slice(1),
      "Payout Timestamp": new Date().toISOString(),
      
      // Payout Details
      "Payout ID": payoutId || `PAY-${Date.now()}`,
      "Payout Type": payoutType.charAt(0).toUpperCase() + payoutType.slice(1),
      "Stripe Transfer ID": stripeTransferId || "",
      
      // Cleaner Info
      "Cleaner ID": cleaner.id,
      "Cleaner Name": `${cleaner.first_name} ${cleaner.last_name}`,
      "Cleaner Email": cleaner.email,
      "Cleaner Phone": cleaner.phone,
      "Stripe Account ID": cleaner.stripe_account_id || "",
      "Payouts Enabled": cleaner.payouts_enabled ? "Yes" : "No",
      
      // Financial Summary
      "Base Payout Amount": formatCurrency(totalPayoutCents - totalTipsCents),
      "Tips Included": formatCurrency(totalTipsCents),
      "Total Payout Amount": formatCurrency(totalPayoutCents),
      "Total Payout Cents": totalPayoutCents,
      
      // Job Summary
      "Number of Jobs": bookingCount,
      "Job IDs": bookings.map(b => `NOV-${String(b.booking_number).padStart(5, '0')}`).join(', ') || "N/A",
      "Job Dates": bookings.map(b => formatDate(b.service_date)).join(', ') || "N/A",
      
      // Cleaner Stats
      "Total Completed Jobs": cleaner.completed_bookings || 0,
      "Average Rating": cleaner.average_rating ? `${cleaner.average_rating.toFixed(1)}/5` : "N/A",
      "Hourly Rate": cleaner.pay_rate_hr ? `$${cleaner.pay_rate_hr.toFixed(2)}/hr` : "Standard Rate",
      
      // Breakdown by Job (if multiple)
      "Jobs Breakdown": bookings.map(b => ({
        "Booking Number": `NOV-${String(b.booking_number).padStart(5, '0')}`,
        "Service Date": formatDate(b.service_date),
        "Service Type": b.service_type,
        "Job Payout": formatCurrency(b.cleaner_payout_cents || 0),
        "Tip": formatCurrency(b.tip_cents || 0),
        "Total": formatCurrency((b.cleaner_payout_cents || 0) + (b.tip_cents || 0))
      })),
      
      // Period Info (for batch payouts)
      "Payout Period Start": bookings.length > 0 
        ? formatDate(bookings.reduce((min, b) => b.service_date < min ? b.service_date : min, bookings[0].service_date))
        : new Date().toISOString(),
      "Payout Period End": bookings.length > 0 
        ? formatDate(bookings.reduce((max, b) => b.service_date > max ? b.service_date : max, bookings[0].service_date))
        : new Date().toISOString(),
      
      // Meta
      "Created At": new Date().toISOString(),
    };

    // Send to all configured webhooks
    const webhookUrls = [
      { url: ZAPIER_CLEANER_PAYOUT_URL, name: 'Zapier Cleaner Payout' },
      { url: GHL_CLEANER_PAYOUT_URL, name: 'GHL Cleaner Payout' }
    ].filter(w => w.url);

    logStep("Sending to webhooks", { count: webhookUrls.length, targets: webhookUrls.map(w => w.name) });

    if (webhookUrls.length === 0) {
      logStep("No webhooks configured, skipping external sends");
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "No webhooks configured",
          payload 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const results = await Promise.allSettled(
      webhookUrls.map(async (webhook) => {
        logStep(`Sending to ${webhook.name}`);
        
        let retryCount = 0;
        const MAX_RETRIES = 3;
        
        while (retryCount < MAX_RETRIES) {
          try {
            const response = await fetch(webhook.url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            });

            if (response.ok) {
              logStep(`${webhook.name} sent successfully`, { status: response.status });
              return { success: true, webhookName: webhook.name, status: response.status };
            }
            throw new Error(`${webhook.name} failed with status ${response.status}`);
          } catch (err) {
            retryCount++;
            if (retryCount >= MAX_RETRIES) throw err;
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retryCount)));
          }
        }
        throw new Error(`${webhook.name}: All retry attempts failed`);
      })
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    logStep("Webhook results", { successful, failed, total: webhookUrls.length });

    // Log to database
    await supabase.from('webhook_logs').insert({
      webhook_type: 'cleaner_payout',
      event_type: payoutType,
      payload: payload,
      processed_at: new Date().toISOString(),
      status: successful > 0 ? 'sent' : 'failed',
      metadata: { cleanerId, payoutId, totalPayoutCents, bookingCount, successful, failed }
    });

    return new Response(
      JSON.stringify({ 
        success: successful > 0, 
        cleanerId,
        payoutId,
        totalPayoutCents,
        webhooksAttempted: webhookUrls.length,
        webhooksSuccessful: successful,
        webhooksFailed: failed,
        payload 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: successful > 0 ? 200 : 500 }
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

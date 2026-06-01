import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendSms } from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RATING_ACCOUNT_URL = "https://app.novaracleaning.com/account";
const REMINDER_DELAY_MS = 2 * 60 * 60 * 1000; // 2 hours after completion
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // skip bookings completed >7 days ago

const logStep = (step: string, details?: Record<string, unknown>) => {
  const suffix = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[SEND-RATING-REMINDERS] ${step}${suffix}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const now = Date.now();
    const eligibleBefore = new Date(now - REMINDER_DELAY_MS).toISOString();
    const eligibleAfter = new Date(now - MAX_AGE_MS).toISOString();

    logStep("Sweeping for rating reminders", { eligibleBefore, eligibleAfter });

    const { data: bookings, error: fetchError } = await supabase
      .from("bookings")
      .select(
        "id, phone, first_name, completed_at, rating_submitted, rating_reminder_sent_at, cleaner_id, cleaners(first_name)",
      )
      .eq("status", "completed")
      .is("rating_reminder_sent_at", null)
      .eq("rating_submitted", false)
      .not("phone", "is", null)
      .not("cleaner_id", "is", null)
      .lte("completed_at", eligibleBefore)
      .gte("completed_at", eligibleAfter)
      .limit(50);

    if (fetchError) {
      throw fetchError;
    }

    logStep("Candidates found", { count: bookings?.length ?? 0 });

    const results = { attempted: 0, sent: 0, skipped: 0, failed: 0 };

    for (const booking of bookings || []) {
      results.attempted++;

      if (booking.rating_submitted || booking.rating_reminder_sent_at) {
        results.skipped++;
        continue;
      }

      const cleanerName =
        (booking as { cleaners?: { first_name?: string | null } | null })
          .cleaners?.first_name?.trim() || "your cleaner";
      const greeting = booking.first_name?.trim()
        ? `Hi ${booking.first_name.trim()},`
        : "Hi,";

      const message =
        `${greeting} thanks again for choosing Novara Cleaning! ` +
        `How did ${cleanerName} do? Please take a moment to rate your cleaner in your account — ` +
        `your feedback goes into our scoring system and helps us keep quality high: ` +
        `${RATING_ACCOUNT_URL}\n\nReply STOP to opt out.`;

      const sent = await sendSms(supabase, {
        toPhone: booking.phone,
        message,
        type: "reminder",
      });

      if (!sent) {
        results.failed++;
        logStep("SMS failed", { bookingId: booking.id });
        continue;
      }

      const { error: stampError } = await supabase
        .from("bookings")
        .update({ rating_reminder_sent_at: new Date().toISOString() })
        .eq("id", booking.id)
        .is("rating_reminder_sent_at", null);

      if (stampError) {
        results.failed++;
        logStep("Failed to stamp reminder sent", {
          bookingId: booking.id,
          error: stampError.message,
        });
        continue;
      }

      results.sent++;
      logStep("Rating reminder sent", { bookingId: booking.id });
    }

    return new Response(
      JSON.stringify({ success: true, results, timestamp: new Date().toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message });
    return new Response(
      JSON.stringify({ error: message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});

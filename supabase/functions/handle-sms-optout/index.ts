import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface OptOutRequest {
  phone: string;
  message?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { phone, message }: OptOutRequest = await req.json();

    console.log("Processing SMS opt-out for:", phone);

    if (!phone) {
      throw new Error("Phone number is required");
    }

    // Format phone to remove non-digits
    const cleanPhone = phone.replace(/\D/g, "");

    // Check if message contains STOP keyword
    const isOptOut = !message || message.toUpperCase().includes("STOP");

    if (!isOptOut) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Invalid opt-out request",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    const digits = cleanPhone.length > 10 ? cleanPhone.slice(-10) : cleanPhone;
    const nowIso = new Date().toISOString();
    await supabase.from("compliance_sms_suppressions").upsert({
      phone_digits: digits,
      suppressed_at: nowIso,
      source: "stop",
      lifted_at: null,
    }, { onConflict: "phone_digits" });

    // Find cleaner by phone. Customer numbers are not cleaners, and STOP
    // still has to suppress them.
    const { data: cleaner } = await supabase
      .from("cleaners")
      .select("id, email, first_name, last_name")
      .eq("phone", cleanPhone)
      .maybeSingle();

    if (cleaner) {
      const { error: updateError } = await supabase
        .from("cleaners")
        .update({
          sms_notifications_enabled: false,
          updated_at: nowIso,
        })
        .eq("id", cleaner.id);

      if (updateError) {
        console.error("Error updating cleaner:", updateError);
      }
    }

    // Log the revocation in sms_consent_logs
    const { error: logError } = await supabase
      .from("sms_consent_logs")
      .insert({
        phone: digits,
        email: cleaner?.email || null,
        first_name: cleaner?.first_name || null,
        last_name: cleaner?.last_name || null,
        consent_given: false,
        revoked_at: nowIso,
      });

    if (logError) {
      console.error("Error logging opt-out:", logError);
      // Don't fail if logging fails
    }

    console.log("SMS opt-out processed", { digits, cleaner: cleaner?.id || null });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Successfully opted out of SMS notifications",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error("Error in handle-sms-optout function:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});

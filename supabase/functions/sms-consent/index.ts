import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ConsentRequest {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  ipAddress?: string;
  userAgent?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { firstName, lastName, phone, email, ipAddress, userAgent }: ConsentRequest = await req.json();

    console.log("Processing SMS consent for:", { phone, firstName, lastName });

    // Validate required fields
    if (!firstName || !lastName || !phone) {
      throw new Error("Missing required fields: firstName, lastName, and phone are required");
    }

    // Format phone to remove non-digits
    const cleanPhone = phone.replace(/\D/g, "");
    
    if (cleanPhone.length !== 10) {
      throw new Error("Phone number must be 10 digits");
    }

    // Check if cleaner exists with this phone
    const { data: cleaner, error: cleanerError } = await supabase
      .from("cleaners")
      .select("id, email")
      .eq("phone", cleanPhone)
      .single();

    if (cleanerError && cleanerError.code !== "PGRST116") {
      console.error("Error checking cleaner:", cleanerError);
      throw new Error("Failed to check cleaner status");
    }

    // Update cleaner if exists
    if (cleaner) {
      const { error: updateError } = await supabase
        .from("cleaners")
        .update({
          sms_notifications_enabled: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", cleaner.id);

      if (updateError) {
        console.error("Error updating cleaner:", updateError);
        throw new Error("Failed to update SMS preferences");
      }

      console.log("Updated SMS preferences for cleaner:", cleaner.id);
    }

    // Log consent in sms_consent_logs
    const { error: logError } = await supabase
      .from("sms_consent_logs")
      .insert({
        phone: cleanPhone,
        email: email || cleaner?.email,
        first_name: firstName,
        last_name: lastName,
        consent_given: true,
        ip_address: ipAddress,
        user_agent: userAgent,
      });

    if (logError) {
      console.error("Error logging consent:", logError);
      throw new Error("Failed to log consent");
    }

    console.log("SMS consent logged successfully");

    // Send confirmation (optional - would need SMS service)
    // You could call send-sms-notification function here

    return new Response(
      JSON.stringify({
        success: true,
        message: "SMS consent recorded successfully",
        cleanerUpdated: !!cleaner,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error("Error in sms-consent function:", error);
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

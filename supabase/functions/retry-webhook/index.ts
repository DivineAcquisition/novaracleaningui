import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  console.log(`[RETRY-WEBHOOK] ${step}`, details ? JSON.stringify(details) : '');
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const { failureId, bookingId } = await req.json();
    logStep("Retrying webhook", { failureId, bookingId });

    // Get the failure record
    const { data: failure, error: fetchError } = await supabase
      .from('webhook_failures')
      .select('*')
      .eq('id', failureId)
      .single();

    if (fetchError || !failure) {
      throw new Error(`Webhook failure not found: ${fetchError?.message}`);
    }

    logStep("Failure record fetched", { retryCount: failure.retry_count });

    // Invoke the send-zapier-webhook function
    const { data, error: webhookError } = await supabase.functions.invoke(
      'send-zapier-webhook',
      { body: { bookingId } }
    );

    if (webhookError) {
      // Update retry count and error
      await supabase
        .from('webhook_failures')
        .update({
          retry_count: failure.retry_count + 1,
          error_message: webhookError.message,
        })
        .eq('id', failureId);

      throw webhookError;
    }

    // Mark as resolved on success
    await supabase
      .from('webhook_failures')
      .update({ resolved: true })
      .eq('id', failureId);

    logStep("Webhook retry successful", { failureId });

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  console.log(`[TEST-ZAPIER-WEBHOOK] ${step}`, details ? JSON.stringify(details) : '');
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
    logStep("Test webhook invocation started");

    // Get the most recent test job
    const { data: jobs, error: jobError } = await supabase
      .from('jobs')
      .select('id')
      .eq('status', 'New')
      .order('created_at', { ascending: false })
      .limit(1);

    if (jobError || !jobs || jobs.length === 0) {
      throw new Error('No test jobs found. Please create a test job first.');
    }

    const jobId = jobs[0].id;
    logStep("Testing with job", { jobId });

    // Invoke the send-zapier-webhook function with job dispatch
    const { data, error: webhookError } = await supabase.functions.invoke(
      'send-zapier-webhook',
      { body: { jobId } }
    );

    if (webhookError) {
      throw webhookError;
    }

    logStep("Test dispatch webhook sent successfully");

    return new Response(
      JSON.stringify({ 
        success: true, 
        jobId,
        message: 'Test dispatch webhook sent with cleaner team metrics. Check your Zapier dashboard.' 
      }),
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

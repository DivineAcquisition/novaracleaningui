// ─── get-contractor-training ───────────────────────────────────────────
//
// Returns the Google Drive folder URL (and optional embeddable variant)
// for the contractor training portal. Reads from public.app_secrets so an
// operator can rotate the link in SQL without redeploying the contractor
// portal. Also stamps the calling cleaner's ob_training_accessed_at when
// `mode=open` is passed (so the onboarding checklist auto-completes).
//
// Body shape (POST, optional):
//   { mode?: 'fetch' | 'open' }   - 'open' both returns links AND stamps
//                                    ob_training_accessed for the caller
//
// Response:
//   { url: string | null, embedUrl: string | null }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

    const { data: rows } = await supabase
      .from("app_secrets")
      .select("key,value")
      .in("key", [
        "CONTRACTOR_TRAINING_DRIVE_URL",
        "CONTRACTOR_TRAINING_DRIVE_EMBED_URL",
      ]);
    const map: Record<string, string> = {};
    for (const r of (rows ?? []) as Array<{ key: string; value: string | null }>) {
      if (r.value && typeof r.value === "string") map[r.key] = r.value.trim();
    }
    const url = map["CONTRACTOR_TRAINING_DRIVE_URL"] || null;
    const embedUrl = map["CONTRACTOR_TRAINING_DRIVE_EMBED_URL"] || null;

    // Optionally stamp ob_training_accessed for the calling cleaner.
    let mode = "fetch";
    try {
      const body = await req.json();
      if (body?.mode) mode = String(body.mode);
    } catch {
      // GETs / empty body are fine — default to 'fetch'.
    }

    if (mode === "open") {
      const authHeader = req.headers.get("Authorization");
      if (authHeader) {
        try {
          const token = authHeader.replace("Bearer ", "");
          const { data } = await supabase.auth.getUser(token);
          const userId = data?.user?.id;
          if (userId) {
            await supabase
              .from("cleaners")
              .update({
                ob_training_accessed: true,
                ob_training_accessed_at: new Date().toISOString(),
              })
              .eq("user_id", userId)
              .eq("ob_training_accessed", false);
          }
        } catch (err) {
          console.warn("[get-contractor-training] stamp failed", err instanceof Error ? err.message : String(err));
        }
      }
    }

    return new Response(
      JSON.stringify({
        url,
        embedUrl,
        configured: Boolean(url || embedUrl),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[get-contractor-training] error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

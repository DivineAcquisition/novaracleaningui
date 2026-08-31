// --- send-partner-email --------------------------------------------------
//
// Compatibility wrapper. Host lifecycle mail now goes through the partnership
// communications layer (templates, opt-outs, quiet hours, the shared log).
// Callers that still invoke this function by name keep working; they no
// longer talk to Resend directly, and they never send host-branded copy to
// a cleaner.
//
// Types (full partner lifecycle, front to end):
//   application_received, welcome, agreement_sent, agreement_signed,
//   payment_link, turnover_confirmed, turnover_assigned,
//   turnover_cleaner_confirmed, turnover_in_progress, turnover_completed,
//   turnover_cancelled, turnover_rescheduled

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendHostPartnership } from "../_shared/partnership-comms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: true });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  let body: { type?: string; email?: string; data?: Record<string, unknown> };
  try { body = await req.json(); } catch { return json({ ok: true }); }
  const type = String(body?.type || "");
  const email = String(body?.email || "").trim().toLowerCase();
  if (!type || !email || !email.includes("@")) return json({ ok: true });

  const data = body.data || {};
  const phone = typeof data.phone === "string" ? data.phone : null;
  const hostId = typeof data.hostId === "string" ? data.hostId : null;
  try {
    await sendHostPartnership(admin, type, email, phone, data, {
      hostId,
      trigger: `send-partner-email.${type}`,
    });
  } catch (e) {
    console.error("[send-partner-email] partnership send failed", type, email, e instanceof Error ? e.message : String(e));
  }
  return json({ ok: true });
});

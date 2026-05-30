// ─── apploye-invite-cleaner ──────────────────────────────────────────────
//
// Admin-triggered. Invites a cleaner into the Apploye workspace so they
// can install the desktop / mobile app and start clocking in. Apploye
// emails them the download link itself.
//
// Body: { cleanerId: uuid }
// Response: { ok: true, memberId, inviteUrl } on success.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { getApployeConfig, inviteMember } from "../_shared/apploye-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const cleanerId = String((body as any)?.cleanerId || "");
    if (!cleanerId) return json({ ok: false, error: "cleanerId required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const cfg = await getApployeConfig(supabase);
    if (!cfg) {
      return json({
        ok: false,
        error: "Apploye not configured",
        details:
          "Set APPLOYE_API_KEY and APPLOYE_WORKSPACE_ID in app_secrets (Cloud Agents → Secrets in the Cursor dashboard).",
      }, 503);
    }

    const { data: cleaner } = await supabase
      .from("cleaners")
      .select("id, first_name, last_name, email, phone, apploye_member_id")
      .eq("id", cleanerId)
      .maybeSingle();
    if (!cleaner) return json({ ok: false, error: "cleaner not found" }, 404);
    if (!cleaner.email) return json({ ok: false, error: "cleaner has no email" }, 400);
    if (cleaner.apploye_member_id) {
      return json({
        ok: true,
        memberId: cleaner.apploye_member_id,
        alreadyInvited: true,
        message: "Cleaner already linked to an Apploye member.",
      });
    }

    const result = await inviteMember(cfg, {
      name: `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim() || "Cleaner",
      email: cleaner.email,
      phone: cleaner.phone || undefined,
      role: "employee",
    });

    if (!result.memberId) {
      return json(
        {
          ok: false,
          error: "Apploye invite failed",
          details: result.raw,
        },
        502,
      );
    }

    await supabase
      .from("cleaners")
      .update({
        apploye_member_id: result.memberId,
        apploye_invited_at: new Date().toISOString(),
      })
      .eq("id", cleanerId);

    await supabase.from("events").insert({
      event_type: "cleaner.apploye_invited",
      cleaner_id: cleanerId,
      source: "apploye-invite-cleaner",
      summary: `Apploye invite sent to ${cleaner.email}`,
      data: { memberId: result.memberId, inviteUrl: result.inviteUrl },
    }).then(() => undefined).catch(() => undefined);

    return json({ ok: true, memberId: result.memberId, inviteUrl: result.inviteUrl });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});

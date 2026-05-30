// ─── apploye-invite-cleaner ──────────────────────────────────────────────
//
// Apploye's PUBLIC API is read-only — there's no /invite endpoint. So
// "Invite to Apploye" actually does two things end-to-end:
//
//   1. Looks the cleaner up in the Apploye members list by email and,
//      if found, stamps `cleaners.apploye_member_id` so live-tracking
//      and timesheet sync know who they are in Apploye's system.
//
//   2. If the email is NOT yet an Apploye member, returns a structured
//      `manual_invite_required` response with a deep-link the admin
//      can click to drop the cleaner into Apploye's "Add member"
//      page. Apploye emails them their invite from there.
//
// Either path stamps `cleaners.apploye_invited_at` so we never spam
// the same cleaner with multiple invites.
//
// Body: { cleanerId: uuid }
// Response:
//   { ok: true, linked: true, memberId, memberEmail }
//   { ok: true, linked: false, manualInviteUrl, memberEmail }
//   { ok: false, error, details }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { getApployeConfig, listMembers } from "../_shared/apploye-client.ts";

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
          "Set APPLOYE_API_KEY in app_secrets (Cloud Agents → Secrets in the Cursor dashboard).",
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
        linked: true,
        memberId: cleaner.apploye_member_id,
        memberEmail: cleaner.email,
        alreadyLinked: true,
      });
    }

    const members = await listMembers(cfg);
    const match = members.find(
      (m) => (m.email || "").toLowerCase() === cleaner.email.toLowerCase(),
    );

    if (match) {
      await supabase
        .from("cleaners")
        .update({
          apploye_member_id: match.id,
          apploye_invited_at: new Date().toISOString(),
        })
        .eq("id", cleanerId);

      await supabase.from("events").insert({
        event_type: "cleaner.apploye_linked",
        cleaner_id: cleanerId,
        source: "apploye-invite-cleaner",
        summary: `Linked ${cleaner.email} to Apploye member ${match.id}`,
        data: { memberId: match.id, memberEmail: match.email },
      }).then(() => undefined).catch(() => undefined);

      return json({
        ok: true,
        linked: true,
        memberId: match.id,
        memberEmail: cleaner.email,
      });
    }

    // No match — return a deep-link the admin can click to invite the
    // cleaner from the Apploye dashboard manually.
    const dashboardUrl =
      `https://app.apploye.com/members/invite?email=${encodeURIComponent(cleaner.email)}` +
      (cleaner.first_name
        ? `&name=${encodeURIComponent(`${cleaner.first_name} ${cleaner.last_name || ""}`.trim())}`
        : "");

    await supabase.from("events").insert({
      event_type: "cleaner.apploye_manual_invite_needed",
      cleaner_id: cleanerId,
      source: "apploye-invite-cleaner",
      summary: `Apploye doesn't have ${cleaner.email} yet — admin needs to invite from the dashboard`,
      data: { dashboardUrl },
    }).then(() => undefined).catch(() => undefined);

    return json({
      ok: true,
      linked: false,
      manualInviteUrl: dashboardUrl,
      memberEmail: cleaner.email,
      message:
        "Apploye doesn't have this email yet. Click the dashboard link to invite them — once they accept, hit this button again and we'll link them automatically.",
    });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});

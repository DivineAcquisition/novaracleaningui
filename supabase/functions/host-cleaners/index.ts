// host-cleaners
//
// Host-facing cleaner roster + change requests, split out of partner-turnover
// so it can ship independently. Host-JWT gated. Two actions:
//   host.cleaners        → roster + per-property crew (FIRST NAMES ONLY) + open requests
//   cleaner.requestChange → record a replace/additional/remove request + ping ops
//
// Hosts never see contact info and never directly reassign — a request goes to
// ops who fulfil it with the existing crew tools. Caps: 2 cleaners/property,
// roster of 10.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { notifyDiscord } from "../_shared/discord.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}

// deno-lint-ignore no-explicit-any
type Any = any;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Not signed in." }, 401);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );
    const { data: u } = await userClient.auth.getUser();
    const userId = u?.user?.id;
    if (!userId) return json({ error: "Not signed in." }, 401);

    const { data: host } = await admin.from("hosts").select("*").eq("user_id", userId).maybeSingle();
    if (!host) return json({ error: "No host profile." }, 400);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "host.cleaners");

    // ── host.cleaners ────────────────────────────────────────────────────
    if (action === "host.cleaners") {
      const { data: props } = await admin
        .from("properties")
        .select("id, nickname, address, sqft, target_crew_size")
        .eq("host_id", host.id);
      const propIds = (props || []).map((p: Any) => p.id);
      const byProperty: Record<string, Array<{ id: string; firstName: string; source: string }>> = {};
      const rosterIds = new Set<string>();

      if (propIds.length) {
        const { data: crew } = await admin
          .from("turnover_crew")
          .select("cleaner_id, property_id, priority, active")
          .in("property_id", propIds)
          .eq("active", true)
          .eq("is_turnover_crew", true)
          .order("priority", { ascending: true });
        for (const c of crew || []) {
          (byProperty[c.property_id] ||= []).push({ id: c.cleaner_id, firstName: "", source: "preferred" });
          rosterIds.add(c.cleaner_id);
        }
      }
      const { data: trs } = await admin
        .from("turnover_requests")
        .select("property_id, assigned_cleaner_id, status, requested_date")
        .eq("host_id", host.id)
        .not("assigned_cleaner_id", "is", null)
        .order("requested_date", { ascending: false });
      for (const t of trs || []) {
        const list = (byProperty[t.property_id] ||= []);
        if (!list.find((x) => x.id === t.assigned_cleaner_id)) list.push({ id: t.assigned_cleaner_id, firstName: "", source: "assigned" });
        rosterIds.add(t.assigned_cleaner_id);
      }

      const nameById = new Map<string, string>();
      if (rosterIds.size) {
        const { data: cs } = await admin.from("cleaners").select("id, first_name").in("id", Array.from(rosterIds));
        for (const c of cs || []) nameById.set(String(c.id), c.first_name || "Cleaner");
      }
      for (const pid of Object.keys(byProperty)) {
        byProperty[pid] = byProperty[pid].map((x) => ({ ...x, firstName: nameById.get(x.id) || "Cleaner" })).slice(0, 2);
      }
      const roster = Array.from(rosterIds).slice(0, 10).map((id) => ({ id, firstName: nameById.get(id) || "Cleaner" }));

      const { data: openReqs } = await admin
        .from("cleaner_change_requests")
        .select("id, property_id, current_cleaner_id, kind, reason, status, created_at")
        .eq("host_id", host.id)
        .eq("status", "open");

      return json({
        roster,
        rosterMax: 10,
        perPropertyMax: 2,
        byProperty,
        properties: props || [],
        openRequests: openReqs || [],
      });
    }

    // ── cleaner.requestChange ────────────────────────────────────────────
    if (action === "cleaner.requestChange") {
      const kind = ["replace", "additional", "remove"].includes(body.kind) ? body.kind : "replace";
      const propertyId: string | null = body.propertyId || null;
      if (propertyId) {
        const { data: prop } = await admin.from("properties").select("id, host_id").eq("id", propertyId).maybeSingle();
        if (!prop || prop.host_id !== host.id) return json({ error: "Property not found" }, 404);
      }
      if (kind === "additional") {
        const { count } = await admin
          .from("turnover_crew")
          .select("id", { count: "exact", head: true })
          .eq("property_id", propertyId)
          .eq("active", true);
        if ((count || 0) >= 2) {
          return json({ error: "Each property can have up to 2 regular cleaners. Replace one instead." }, 409);
        }
      }
      const { data: reqRow, error: reqErr } = await admin.from("cleaner_change_requests").insert({
        host_id: host.id,
        property_id: propertyId,
        turnover_id: body.turnoverId || null,
        current_cleaner_id: body.currentCleanerId || null,
        kind,
        reason: (body.reason || "").trim() || null,
      }).select("id").single();
      if (reqErr) return json({ error: reqErr.message }, 500);

      let propLabel = "a property";
      if (propertyId) {
        const { data: p } = await admin.from("properties").select("nickname, address").eq("id", propertyId).maybeSingle();
        propLabel = p?.nickname || p?.address || propLabel;
      }
      const kindLabel = kind === "replace" ? "REPLACE a cleaner" : kind === "additional" ? "ADD a cleaner" : "REMOVE a cleaner";
      await notifyDiscord(admin, {
        title: "Host cleaner-change request",
        color: 15844367,
        fields: [
          { name: "Host", value: host.name || host.email || "-", inline: true },
          { name: "Property", value: propLabel, inline: true },
          { name: "Request", value: kindLabel, inline: true },
          { name: "Reason", value: (body.reason || "—").toString().slice(0, 500), inline: false },
        ],
        description: "Action it in admin → Partnerships → crew, then mark the request resolved.",
      }).catch(() => undefined);

      return json({ ok: true, requestId: reqRow.id });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[host-cleaners]", msg);
    return json({ error: msg }, 500);
  }
});

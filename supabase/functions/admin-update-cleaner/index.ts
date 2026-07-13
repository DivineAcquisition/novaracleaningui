// admin-update-cleaner
//
// Admin/VA: edit a cleaner's personal & profile info from the Cleaners tab —
// name, contact, home address, service area, skills, travel radius. Only the
// allow-listed fields below are writable; lifecycle/status/pay stay with
// their dedicated flows (cleaner-admin-action, terminate-cleaner, payroll).
// Re-syncs the contractor to GHL afterwards (best-effort).
//
// Body: { cleanerId, fields: { first_name?, last_name?, email?, phone?,
//         home_address?, home_city?, state?, home_zip?, service_zip_codes?,
//         max_travel_miles?, preferred_work_days?, skillset? } }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}

// deno-lint-ignore no-explicit-any
type SB = any;

async function ensureAdminOrVa(admin: SB, req: Request): Promise<string> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) throw new Error("Not signed in.");
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const ok = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
  if (!ok) throw new Error("Admins or VAs only.");
  return u.user.id;
}

const TEXT_FIELDS = ["first_name", "last_name", "email", "phone", "home_address", "home_city", "state", "home_zip"] as const;
const ARRAY_FIELDS = ["service_zip_codes", "preferred_work_days", "skillset"] as const;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const callerId = await ensureAdminOrVa(admin, req);
    const body = await req.json().catch(() => ({}));
    const cleanerId = String(body?.cleanerId || "");
    const fields = (body?.fields || {}) as Record<string, unknown>;
    if (!cleanerId) return json({ ok: false, error: "cleanerId required" }, 400);

    const { data: cleaner } = await admin.from("cleaners").select("id, first_name, last_name, email").eq("id", cleanerId).maybeSingle();
    if (!cleaner) return json({ ok: false, error: "Cleaner not found" }, 404);

    const patch: Record<string, unknown> = {};
    for (const f of TEXT_FIELDS) {
      if (f in fields) {
        const v = String(fields[f] ?? "").trim();
        patch[f] = v || null;
      }
    }
    for (const f of ARRAY_FIELDS) {
      if (f in fields) {
        const arr = Array.isArray(fields[f])
          ? (fields[f] as unknown[]).map((x) => String(x).trim()).filter(Boolean)
          : String(fields[f] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
        patch[f] = arr;
      }
    }
    if ("max_travel_miles" in fields) {
      const n = parseInt(String(fields.max_travel_miles ?? ""), 10);
      patch.max_travel_miles = Number.isFinite(n) && n > 0 ? n : null;
    }
    // Stated constraints ({ no_work_after, no_work_before, notes }) — feed
    // the risk layer as mismatch flags, never auto-restriction.
    if ("constraints" in fields) {
      const c = (fields.constraints || {}) as Record<string, unknown>;
      const cleanC: Record<string, string> = {};
      for (const k of ["no_work_after", "no_work_before", "notes"]) {
        const v = String(c[k] ?? "").trim().slice(0, 500);
        if (v) cleanC[k] = v;
      }
      patch.constraints = Object.keys(cleanC).length > 0 ? cleanC : null;
    }
    if (Object.keys(patch).length === 0) return json({ ok: false, error: "No editable fields provided." }, 400);

    if (patch.email && !/.+@.+\..+/.test(String(patch.email))) {
      return json({ ok: false, error: "Invalid email." }, 400);
    }
    if (patch.phone) patch.phone = String(patch.phone).replace(/[^\d+]/g, "");

    const { error: upErr } = await admin.from("cleaners").update(patch).eq("id", cleanerId);
    if (upErr) throw upErr;

    // Audit + GHL resync (both best-effort).
    await admin.from("events").insert({
      event_type: "cleaner.profile_updated",
      cleaner_id: cleanerId,
      source: "admin-update-cleaner",
      summary: `Cleaner profile updated (${Object.keys(patch).join(", ")}) for ${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim(),
      data: { fields: Object.keys(patch), by: callerId },
    }).then(() => undefined, () => undefined);
    await admin.functions.invoke("sync-cleaner-to-ghl", { body: { cleanerId } }).catch(() => undefined);

    return json({ ok: true, updated: Object.keys(patch) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("Not signed in") ? 401 : msg.includes("only") ? 403 : 500;
    return json({ ok: false, error: msg }, status);
  }
});

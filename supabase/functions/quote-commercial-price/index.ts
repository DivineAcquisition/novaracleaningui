// quote-commercial-price
//
// The live commercial quote — the counterpart to quote-dynamic-price, and the
// only place the formula runs for a VA on a call:
//
//   price = sqft × facility_type_base_rate × scope_multiplier × size_tier_multiplier
//
// It returns four things, and the caller needs all four:
//
//   • the formula's number, always, as the anchor to price against
//   • whether that number may be QUOTED — at or above the walkthrough
//     threshold it may not, and an estimate range is returned instead
//   • the recommended crew size for the scope against the service window
//   • the account's compliance state, so "we can't book this" surfaces while
//     the client is still on the phone rather than at submit
//
// Admin/VA only. Read-only: nothing here writes.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  computeCommercialQuote,
  photoZonesForSite,
  windowHoursBetween,
} from "../_shared/commercial-pricing.ts";
import {
  accountCompliance,
  latestCompletedWalkthrough,
  loadCommercialConfig,
} from "../_shared/commercial-config.ts";

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

// deno-lint-ignore no-explicit-any
type SB = any;

interface QuoteBody {
  sqft?: number;
  facilityTypeKey?: string;
  scopeLevel?: string;
  windowHours?: number;
  serviceWindowStart?: string;
  serviceWindowEnd?: string;
  businessAccountId?: string;
  businessSiteId?: string;
  /** Include the editable config in the response so the UI can render options. */
  includeConfig?: boolean;
}

async function ensureAdminOrVa(admin: SB, req: Request): Promise<void> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) throw new Error("Not signed in.");
  if (jwt === (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "")) return;
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
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    await ensureAdminOrVa(admin, req);
    const body = (await req.json().catch(() => ({}))) as QuoteBody;
    const config = await loadCommercialConfig(admin);

    // A site on file already knows its own square footage, facility type, and
    // service window — a second booking against it never re-enters them.
    let site: Record<string, unknown> | null = null;
    if (body.businessSiteId) {
      const { data } = await admin.from("business_sites").select("*")
        .eq("id", body.businessSiteId).maybeSingle();
      site = data || null;
    }

    const sqft = Number(body.sqft) > 0
      ? Number(body.sqft)
      : Number(site?.sqft) > 0 ? Number(site?.sqft) : 0;
    const facilityTypeKey = String(
      body.facilityTypeKey || site?.facility_type_key || "",
    ).trim();
    const scopeLevel = String(body.scopeLevel || site?.scope_level || "standard").trim();

    const windowHours = Number(body.windowHours) > 0
      ? Number(body.windowHours)
      : windowHoursBetween(
        body.serviceWindowStart || (site?.service_window_start as string),
        body.serviceWindowEnd || (site?.service_window_end as string),
      );

    const quote = computeCommercialQuote(config, {
      sqft,
      facilityTypeKey,
      scopeLevel,
      windowHours,
    });

    // Compliance is an account-level fact; surface it with the quote so the
    // blocker is known before anyone promises a date.
    const compliance = body.businessAccountId
      ? await accountCompliance(admin, body.businessAccountId)
      : null;

    // A large site is only bookable if the walkthrough it needs already exists.
    const walkthrough = quote.requiresWalkthrough && body.businessSiteId
      ? await latestCompletedWalkthrough(admin, body.businessSiteId)
      : null;

    return json({
      ok: true,
      quote,
      compliance,
      walkthrough,
      photoZones: photoZonesForSite(config, sqft, site?.photo_zones),
      site: site
        ? {
          id: site.id,
          nickname: site.nickname,
          sqft: site.sqft ?? null,
          facility_type_key: site.facility_type_key ?? null,
          scope_level: site.scope_level ?? null,
          service_window_start: site.service_window_start ?? null,
          service_window_end: site.service_window_end ?? null,
        }
        : null,
      config: body.includeConfig ? config : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("Not signed in") ? 401 : msg.includes("only") ? 403 : 500;
    return json({ ok: false, error: msg }, status);
  }
});

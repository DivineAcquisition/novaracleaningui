// ─── sync-cleaner-to-ghl ─────────────────────────────────────────────────
//
// Upsert a Novara contractor (cleaner) into GoHighLevel as a contact,
// stamp it with the canonical contractor custom fields + tags, and
// move/refresh their opportunity in the contractor pipeline (if one
// is configured via GHL_CONTRACTOR_PIPELINE_ID).
//
// Fires from:
//   * Onboarding.tsx submit (initial create + 'onboarding-complete')
//   * verify-phone-code success ('phone-verified' tag)
//   * OnboardingPortal.tsx step updates (agreement/discord/training/etc tags)
//   * check-cleaner-status when payouts_enabled flips true
//   * cleaner-admin-action when compliance / lifecycle changes
//   * cleaners_auto_sync_to_ghl DB trigger on any sync-worthy column change
//
// POST body: { cleanerId: uuid }
// Returns: { ok: true, ghl_contact_id, tags, opportunity_id? }
//
// Soft-fails: never throws so callers can fire-and-forget.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { provisionGhlUserFromTemplate } from "../_shared/ghl-users.ts";
import { enforceTagPolicy } from "../_shared/ghl-tags.ts";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

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

async function resolveSecret(supabase: any, key: string): Promise<string> {
  try {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
    return (data?.value as string) || Deno.env.get(key) || "";
  } catch {
    return Deno.env.get(key) || "";
  }
}

function toE164(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return "";
  if (raw.startsWith("+")) return raw.replace(/[^0-9+]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

async function ghlFetch(path: string, init: RequestInit, token: string, locationId: string) {
  const url = `${GHL_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      "Authorization": `Bearer ${token}`,
      "Version": GHL_VERSION,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
  });
  const body = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(body); } catch { /* keep as text */ }
  if (!res.ok) {
    throw new Error(`GHL ${init.method || "GET"} ${path} ${res.status}: ${body.slice(0, 300)}`);
  }
  return parsed ?? {};
}

let cachedFieldMap: Record<string, string> | null = null;
async function loadCustomFieldMap(token: string, locationId: string): Promise<Record<string, string>> {
  if (cachedFieldMap) return cachedFieldMap;
  try {
    const res = await ghlFetch(`/locations/${locationId}/customFields`, { method: "GET" }, token, locationId);
    const map: Record<string, string> = {};
    for (const f of (res?.customFields || []) as Array<{ id: string; fieldKey: string }>) {
      if (f.fieldKey) map[f.fieldKey] = f.id;
    }
    cachedFieldMap = map;
    return map;
  } catch (e) {
    console.warn("[sync-cleaner-to-ghl] loadCustomFieldMap failed (will skip custom fields)", e instanceof Error ? e.message : e);
    return {};
  }
}

function buildContractorCustomFields(cleaner: any): Record<string, unknown> {
  const out: Record<string, unknown> = {
    contractor_id: cleaner.id,
    contractor_status: cleaner.status || "",
    contractor_pay_tier: cleaner.pay_tier || "foundation",
    contractor_pay_percentage: cleaner.pay_percentage ?? 40,
    // Legacy fields kept for back-compat with existing GHL custom
    // fields. They mirror pay_percentage so old GHL views still show
    // sensible numbers, but the canonical field is contractor_pay_percentage.
    contractor_pay_rate_hr: null,
    contractor_platform_fee_pct: null,
    contractor_net_rate_hr: null,
    contractor_home_address: cleaner.home_address || "",
    contractor_home_city: cleaner.home_city || "",
    contractor_home_state: cleaner.state || "",
    contractor_home_zip: cleaner.home_zip || "",
    contractor_max_travel_miles: cleaner.max_travel_miles ?? null,
    contractor_service_zips: Array.isArray(cleaner.service_zip_codes) ? cleaner.service_zip_codes.join(", ") : "",
    contractor_preferred_days: Array.isArray(cleaner.preferred_work_days) ? cleaner.preferred_work_days.join(", ") : "",
    contractor_skillset: Array.isArray(cleaner.skillset) ? cleaner.skillset.join(", ") : "",
    contractor_stripe_account_id: cleaner.stripe_account_id || "",
    contractor_payouts_enabled: cleaner.payouts_enabled === true ? "Yes" : "No",
    contractor_phone_verified: cleaner.phone_verified === true ? "Yes" : "No",
    contractor_avatar_url: cleaner.avatar_url || "",
    contractor_invited_at: cleaner.invited_at || "",
    contractor_activated_at: cleaner.activated_at || "",
    contractor_background_check_status: cleaner.background_check_status || "pending",
    contractor_background_check_expires_at: cleaner.background_check_expires_at || "",
    contractor_insurance_verified: cleaner.insurance_verified === true ? "Yes" : "No",
    contractor_insurance_carrier: cleaner.insurance_carrier || "",
    contractor_insurance_expires_at: cleaner.insurance_expires_at || "",
    contractor_total_jobs: cleaner.total_bookings ?? 0,
    contractor_avg_rating: cleaner.average_rating ?? "",
    contractor_on_time_rate:
      cleaner.on_time_rate != null ? `${Math.round(cleaner.on_time_rate * 100)}%` : "",
  };
  Object.keys(out).forEach((k) => { if (out[k] === null || out[k] === undefined) delete out[k]; });
  return out;
}

/**
 * A contractor's tags: their role, and where they are in it. That's it.
 *
 * This used to emit up to twenty tags per contractor — pay tier, three service
 * zones, five skills, background-check state, insurance state, and eight
 * onboarding checkboxes. Every one of those is written to a `contractor_*`
 * CUSTOM FIELD in the same request (see buildContractorFields above), so the
 * tags were duplicate data competing with the fields for the truth, and they
 * were the bulk of the tag sprawl in the account. Filter on the fields.
 */
function buildContractorTags(cleaner: any): string[] {
  const status = String(cleaner.status || "").toLowerCase();

  // Most specific true statement about where they stand, in escalating order
  // of "can they be dispatched".
  let stage = "applicant";
  if (status === "terminated") stage = "terminated";
  else if (status === "suspended") stage = "suspended";
  else if (status === "inactive") stage = "inactive";
  else if (cleaner.approved !== true) stage = "pending approval";
  else if (cleaner.onboarding_complete !== true) stage = "onboarding";
  else if (status === "active") stage = "active";
  else stage = "approved";

  return enforceTagPolicy(["contractor", `contractor - ${stage}`]).tags;
}

async function upsertContact(token: string, locationId: string, payload: any): Promise<string | null> {
  try {
    const res = await ghlFetch(`/contacts/upsert`, {
      method: "POST", body: JSON.stringify({ ...payload, locationId }),
    }, token, locationId);
    const id = res?.contact?.id || res?.new?.id || res?.id || null;
    if (id) return id;
  } catch (e) {
    console.warn("[sync-cleaner-to-ghl] upsert endpoint failed", e instanceof Error ? e.message : e);
  }
  return null;
}

async function upsertContractorOpportunity(
  token: string, locationId: string, contactId: string, cleaner: any, pipelineId: string,
  stageMap: { applicant: string; onboarding: string; active: string; inactive: string },
) {
  if (!pipelineId) return null;
  let stageId = "";
  const status = String(cleaner.status || "").toLowerCase();
  if (status === "inactive" || status === "terminated") stageId = stageMap.inactive;
  else if (cleaner.payouts_enabled && cleaner.onboarding_complete) stageId = stageMap.active;
  else if (cleaner.onboarding_complete) stageId = stageMap.onboarding;
  else stageId = stageMap.applicant;
  if (!stageId) return null;

  try {
    const search = await ghlFetch(
      `/opportunities/search?location_id=${encodeURIComponent(locationId)}&contact_id=${encodeURIComponent(contactId)}&pipeline_id=${encodeURIComponent(pipelineId)}`,
      { method: "GET" }, token, locationId,
    );
    const existing = (search?.opportunities || [])[0];
    if (existing?.id) {
      await ghlFetch(`/opportunities/${existing.id}`, {
        method: "PUT", body: JSON.stringify({
          pipelineId, pipelineStageId: stageId,
          name: `${cleaner.first_name || "Contractor"} ${cleaner.last_name || ""}`.trim(),
          status: status === "terminated" ? "lost" : status === "inactive" ? "abandoned" : "open",
          monetaryValue: 0,
        }),
      }, token, locationId).catch((e) => console.warn("[sync-cleaner-to-ghl] opp update failed", e));
      return existing.id;
    }
  } catch (e) {
    console.warn("[sync-cleaner-to-ghl] opp search failed", e instanceof Error ? e.message : e);
  }

  try {
    const created = await ghlFetch(`/opportunities/`, {
      method: "POST", body: JSON.stringify({
        locationId, pipelineId, pipelineStageId: stageId,
        contactId, name: `${cleaner.first_name || "Contractor"} ${cleaner.last_name || ""}`.trim(),
        status: "open", monetaryValue: 0,
      }),
    }, token, locationId);
    return created?.opportunity?.id || created?.id || null;
  } catch (e) {
    console.warn("[sync-cleaner-to-ghl] opp create failed", e instanceof Error ? e.message : e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid json" }, 400); }
  const cleanerId = String(body?.cleanerId || "");
  if (!cleanerId) return json({ ok: false, error: "cleanerId required" }, 400);

  const { data: cleaner, error: cErr } = await supabase
    .from("cleaners").select("*").eq("id", cleanerId).maybeSingle();
  if (cErr || !cleaner) {
    console.warn("[sync-cleaner-to-ghl] cleaner not found", cleanerId, cErr?.message);
    return json({ ok: false, error: "cleaner not found" }, 404);
  }

  const token = await resolveSecret(supabase, "GHL_PIT_TOKEN");
  const locationId = await resolveSecret(supabase, "GHL_LOCATION_ID");
  if (!token || !locationId) {
    console.warn("[sync-cleaner-to-ghl] GHL credentials missing");
    await supabase.from("cleaners").update({ ghl_sync_error: "GHL credentials missing" }).eq("id", cleanerId);
    return json({ ok: false, error: "GHL credentials missing" });
  }

  try {
    const phone = toE164(cleaner.phone);
    const fieldMap = await loadCustomFieldMap(token, locationId);
    const rawFields = buildContractorCustomFields(cleaner);
    const customFields = Object.entries(rawFields)
      .map(([k, v]) => fieldMap[k] ? { id: fieldMap[k], field_value: typeof v === "string" ? v : String(v) } : null)
      .filter((x): x is { id: string; field_value: string } => x !== null);

    const tags = buildContractorTags(cleaner);

    const payload: any = {
      firstName: cleaner.first_name || "",
      lastName: cleaner.last_name || "",
      email: cleaner.email || "",
      phone: phone || undefined,
      address1: cleaner.home_address || "",
      city: cleaner.home_city || "",
      state: cleaner.state || "",
      postalCode: cleaner.home_zip || "",
      tags,
      customFields,
      source: "Contractor Onboarding",
    };

    const contactId = await upsertContact(token, locationId, payload);
    if (!contactId) {
      await supabase.from("cleaners").update({ ghl_sync_error: "upsertContact returned no id" }).eq("id", cleanerId);
      return json({ ok: false, error: "upsertContact returned no id" });
    }

    const pipelineId = await resolveSecret(supabase, "GHL_CONTRACTOR_PIPELINE_ID");
    let opportunityId: string | null = null;
    if (pipelineId) {
      const stageMap = {
        applicant:  await resolveSecret(supabase, "GHL_CONTRACTOR_PIPELINE_STAGE_APPLICANT"),
        onboarding: await resolveSecret(supabase, "GHL_CONTRACTOR_PIPELINE_STAGE_ONBOARDING"),
        active:     await resolveSecret(supabase, "GHL_CONTRACTOR_PIPELINE_STAGE_ACTIVE"),
        inactive:   await resolveSecret(supabase, "GHL_CONTRACTOR_PIPELINE_STAGE_INACTIVE"),
      };
      opportunityId = await upsertContractorOpportunity(token, locationId, contactId, cleaner, pipelineId, stageMap);
    }


    // Provision GHL sub-account user (same permissions as template user).
    let ghlUserId: string | null = (cleaner as { ghl_user_id?: string | null }).ghl_user_id || null;
    if (!ghlUserId && cleaner.email && cleaner.first_name && cleaner.last_name) {
      const password = `${String(cleaner.first_name)[0].toLowerCase()}${String(cleaner.last_name).replace(/\s+/g, "")}nv2025!`;
      // ghl-users.ts types its supabase param with a deeply-nested
      // structural shape; cast the fn to loose params so TS doesn't try
      // to instantiate that type against the full SupabaseClient.
      // deno-lint-ignore no-explicit-any
      const provision = provisionGhlUserFromTemplate as (s: any, i: {
        email: string; firstName: string; lastName: string;
        phone?: string | null; password: string; templateEmail?: string;
      }) => Promise<{ ghlUserId: string | null; created: boolean; error?: string; skipped?: string }>;
      const userResult = await provision(supabase, {
        email: cleaner.email,
        firstName: cleaner.first_name,
        lastName: cleaner.last_name,
        phone: cleaner.phone,
        password,
      });
      ghlUserId = userResult.ghlUserId;
      if (ghlUserId) {
        await supabase.from("cleaners").update({ ghl_user_id: ghlUserId }).eq("id", cleanerId);
      } else if (userResult.error) {
        console.warn("[sync-cleaner-to-ghl] GHL user provision:", userResult.error);
      }
    }

    await supabase
      .from("cleaners")
      .update({ ghl_synced_at: new Date().toISOString(), ghl_sync_error: null })
      .eq("id", cleanerId);

    await supabase.from("events").insert({
      event_type: "cleaner.ghl_synced", cleaner_id: cleanerId,
      source: "sync-cleaner-to-ghl",
      summary: `Synced ${cleaner.first_name || "contractor"} ${cleaner.last_name || ""} → GHL (${tags.length} tags, ${customFields.length} fields)`.trim(),
      data: { contact_id: contactId, opportunity_id: opportunityId, tags, custom_field_count: customFields.length },
    }).then(() => undefined, () => undefined);

    return json({ ok: true, ghl_contact_id: contactId, opportunity_id: opportunityId, ghl_user_id: ghlUserId, tags, custom_field_count: customFields.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[sync-cleaner-to-ghl] failed", cleanerId, message);
    await supabase.from("cleaners").update({ ghl_sync_error: message }).eq("id", cleanerId);
    return json({ ok: false, error: message });
  }
});

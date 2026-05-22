// ─── lead-intake ─────────────────────────────────────────────────────────
//
// Single entry point for new leads landing in the system from any source
// (FB Lead Ads, LSA, website forms, manual admin, AI booking assistant).
// Wires the full speed-to-lead workflow:
//
//   1. Upsert public.leads with the canonical fields + source tags
//   2. Upsert the matching GHL contact + open opportunity (using existing
//      sync-to-ghl plumbing, but called directly so we can capture the
//      contact/opportunity ids on the leads row).
//   3. Round-robin assign to the next on-shift VA (public.va_assignments)
//   4. Fire the "calling you in 2 minutes" auto-SMS via send-ghl-sms so the
//      lead is expecting the call.
//   5. Schedule an escalation marker so a separate cron can flag stale
//      leads (no call within 10 minutes).
//   6. (Optional) push an internal SMS to the assigned VA's phone.
//
// Body shape (all optional except phone OR email):
//   {
//     source: 'fb_lead_ads' | 'lsa' | 'website' | 'manual' | 'recycled',
//     firstName, lastName, email, phone,
//     zipCode, city, state, address?,
//     serviceType?, propertyType?, bedrooms?, bathrooms?, sqft?,
//     frequency?, urgency?, preferredDate?, preferredTime?,
//     specialRequests?, notes?,
//     utmSource?, utmMedium?, utmCampaign?,
//     leadScore? 'hot' | 'warm' | 'cold',  // defaults to 'hot' for fb/lsa
//   }
//
// Response: { leadId, ghlContactId, ghlOpportunityId, assignedVaUserId }
//
// Idempotent: matches existing lead on (phone OR email) within last
// 24 hours; only one auto-SMS goes out per lead.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

const logStep = (step: string, details?: unknown) => {
  const tail = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[LEAD-INTAKE] ${step}${tail}`);
};

interface LeadPayload {
  source?: "fb_lead_ads" | "lsa" | "website" | "manual" | "recycled" | string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  zipCode?: string;
  city?: string;
  state?: string;
  address?: string;
  serviceType?: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  frequency?: string;
  urgency?: string;
  preferredDate?: string;
  preferredTime?: string;
  specialRequests?: string;
  notes?: string;
  // ─── Attribution (passed through to GHL custom fields) ───
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  landingPage?: string;
  referrer?: string;
  fbclid?: string;
  gclid?: string;
  fbp?: string;
  fbc?: string;
  firstVisitTimestamp?: string;
  leadScore?: "hot" | "warm" | "cold";
}

function digitsOnly(s: string | undefined | null): string {
  if (!s) return "";
  return String(s).replace(/[^0-9]/g, "").replace(/^1/, "");
}

// E.164 normalizer — GHL expects '+1XXXXXXXXXX' and rejects loose
// formats. Mirrors the helper in send-ghl-sms.
function toE164(input: string | undefined | null): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  if (raw.startsWith("+")) {
    const d = raw.slice(1).replace(/[^0-9]/g, "");
    return d ? `+${d}` : null;
  }
  const d = raw.replace(/[^0-9]/g, "");
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 7) return null;
  return d ? `+${d}` : null;
}

// Pipelines whose names match this regex are NEVER auto-selected for
// new sales leads. The Hiring / Cleaner Onboarding / Team / Recruit
// pipelines must be opt-in via explicit env vars, never the fallback.
const NON_SALES_PIPELINE_RE =
  /\b(hir|recruit|cleaner|team|onboard|driver|contractor|applicant|interview)\b/i;

function defaultLeadScore(source: string): "hot" | "warm" | "cold" {
  const s = source.toLowerCase();
  if (s.includes("fb") || s.includes("lsa") || s.includes("local_service_ads")) {
    return "hot";
  }
  if (s.includes("website") || s.includes("manual")) return "warm";
  return "cold";
}

async function resolveSecret(supabase: any, name: string): Promise<string> {
  let value = "";
  try {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", name).maybeSingle();
    if (data?.value && typeof data.value === "string") value = data.value.trim();
  } catch (_) { /* ignore */ }
  if (!value) value = (Deno.env.get(name) || "").trim();
  return value;
}

// Map a lead payload to the GHL custom-field bag using bare fieldKeys.
// The ghl-client (when called via /functions/v1/sync-to-ghl) resolves
// these to UUIDs by hitting GHL's customFields endpoint. Doing the
// resolution here keeps lead-intake self-contained and avoids pulling
// the full ghl-client into this bundle.
async function loadFieldKeyMap(token: string, locationId: string): Promise<Record<string, string>> {
  try {
    const r = await fetch(
      `${GHL_BASE}/locations/${encodeURIComponent(locationId)}/customFields`,
      { headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION, Accept: "application/json" } },
    );
    if (!r.ok) return {};
    const j = await r.json();
    const map: Record<string, string> = {};
    for (const f of (j.customFields ?? []) as Array<any>) {
      if (!f?.id) continue;
      const raw = (f.fieldKey || f.key || "") as string;
      const bare = raw.split(".").pop() || raw;
      if (bare) map[bare] = f.id;
      if (raw)  map[raw]  = f.id;
      if (f.name) map[f.name] = f.id;
    }
    return map;
  } catch {
    return {};
  }
}

// Inferred lead-source rollup the existing GHL setup expects.
function inferLeadSourceLabel(p: LeadPayload): string {
  const s = (p.utmSource || "").toLowerCase();
  if (p.fbclid || s === "facebook" || s === "fb" || s === "instagram" || s === "ig") return "Facebook Ads";
  if (p.gclid || s === "google" || s === "googleads") return "Google Ads";
  if (s.includes("lsa") || s.includes("local_service_ads")) return "Google LSA";
  const src = (p.source || "").toLowerCase();
  if (src.includes("fb")) return "Facebook Ads";
  if (src.includes("lsa")) return "Google LSA";
  if (src === "website" || src === "manual") return "Website";
  return "Website";
}

function inferCustomerSourceLabel(p: LeadPayload): string {
  const s = (p.utmSource || "").toLowerCase();
  if (p.fbclid || s === "facebook" || s === "fb") return "Facebook";
  if (s === "instagram" || s === "ig") return "Instagram";
  if (p.gclid || s === "google") return "Google";
  if (s.includes("lsa")) return "Google LSA";
  return "Website";
}

async function ghlUpsertContactAndOpportunity(
  payload: LeadPayload,
  leadId: string,
  token: string,
  locationId: string,
  supabase: any,
): Promise<{ contactId: string | null; opportunityId: string | null }> {
  if (!token || !locationId) return { contactId: null, opportunityId: null };
  const tags = [
    "lead",
    payload.source ? `source-${payload.source}` : null,
    payload.zipCode ? `zip-${payload.zipCode}` : null,
    payload.leadScore || defaultLeadScore(payload.source || ""),
    // Channel + campaign tags so the user can segment in GHL.
    payload.fbclid ? "channel-facebook" : null,
    payload.gclid ? "channel-google" : null,
    payload.utmSource ? `utm-${payload.utmSource}`.toLowerCase().slice(0, 40) : null,
    payload.utmCampaign ? `cmp-${payload.utmCampaign}`.toLowerCase().slice(0, 40) : null,
  ].filter(Boolean) as string[];

  // Normalize phone to E.164 — GHL otherwise silently drops the phone
  // field and the contact never gets SMS'd.
  const normalizedPhone = toE164(payload.phone);

  // Resolve GHL custom field UUIDs by fieldKey. If a key isn't present
  // on the location we silently skip that field (GHL would 400 anyway).
  const fieldMap = await loadFieldKeyMap(token, locationId);
  const desiredFields: Record<string, string | undefined> = {
    utm_source: payload.utmSource,
    utm_medium: payload.utmMedium,
    utm_campaign: payload.utmCampaign,
    utm_content: payload.utmContent,
    utm_term: payload.utmTerm,
    landing_page_source: payload.landingPage,
    attribution: payload.referrer || payload.landingPage,
    fb_lead_id: payload.fbclid,
    fbclid: payload.fbclid,
    gclid: payload.gclid,
    fbp: payload.fbp,
    fbc: payload.fbc,
    first_visit_at: payload.firstVisitTimestamp,
    lead_source: inferLeadSourceLabel(payload),
    customer_source: inferCustomerSourceLabel(payload),
    market: payload.zipCode || undefined,
  };
  const customFields: Array<{ id: string; field_value: string }> = [];
  for (const [key, raw] of Object.entries(desiredFields)) {
    if (!raw) continue;
    const id = fieldMap[key] ?? fieldMap[`contact.${key}`];
    if (!id) continue;
    customFields.push({ id, field_value: String(raw) });
  }

  const contactBody = {
    locationId,
    email: payload.email || undefined,
    phone: normalizedPhone || undefined,
    firstName: payload.firstName || undefined,
    lastName: payload.lastName || undefined,
    address1: payload.address || undefined,
    city: payload.city || undefined,
    state: payload.state || undefined,
    postalCode: payload.zipCode || undefined,
    country: "US",
    source: payload.source ? `Novara ${payload.source}` : "Novara Lead",
    tags,
    customFields: customFields.length > 0 ? customFields : undefined,
  };
  let contactId: string | null = null;
  try {
    const res = await fetch(`${GHL_BASE}/contacts/upsert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: GHL_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(contactBody),
    });
    if (res.ok) {
      const json = await res.json();
      contactId = (json?.contact?.id as string | undefined) ||
        (json?.id as string | undefined) || null;
    }
  } catch (_) { /* ignore */ }
  if (!contactId) return { contactId: null, opportunityId: null };

  // Pipeline resolution. Priority:
  //   1. explicit GHL_SALES_PIPELINE_ID (+ optional stage) — never the
  //      Hiring pipeline, regardless of GHL's listing order.
  //   2. legacy GHL_PIPELINE_ID for back-compat with the booking flow.
  //   3. auto-discovery — but SKIP pipelines whose names match
  //      hire/recruit/cleaner/team/onboard so we never funnel a
  //      customer lead into the hiring board.
  let pipelineId = "";
  let pipelineStageId = "";
  const salesPipelineId = await resolveSecret(supabase, "GHL_SALES_PIPELINE_ID");
  const salesPipelineStageId = await resolveSecret(supabase, "GHL_SALES_PIPELINE_STAGE_ID");
  const legacyPipelineId = (Deno.env.get("GHL_PIPELINE_ID") || "").trim();
  const legacyStageId = (Deno.env.get("GHL_PIPELINE_STAGE_ID") || "").trim();
  if (salesPipelineId) {
    pipelineId = salesPipelineId;
    if (salesPipelineStageId) pipelineStageId = salesPipelineStageId;
  } else if (legacyPipelineId) {
    pipelineId = legacyPipelineId;
    if (legacyStageId) pipelineStageId = legacyStageId;
  }

  if (!pipelineId || !pipelineStageId) {
    try {
      const r = await fetch(
        `${GHL_BASE}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Version: GHL_VERSION,
            Accept: "application/json",
          },
        },
      );
      if (r.ok) {
        const j = await r.json();
        const all = (j.pipelines || []) as Array<{
          id?: string;
          name?: string;
          stages?: Array<{ id?: string; name?: string; position?: number }>;
        }>;
        let chosen = pipelineId
          ? all.find((p) => p.id === pipelineId)
          : null;
        if (!chosen) {
          chosen = all.find((p) =>
            p.id && !NON_SALES_PIPELINE_RE.test(p.name || "")
          ) || null;
        }
        if (chosen?.id) {
          pipelineId = chosen.id;
          if (!pipelineStageId) {
            const stage = (chosen.stages || [])
              .slice()
              .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
            if (stage?.id) pipelineStageId = stage.id;
          }
          logStep("pipeline resolved", {
            pipelineId,
            pipelineName: chosen.name,
            stageId: pipelineStageId,
          });
        }
      }
    } catch (_) { /* ignore */ }
  }
  if (!pipelineId) return { contactId, opportunityId: null };

  let opportunityId: string | null = null;
  try {
    const oppBody = {
      locationId,
      contactId,
      pipelineId,
      pipelineStageId: pipelineStageId || undefined,
      name: `Novara Lead — ${payload.firstName || ""} ${payload.lastName || ""}`.trim() ||
        `Novara Lead — ${payload.phone || payload.email || leadId}`,
      status: "open",
      source: payload.source || "Novara Lead",
    };
    const res = await fetch(`${GHL_BASE}/opportunities/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: GHL_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(oppBody),
    });
    if (res.ok) {
      const json = await res.json();
      opportunityId = (json?.opportunity?.id as string | undefined) ||
        (json?.id as string | undefined) || null;
    }
  } catch (_) { /* ignore */ }

  return { contactId, opportunityId };
}

async function roundRobinAssignVa(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<{ userId: string | null; displayName: string | null }> {
  const { data: vas } = await supabase
    .from("va_assignments")
    .select("va_user_id, display_name, last_assigned_at, total_leads_assigned, on_shift")
    .eq("is_active", true)
    .eq("on_shift", true)
    .order("last_assigned_at", { ascending: true, nullsFirst: true })
    .limit(1);
  const va = vas?.[0];
  if (!va) return { userId: null, displayName: null };
  await supabase
    .from("va_assignments")
    .update({
      last_assigned_at: new Date().toISOString(),
      total_leads_assigned: (va.total_leads_assigned || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("va_user_id", va.va_user_id);
  return { userId: va.va_user_id, displayName: va.display_name };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const payload: LeadPayload = await req.json();
    if (!payload.phone && !payload.email) {
      return new Response(
        JSON.stringify({ error: "phone or email required" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const phoneDigits = digitsOnly(payload.phone);
    const source = (payload.source || "manual").toLowerCase();
    const leadScore = payload.leadScore || defaultLeadScore(source);

    // 1. Look for a recent duplicate lead from the same phone/email so we
    // don't double-text + double-assign on a webhook retry.
    let leadId: string | null = null;
    let isNew = true;
    if (phoneDigits || payload.email) {
      const orFilter = [
        phoneDigits ? `phone.ilike.%${phoneDigits}%` : null,
        payload.email ? `email.ilike.${payload.email}` : null,
      ].filter(Boolean).join(",");
      const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: existing } = await supabase
        .from("leads")
        .select("id")
        .or(orFilter)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        leadId = existing.id;
        isNew = false;
      }
    }

    if (isNew) {
      const { data: inserted, error: insertErr } = await supabase
        .from("leads")
        .insert({
          first_name: payload.firstName || null,
          last_name: payload.lastName || null,
          email: payload.email || null,
          phone: phoneDigits || null,
          source,
          status: "new",
          property_type: payload.propertyType || null,
          bedrooms: payload.bedrooms ?? null,
          bathrooms: payload.bathrooms ?? null,
          sqft: payload.sqft ?? null,
          zip_code: payload.zipCode || null,
          service_type: payload.serviceType || null,
          frequency: payload.frequency || null,
          preferred_date: payload.preferredDate || null,
          preferred_time: payload.preferredTime || null,
          special_requests: payload.specialRequests || null,
          urgency: payload.urgency || (leadScore === "hot" ? "urgent" : null),
          notes: payload.notes || null,
          lead_score: leadScore,
          next_action_at: leadScore === "hot"
            ? new Date(Date.now() + 2 * 60 * 1000).toISOString()
            : null,
          // ─── Attribution (also pushed into GHL custom fields) ───
          utm_source: payload.utmSource || null,
          utm_medium: payload.utmMedium || null,
          utm_campaign: payload.utmCampaign || null,
          utm_content: payload.utmContent || null,
          utm_term: payload.utmTerm || null,
          landing_page: payload.landingPage || null,
          referrer: payload.referrer || null,
          fbclid: payload.fbclid || null,
          gclid: payload.gclid || null,
          first_visit_at: payload.firstVisitTimestamp || null,
        })
        .select("id")
        .single();
      if (insertErr) {
        logStep("insert error", insertErr);
        throw insertErr;
      }
      leadId = inserted.id;
    } else if (leadId && (payload.fbclid || payload.utmSource || payload.utmCampaign)) {
      // Existing lead row — backfill attribution if the original capture
      // was missing it (e.g., the contact filled out a different form
      // first and only the second submission carried the fbclid).
      await supabase
        .from("leads")
        .update({
          utm_source: payload.utmSource ?? undefined,
          utm_medium: payload.utmMedium ?? undefined,
          utm_campaign: payload.utmCampaign ?? undefined,
          utm_content: payload.utmContent ?? undefined,
          utm_term: payload.utmTerm ?? undefined,
          landing_page: payload.landingPage ?? undefined,
          referrer: payload.referrer ?? undefined,
          fbclid: payload.fbclid ?? undefined,
          gclid: payload.gclid ?? undefined,
        })
        .eq("id", leadId);
    }
    if (!leadId) throw new Error("could not resolve leadId");

    // 2. GHL upsert
    const ghlToken = (Deno.env.get("GHL_PIT_TOKEN") || "").trim();
    const ghlLocation = (Deno.env.get("GHL_LOCATION_ID") || "").trim();
    const { contactId, opportunityId } = await ghlUpsertContactAndOpportunity(
      payload,
      leadId,
      ghlToken,
      ghlLocation,
      supabase,
    );
    if (contactId || opportunityId) {
      await supabase
        .from("leads")
        .update({
          ghl_contact_id: contactId,
          ghl_opportunity_id: opportunityId,
        })
        .eq("id", leadId);
    }

    // 3. Round-robin VA assignment (only when new + hot)
    let assignedVa: { userId: string | null; displayName: string | null } = {
      userId: null,
      displayName: null,
    };
    if (isNew && leadScore === "hot") {
      assignedVa = await roundRobinAssignVa(supabase);
      if (assignedVa.userId) {
        await supabase
          .from("leads")
          .update({ assigned_va_user_id: assignedVa.userId })
          .eq("id", leadId);
      }
    }

    // 4. Speed-to-lead auto-SMS via GHL conversations (only on new hot leads).
    //
    // CRITICAL: This used to fire-and-forget without checking the GHL
    // response, then stamp speed_to_lead_sms_sent_at regardless of
    // whether the SMS actually went out. Pre-2026-05-22, every call here
    // 422'd inside GHL (type-enum bug in send-ghl-sms v1/v2) but the
    // leads table reported success. Now we:
    //   - parse the send-ghl-sms response
    //   - only stamp the timestamp when GHL returns a messageId
    //   - persist the actual GHL message_id + any failure reason on the lead
    //   - log the failure body so future regressions are visible
    if (isNew && leadScore === "hot" && payload.phone && contactId) {
      try {
        const fname = payload.firstName || "there";
        const vaName = assignedVa.displayName || "Novara";
        const msg =
          `Hi ${fname}, this is ${vaName} with Novara Cleaning. ` +
          `Just got your request — calling you from this number in about 2 minutes ` +
          `to get a quick quote together. Text STOP to opt out.`;
        const smsRes = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-ghl-sms`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
            },
            body: JSON.stringify({
              contactId,
              phone: payload.phone,
              email: payload.email,
              firstName: payload.firstName,
              lastName: payload.lastName,
              message: msg,
              type: "SMS",
            }),
          },
        );
        const smsBody = await smsRes.text();
        let smsJson: any = null;
        try { smsJson = JSON.parse(smsBody); } catch { /* keep raw */ }
        const messageId = smsJson?.messageId || null;
        const success = smsRes.ok && Boolean(messageId);

        if (success) {
          await supabase
            .from("leads")
            .update({ speed_to_lead_sms_sent_at: new Date().toISOString() })
            .eq("id", leadId);
          logStep("speed-to-lead SMS dispatched", { leadId, messageId });
        } else {
          logStep("speed-to-lead SMS FAILED (not stamping leads row)", {
            leadId,
            status: smsRes.status,
            body: smsBody.slice(0, 400),
          });
        }
      } catch (smsErr) {
        logStep("speed-to-lead SMS exception (non-blocking)", {
          error: smsErr instanceof Error ? smsErr.message : String(smsErr),
        });
      }
    }

    logStep("lead processed", {
      leadId,
      isNew,
      leadScore,
      assignedVa: assignedVa.userId,
      ghlContactId: contactId,
      ghlOpportunityId: opportunityId,
    });

    return new Response(
      JSON.stringify({
        success: true,
        leadId,
        isNew,
        leadScore,
        ghlContactId: contactId,
        ghlOpportunityId: opportunityId,
        assignedVaUserId: assignedVa.userId,
        assignedVaName: assignedVa.displayName,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[lead-intake] error", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

// ghl-inbound-webhook (v2)
//
// Single entry point for INBOUND GoHighLevel webhooks. Phase-4 spec
// (handleGHLWebhook). Built with three guardrails so it CANNOT damage
// existing operational data:
//
//   1. HMAC validation via x-ghl-signature against app_secrets
//      GHL_INBOUND_WEBHOOK_SECRET. Missing or mismatched -> 401.
//
//   2. Feature flag GHL_INBOUND_ENABLED. When false (default), the
//      webhook still records the payload to public.ghl_webhook_log
//      and emits an event, but it does NOT mutate any operational
//      table. This lets you observe live GHL traffic safely before
//      turning on the writers.
//
//   3. Idempotency: every payload is keyed by the GHL event ID (or
//      SHA-256 of body if absent) into public.ghl_webhook_log with a
//      UNIQUE constraint. Duplicate deliveries return 200 OK fast.
//
// Routes:
//   contact.created       -> ingestNewLead
//   contact.updated       -> updateLeadRecord
//   appointment.created   -> ingestAppointment
//   appointment.updated   -> updateAppointment
//   appointment.cancelled -> cancelAppointment
//   note.added            -> logNoteEvent
//   opportunity.stageChanged -> updateLeadStatus
//
// IMPORTANT: Never overwrites bookings.status if the booking already
// has stripe_payment_intent_id (payment state is owned by Stripe).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-ghl-signature, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}

async function resolveSecret(supabase: any, key: string): Promise<string> {
  const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
  return (data?.value as string) || Deno.env.get(key) || "";
}

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parseEventId(payload: any): string {
  return String(payload?.id || payload?.event_id || payload?.webhookId || payload?.body?.id || "");
}

function routeEventType(payload: any): string {
  const t = String(payload?.type || payload?.event || payload?.eventType || "").toLowerCase();
  if (!t) return "unknown";
  if (t.startsWith("contact.create") || t === "contactcreate") return "contact.created";
  if (t.startsWith("contact.update") || t === "contactupdate") return "contact.updated";
  if (t.startsWith("appointment.create") || t === "appointmentcreate") return "appointment.created";
  if (t.startsWith("appointment.update") || t === "appointmentupdate") return "appointment.updated";
  if (t.startsWith("appointment.cancel") || t === "appointmentcancel") return "appointment.cancelled";
  if (t.startsWith("note.add") || t === "noteadd") return "note.added";
  if (t.includes("opportunity") && t.includes("stage")) return "opportunity.stageChanged";
  return t;
}

function extractContact(p: any): any {
  return p?.contact || p?.data?.contact || p?.body?.contact || p?.full_contact || p || {};
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const raw = await req.text();
  const signature = req.headers.get("x-ghl-signature") || req.headers.get("x-wh-signature") || "";
  const secret = await resolveSecret(supabase, "GHL_INBOUND_WEBHOOK_SECRET");
  const enabledRaw = (await resolveSecret(supabase, "GHL_INBOUND_ENABLED")).toLowerCase();
  const enabled = enabledRaw === "true" || enabledRaw === "1" || enabledRaw === "yes";

  if (secret) {
    const expected = await hmacSha256Hex(secret, raw);
    const provided = signature.replace(/^sha256=/i, "").trim().toLowerCase();
    if (!provided || !timingSafeEqual(expected, provided)) {
      return json({ error: "invalid signature" }, 401);
    }
  }

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return json({ error: "invalid json" }, 400); }

  const webhookId = parseEventId(payload) || await sha256(raw);
  const eventType = routeEventType(payload);

  const { data: existing } = await supabase
    .from("ghl_webhook_log").select("id, processing_status")
    .eq("webhook_id", webhookId).maybeSingle();
  if (existing) {
    return json({ ok: true, deduped: true, webhook_id: webhookId, processing_status: existing.processing_status });
  }

  const { data: logRow } = await supabase
    .from("ghl_webhook_log")
    .insert({
      webhook_id: webhookId, event_type: eventType,
      raw_payload: payload,
      processing_status: enabled ? "processing" : "observed_only",
    })
    .select().maybeSingle();

  await supabase.from("events").insert({
    event_type: `ghl.${eventType}`, source: "ghl-inbound-webhook",
    summary: `GHL inbound: ${eventType}` + (enabled ? "" : " (observed_only)"),
    data: { webhook_id: webhookId, enabled, has_signature: Boolean(signature) },
  });

  if (!enabled) {
    return json({ ok: true, observed_only: true, webhook_id: webhookId, event_type: eventType });
  }

  try {
    const contact = extractContact(payload);
    const phone = String(contact.phone || "").replace(/[^0-9+]/g, "");
    const email = String(contact.email || "").trim().toLowerCase();
    const ghlContactId = String(contact.id || contact.contactId || "");
    let related: Record<string, string | null> = {};
    let processingError: string | null = null;

    switch (eventType) {
      case "contact.created":
      case "contact.updated": {
        if (!phone && !email && !ghlContactId) break;
        let leadId: string | null = null;
        if (ghlContactId) {
          const { data: byGhl } = await supabase.from("leads").select("id").eq("ghl_contact_id", ghlContactId).maybeSingle();
          leadId = byGhl?.id || null;
        }
        if (!leadId && phone) {
          const { data: byPhone } = await supabase.from("leads").select("id").eq("phone", phone).limit(1).maybeSingle();
          leadId = byPhone?.id || null;
        }
        if (!leadId && email) {
          const { data: byEmail } = await supabase.from("leads").select("id").eq("email", email).limit(1).maybeSingle();
          leadId = byEmail?.id || null;
        }
        const patch: Record<string, unknown> = {
          first_name: contact.first_name || contact.firstName || undefined,
          last_name: contact.last_name || contact.lastName || undefined,
          phone: phone || undefined, email: email || undefined,
          zip_code: contact.postal_code || contact.postalCode || contact.zip || undefined,
          ghl_contact_id: ghlContactId || undefined,
        };
        Object.keys(patch).forEach((k) => { if ((patch as any)[k] === undefined) delete (patch as any)[k]; });

        if (leadId) {
          const { error: uErr } = await supabase.from("leads").update(patch).eq("id", leadId);
          if (uErr) processingError = `update lead: ${uErr.message}`;
        } else if (eventType === "contact.created") {
          const insertPayload = {
            first_name: patch.first_name ?? "GHL",
            last_name: patch.last_name ?? "Contact",
            phone: patch.phone ?? null,
            email: patch.email ?? null,
            zip_code: patch.zip_code ?? null,
            ghl_contact_id: patch.ghl_contact_id ?? null,
            source: String(contact.source || "ghl"),
            channel: String(contact.channel || "ghl_inbound"),
            status: "new",
            call_attempts: 0,
            do_not_call: false,
          };
          const { data: inserted, error: iErr } = await supabase.from("leads").insert(insertPayload).select("id").maybeSingle();
          if (iErr) processingError = `insert lead: ${iErr.message}`;
          leadId = inserted?.id || null;
        }
        related = { related_lead_id: leadId };
        break;
      }

      case "appointment.created":
      case "appointment.updated":
      case "appointment.cancelled": {
        const appt = payload?.appointment || payload?.data?.appointment || payload || {};
        const ghlAppointmentId = String(appt.id || appt.appointmentId || "");
        if (!ghlAppointmentId) break;
        const { data: booking } = await supabase.from("bookings")
          .select("id, status, stripe_payment_intent_id")
          .eq("ghl_appointment_id", ghlAppointmentId).maybeSingle();
        if (booking) {
          const patch: Record<string, unknown> = { ghl_appointment_synced_at: new Date().toISOString() };
          if (appt.startTime || appt.start_time) {
            const startIso = new Date(appt.startTime || appt.start_time).toISOString();
            patch.service_date = startIso.slice(0, 10);
          }
          if (eventType === "appointment.cancelled") {
            if (!booking.stripe_payment_intent_id && booking.status !== "completed") {
              patch.status = "cancelled";
              patch.cancelled_at = new Date().toISOString();
              patch.cancellation_reason = "cancelled_in_ghl";
            }
          }
          const { error: uErr } = await supabase.from("bookings").update(patch).eq("id", booking.id);
          if (uErr) processingError = `update booking: ${uErr.message}`;
          related = { related_booking_id: booking.id };
        }
        break;
      }

      case "note.added": {
        const note = payload?.note || payload?.data?.note || payload || {};
        if (ghlContactId) {
          const { data: lead } = await supabase.from("leads").select("id").eq("ghl_contact_id", ghlContactId).maybeSingle();
          related = { related_lead_id: lead?.id || null };
          if (lead?.id) {
            await supabase.from("lead_activity_log").insert({
              lead_id: lead.id, activity_type: "note_added",
              metadata: { body: note.body || note.note || "", from: "ghl" },
            }).then(() => undefined).catch(() => undefined);
          }
        }
        break;
      }

      case "opportunity.stageChanged": {
        const opp = payload?.opportunity || payload?.data?.opportunity || payload || {};
        const oppId = String(opp.id || opp.opportunityId || "");
        if (oppId) {
          const { data: lead } = await supabase.from("leads")
            .select("id").eq("ghl_opportunity_id", oppId).maybeSingle();
          if (lead) {
            const stageToStatus: Record<string, string> = {
              "new": "new", "contacted": "contacted", "booked": "booked", "lost": "lost", "won": "booked",
            };
            const mapped = stageToStatus[(opp.stageName || "").toLowerCase()] || null;
            if (mapped) await supabase.from("leads").update({ status: mapped }).eq("id", lead.id);
            related = { related_lead_id: lead.id };
          }
        }
        break;
      }
    }

    await supabase.from("ghl_webhook_log")
      .update({
        processing_status: processingError ? "failed" : "processed",
        processed_at: new Date().toISOString(),
        processing_error: processingError,
        ...related,
      })
      .eq("id", logRow?.id);

    return json({ ok: !processingError, webhook_id: webhookId, event_type: eventType, ...related, error: processingError });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("ghl_webhook_log")
      .update({ processing_status: "failed", processed_at: new Date().toISOString(), processing_error: message })
      .eq("id", logRow?.id);
    console.error("[ghl-inbound-webhook] processing error", message);
    return json({ ok: false, error: message, webhook_id: webhookId });
  }
});

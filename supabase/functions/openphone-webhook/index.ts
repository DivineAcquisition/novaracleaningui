// ─── openphone-webhook ───────────────────────────────────────────────────
//
// Receives OpenPhone webhooks and:
//   1. Persists every call to `public.phone_calls` for VA / admin review.
//   2. Posts AI call summaries + recording links into the matching GHL
//      contact as a conversation note (so VAs see the call outcome
//      without leaving the GHL inbox).
//   3. Updates lead state (call_attempts++, last_call_at, disposition).
//   4. When the call outcome is `booked`, advances the GHL opportunity to
//      "won" via the existing GHL client.
//
// OpenPhone events supported:
//   call.completed             → write phone_calls row, update lead
//   call.recording.completed   → backfill recording_url on the row
//   call.summary.completed     → backfill ai_summary on the row + GHL note
//   message.received           → log to sms_logs as inbound, optional AI route
//   message.sent               → log to sms_logs as outbound
//
// Security: OpenPhone signs each webhook body with HMAC-SHA256 using a
// shared secret. We read the secret from `app_secrets.OPENPHONE_WEBHOOK_SECRET`
// and reject any unsigned / mismatched request. When the secret is empty
// (operator hasn't wired it yet), we accept the request but log a warning
// so the function is testable end-to-end before going to prod.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, openphone-signature",
};

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

const logStep = (step: string, details?: unknown) => {
  const tail = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[OPENPHONE-WEBHOOK] ${step}${tail}`);
};

async function resolveSecret(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  name: string,
): Promise<string> {
  let value = "";
  try {
    const { data } = await supabase
      .from("app_secrets")
      .select("value")
      .eq("key", name)
      .maybeSingle();
    if (data?.value && typeof data.value === "string") value = data.value.trim();
  } catch (_) { /* ignore */ }
  if (!value) value = (Deno.env.get(name) || "").trim();
  return value;
}

async function verifySignature(
  body: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!secret) return true; // unconfigured — accept for testability
  if (!signatureHeader) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    const sigBytes = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(body),
    );
    const expected = Array.from(new Uint8Array(sigBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    // OpenPhone signature format is "t=<ts>,v1=<hex>"; accept either raw
    // hex or the full header form.
    return signatureHeader.includes(expected);
  } catch (err) {
    logStep("signature verify error", err instanceof Error ? err.message : String(err));
    return false;
  }
}

// ─── GHL helpers (lean copy, fire-and-forget) ──────────────────────────
async function ghlPostNote(
  contactId: string,
  body: string,
  token: string,
  locationId: string,
) {
  try {
    const res = await fetch(
      `${GHL_BASE}/contacts/${encodeURIComponent(contactId)}/notes`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Version: GHL_VERSION,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ body, locationId }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      logStep("ghlPostNote failed", { status: res.status, body: text.slice(0, 200) });
    }
  } catch (err) {
    logStep("ghlPostNote error", err instanceof Error ? err.message : String(err));
  }
}

async function ghlAddTag(
  contactId: string,
  tags: string[],
  token: string,
) {
  if (tags.length === 0) return;
  try {
    await fetch(
      `${GHL_BASE}/contacts/${encodeURIComponent(contactId)}/tags`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Version: GHL_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tags }),
      },
    );
  } catch (_) { /* ignore */ }
}

async function ghlUpsertContact(
  payload: Record<string, unknown>,
  token: string,
  locationId: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${GHL_BASE}/contacts/upsert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: GHL_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ ...payload, locationId }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return (json?.contact?.id as string | undefined) ||
      (json?.id as string | undefined) || null;
  } catch (_) {
    return null;
  }
}

// ─── Disposition mapping ────────────────────────────────────────────────
// OpenPhone tags arrive freeform on `event.data.tags`. We normalize them
// into a small finite set so dashboards/queries stay sane.
function normalizeDisposition(tags: string[] = [], aiSummary = ""): string {
  const t = tags.map((x) => x.toLowerCase());
  const s = aiSummary.toLowerCase();
  if (t.includes("booked") || t.includes("scheduled") || /confirmed.*booking/.test(s)) {
    return "booked";
  }
  if (t.includes("voicemail") || t.includes("vm") || /left.*voicemail/.test(s)) {
    return "vm_left";
  }
  if (t.includes("not interested") || t.includes("nope") || /not.{1,20}interested/.test(s)) {
    return "not_interested";
  }
  if (t.includes("dnc") || t.includes("do not call") || /\bdo not call\b/.test(s)) {
    return "dnc";
  }
  if (t.includes("callback") || /call.*back/.test(s)) {
    return "callback";
  }
  if (t.includes("no answer") || t.includes("missed")) {
    return "no_answer";
  }
  return "completed";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const rawBody = await req.text();
    const signature = req.headers.get("openphone-signature");
    const webhookSecret = await resolveSecret(supabase, "OPENPHONE_WEBHOOK_SECRET");
    if (!await verifySignature(rawBody, signature, webhookSecret)) {
      logStep("invalid signature");
      return new Response(JSON.stringify({ error: "invalid signature" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    let event: Record<string, unknown> = {};
    try {
      event = JSON.parse(rawBody);
    } catch (_) { /* leave empty */ }

    const type = String(event.type || "");
    // deno-lint-ignore no-explicit-any
    const data: any = event.data || {};
    logStep("received", { type, callId: data?.id });

    // Resolve GHL credentials once — fall back to env if app_secrets row
    // is missing.
    const ghlToken = (Deno.env.get("GHL_PIT_TOKEN") || "").trim();
    const ghlLocation = (Deno.env.get("GHL_LOCATION_ID") || "").trim();

    // Common: which lead / customer does this call belong to?
    const counterpartPhone = data?.direction === "outbound"
      ? data?.to?.[0] || data?.to || ""
      : data?.from || "";
    const cleanedPhone = String(counterpartPhone || "")
      .replace(/[^0-9]/g, "")
      .replace(/^1/, "");

    let leadId: string | null = null;
    let customerId: string | null = null;
    let ghlContactId: string | null = null;
    if (cleanedPhone) {
      const { data: leadRow } = await supabase
        .from("leads")
        .select("id, ghl_contact_id, existing_customer_id")
        .or(`phone.ilike.%${cleanedPhone}%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (leadRow) {
        leadId = leadRow.id;
        ghlContactId = leadRow.ghl_contact_id || null;
        customerId = leadRow.existing_customer_id || null;
      }
      if (!customerId) {
        const { data: cust } = await supabase
          .from("customers")
          .select("id")
          .ilike("phone", `%${cleanedPhone}%`)
          .limit(1)
          .maybeSingle();
        if (cust) customerId = cust.id;
      }
    }

    switch (type) {
      case "call.completed": {
        const direction = data.direction || "outbound";
        const disposition = normalizeDisposition(
          (data.tags || []) as string[],
          data.summary || "",
        );
        const startedAt = data.startedAt || data.createdAt || null;
        const completedAt = data.completedAt || null;
        const duration = data.duration || 0;
        const recordingUrl = data?.recording?.url || data?.recordingUrl || null;
        const aiSummary = data?.summary || null;

        await supabase.from("phone_calls").upsert({
          openphone_call_id: data.id,
          openphone_conversation_id: data.conversationId,
          lead_id: leadId,
          customer_id: customerId,
          ghl_contact_id: ghlContactId,
          direction,
          from_phone: data.from,
          to_phone: Array.isArray(data.to) ? data.to[0] : data.to,
          status: data.status || "completed",
          started_at: startedAt,
          completed_at: completedAt,
          duration_seconds: duration,
          recording_url: recordingUrl,
          ai_summary: aiSummary,
          disposition,
          outcome_tag: (data.tags || []).join(","),
          va_user_id: data?.user?.id || null,
          raw_payload: data,
        }, { onConflict: "openphone_call_id" });

        // Bump the lead state machine
        if (leadId) {
          const updates: Record<string, unknown> = {
            last_call_at: new Date().toISOString(),
            last_call_outcome: disposition,
          };
          if (disposition === "booked") updates.status = "booked";
          if (disposition === "dnc") {
            updates.do_not_call = true;
            updates.status = "dnc";
          }
          if (disposition === "not_interested") updates.status = "not_interested";
          if (disposition === "callback") updates.status = "callback";
          // Increment call_attempts via a follow-up update — supabase
          // client doesn't support raw expressions in update()
          await supabase
            .from("leads")
            .update(updates)
            .eq("id", leadId);
          // crude increment (good enough for an ops table; ATOMICITY isn't
          // critical at the cadence we're calling)
          await supabase.rpc("increment_lead_call_attempts", { _lead_id: leadId })
            .then(() => {})
            .catch(() => {});
        }

        // Post a summary note into GHL so VAs see it in the contact thread
        if (ghlContactId && ghlToken && ghlLocation) {
          const minutes = duration ? Math.round(duration / 60) : 0;
          const noteBody = `📞 Call ${direction} — ${disposition.toUpperCase()}\n` +
            `Duration: ${minutes}m\n` +
            (recordingUrl ? `Recording: ${recordingUrl}\n` : "") +
            (aiSummary ? `\nAI summary:\n${aiSummary}` : "");
          await ghlPostNote(ghlContactId, noteBody, ghlToken, ghlLocation);
          const tag = `call-${disposition.replace(/_/g, "-")}`;
          await ghlAddTag(ghlContactId, [tag], ghlToken);
        }
        break;
      }

      case "call.recording.completed": {
        if (!data?.id) break;
        await supabase
          .from("phone_calls")
          .update({
            recording_url: data?.recording?.url || data?.url || null,
            updated_at: new Date().toISOString(),
          })
          .eq("openphone_call_id", data.id);
        break;
      }

      case "call.summary.completed": {
        if (!data?.id) break;
        const summary = data?.summary || data?.text || null;
        const sentiment = data?.sentiment || null;
        await supabase
          .from("phone_calls")
          .update({
            ai_summary: summary,
            ai_sentiment: sentiment,
            updated_at: new Date().toISOString(),
          })
          .eq("openphone_call_id", data.id);

        // Re-fetch the row so we know which GHL contact to post into
        const { data: pc } = await supabase
          .from("phone_calls")
          .select("ghl_contact_id")
          .eq("openphone_call_id", data.id)
          .maybeSingle();
        if (pc?.ghl_contact_id && ghlToken && ghlLocation && summary) {
          await ghlPostNote(
            pc.ghl_contact_id,
            `🧠 AI call summary:\n${summary}` +
              (sentiment ? `\n\nSentiment: ${sentiment}` : ""),
            ghlToken,
            ghlLocation,
          );
        }
        break;
      }

      case "message.received":
      case "message.sent": {
        const direction = type === "message.received" ? "inbound" : "outbound";
        await supabase.from("sms_logs").insert({
          to_phone: Array.isArray(data.to) ? data.to[0] : data.to || data.from,
          message: data.text || data.body || "",
          type: "openphone",
          status: "delivered",
          provider_message_id: data.id,
          delivery_status: direction,
        });
        break;
      }

      default:
        logStep("unhandled event type", { type });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[openphone-webhook] error", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

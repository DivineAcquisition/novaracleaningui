// calcom-webhook
//
// Part B (interim) of the Host Turnover Calendar spec. Receives Cal.com
// webhooks (BOOKING_CREATED / BOOKING_REQUESTED) for the "STR Turnover
// Request" event type and lands each as a turnover REQUEST in the ops system:
//
//   1. Verify the Cal.com HMAC signature (when CALCOM_WEBHOOK_SECRET is set).
//   2. Upsert the host by email (hosts table).
//   3. Match the property by nickname/address (best-effort) for this host.
//   4. Insert a turnover_requests row (status 'pending_payment', source
//      'cal.com'), idempotent on the Cal.com booking uid.
//   5. Notify ops (Discord).
//
// Payment is intentionally NOT collected here — these are REQUESTS. Nothing is
// dispatched (assignment only runs on 'paid'); ops reviews → prices → charges
// via the existing Stripe flow. When the in-portal calendar (Part A) ships,
// point the Cal.com link at the portal and retire this path.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveSecret } from "../_shared/app-secrets.ts";
import { notifyDiscord } from "../_shared/discord.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cal-signature-256",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}

// deno-lint-ignore no-explicit-any
type Any = any;

const log = (s: string, d?: unknown) =>
  console.log(`[calcom-webhook] ${s}${d === undefined ? "" : " " + JSON.stringify(d)}`);

// HMAC-SHA256 hex of `body` with `secret`, constant-time compared to `sig`.
async function verifySignature(secret: string, body: string, sig: string | null): Promise<boolean> {
  if (!secret) return true; // interim: accept unsigned until the secret is configured
  if (!sig) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const expected = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const a = expected.toLowerCase();
    const b = sig.trim().toLowerCase().replace(/^sha256=/, "");
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  } catch (err) {
    log("signature verify error", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

// Pull a booking-question answer out of Cal.com's various response shapes.
// Cal.com has shipped several formats: `responses[key] = { value }`,
// `responses[key] = "..."`, and `userFieldsResponses[key] = { value }`.
function pickResponse(payload: Any, keys: string[]): string {
  const buckets = [payload?.responses, payload?.userFieldsResponses, payload?.customInputs];
  for (const bucket of buckets) {
    if (!bucket || typeof bucket !== "object") continue;
    for (const wanted of keys) {
      for (const [k, raw] of Object.entries(bucket)) {
        if (k.toLowerCase().replace(/[^a-z0-9]/g, "").includes(wanted.toLowerCase().replace(/[^a-z0-9]/g, ""))) {
          const v = (raw as Any)?.value ?? raw;
          if (v === undefined || v === null) continue;
          if (typeof v === "boolean") return v ? "yes" : "no";
          const s = String(v).trim();
          if (s) return s;
        }
      }
    }
  }
  return "";
}

function truthy(s: string): boolean {
  return /^(yes|true|1|y|on)$/i.test(s.trim());
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const raw = await req.text();
    const secret = await resolveSecret(admin, "CALCOM_WEBHOOK_SECRET");
    const sig = req.headers.get("x-cal-signature-256") || req.headers.get("X-Cal-Signature-256");
    if (!(await verifySignature(secret, raw, sig))) {
      log("signature rejected");
      return json({ error: "invalid signature" }, 401);
    }

    const event = JSON.parse(raw || "{}") as Any;
    const trigger = String(event?.triggerEvent || "");
    if (!["BOOKING_CREATED", "BOOKING_REQUESTED"].includes(trigger)) {
      // Ack other events (cancel/reschedule) without acting.
      return json({ ok: true, ignored: trigger || "unknown" });
    }

    const p = event?.payload || {};
    const uid = String(p?.uid || p?.bookingId || p?.id || "");
    if (!uid) return json({ error: "missing booking uid" }, 400);

    // ─── Idempotency: already captured this booking? ──────────────────────
    const { data: existing } = await admin
      .from("turnover_requests")
      .select("id")
      .eq("calcom_booking_uid", uid)
      .maybeSingle();
    if (existing) {
      log("duplicate booking — already captured", { uid });
      return json({ ok: true, duplicate: true, turnoverId: existing.id });
    }

    // ─── Attendee (host) identity ─────────────────────────────────────────
    const attendee = Array.isArray(p?.attendees) ? p.attendees[0] : null;
    const email = String(attendee?.email || p?.responses?.email?.value || p?.responses?.email || "").trim().toLowerCase();
    const name = String(attendee?.name || p?.responses?.name?.value || p?.responses?.name || "").trim();
    const phoneRaw = pickResponse(p, ["phone", "attendeePhoneNumber", "smsReminderNumber"]);
    const phone = phoneRaw ? phoneRaw.replace(/[^\d+]/g, "") : null;

    if (!email) return json({ error: "missing attendee email" }, 400);

    // Booking-question answers.
    const propertyText = pickResponse(p, ["propertynickname", "property", "address", "propertyaddress"]);
    const checkoutTime = pickResponse(p, ["checkouttime", "checkout"]);
    const checkinDeadline = pickResponse(p, ["nextcheckin", "checkin", "checkindeadline"]);
    const linen = truthy(pickResponse(p, ["linen", "laundry"]));
    const restock = truthy(pickResponse(p, ["restock"]));
    const notesAnswer = pickResponse(p, ["notes", "additionalnotes"]);

    // Requested date from the Cal.com slot start.
    const startIso = p?.startTime || p?.start || null;
    let requestedDate = new Date().toISOString().slice(0, 10);
    let windowStart: string | null = null;
    if (startIso) {
      const d = new Date(startIso);
      if (!Number.isNaN(d.getTime())) {
        requestedDate = d.toISOString().slice(0, 10);
        windowStart = d.toISOString().slice(11, 16);
      }
    }

    // ─── Upsert host by email ─────────────────────────────────────────────
    let host: Any = null;
    {
      const { data: found } = await admin.from("hosts").select("*").ilike("email", email).maybeSingle();
      if (found) {
        host = found;
        // Backfill name/phone if we learned them.
        const patch: Record<string, unknown> = {};
        if (!found.name && name) patch.name = name;
        if (!found.phone && phone) patch.phone = phone;
        if (Object.keys(patch).length) await admin.from("hosts").update(patch).eq("id", found.id);
      } else {
        const { data: created, error: hErr } = await admin
          .from("hosts")
          .insert({ email, name: name || null, phone: phone || null, status: "active" })
          .select("*")
          .single();
        if (hErr) throw hErr;
        host = created;
      }
    }

    // ─── Best-effort property match for this host ─────────────────────────
    let propertyId: string | null = null;
    let matchedPropertyLabel = propertyText || "(unmatched)";
    if (propertyText) {
      const { data: props } = await admin
        .from("properties")
        .select("id, nickname, address")
        .eq("host_id", host.id);
      const needle = propertyText.toLowerCase();
      const match = (props || []).find((pr: Any) =>
        [pr.nickname, pr.address].filter(Boolean).some((v: string) => {
          const hay = String(v).toLowerCase();
          return hay.includes(needle) || needle.includes(hay);
        })
      );
      if (match) { propertyId = match.id; matchedPropertyLabel = match.nickname || match.address || matchedPropertyLabel; }
    }
    // If we couldn't match a property we still record the request against the
    // host's first property (if any) so it surfaces in admin; otherwise we
    // require a property and surface a clear ops alert.
    if (!propertyId) {
      const { data: anyProp } = await admin
        .from("properties")
        .select("id, nickname, address")
        .eq("host_id", host.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (anyProp) propertyId = anyProp.id;
    }
    if (!propertyId) {
      // No property on file at all — alert ops; nothing to attach a request to.
      await notifyDiscord(admin, {
        title: "Cal.com turnover request — NO PROPERTY on file",
        color: 15158332,
        fields: [
          { name: "Host", value: `${name || email}`, inline: true },
          { name: "Requested date", value: requestedDate, inline: true },
          { name: "Property (typed)", value: propertyText || "—", inline: false },
        ],
        description: "Create the property + set a turnover rate, then capture this request manually.",
      }).catch(() => undefined);
      return json({ ok: true, captured: false, reason: "no_property_for_host" });
    }

    // ─── Create the pending turnover request (NOT dispatched) ─────────────
    const noteParts = [
      "Cal.com request.",
      propertyText ? `Property (typed): ${propertyText}.` : "",
      checkoutTime ? `Checkout: ${checkoutTime}.` : "",
      checkinDeadline ? `Next check-in: ${checkinDeadline}.` : "",
      `Linen: ${linen ? "yes" : "no"}.`,
      `Restock: ${restock ? "yes" : "no"}.`,
      notesAnswer ? `Notes: ${notesAnswer}` : "",
    ].filter(Boolean);

    const { data: tr, error: trErr } = await admin
      .from("turnover_requests")
      .insert({
        property_id: propertyId,
        host_id: host.id,
        requested_date: requestedDate,
        window_start: windowStart,
        status: "pending_payment",
        price: 0, // ops prices on review
        source: "cal.com",
        calcom_booking_uid: uid,
        notes: noteParts.join(" "),
      })
      .select("id")
      .single();
    if (trErr) throw trErr;

    log("captured turnover request", { uid, turnoverId: tr.id, host: host.id, propertyId });

    await notifyDiscord(admin, {
      title: "New turnover request via Cal.com",
      color: 3447003,
      fields: [
        { name: "Property", value: matchedPropertyLabel, inline: true },
        { name: "Requested date", value: requestedDate, inline: true },
        { name: "Host", value: `${name || email}`, inline: true },
        { name: "Linen / Restock", value: `${linen ? "Linen" : "—"} / ${restock ? "Restock" : "—"}`, inline: true },
      ],
      description: "Review → price → charge via the existing Stripe flow. Nothing is dispatched until paid.",
    }).catch(() => undefined);

    return json({ ok: true, captured: true, turnoverId: tr.id, propertyMatched: matchedPropertyLabel !== "(unmatched)" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    return json({ error: msg }, 500);
  }
});

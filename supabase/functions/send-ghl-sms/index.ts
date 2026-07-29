// send-ghl-sms
//
// Sends an SMS to a contact through GoHighLevel's Conversations API.
// This is the fallback (and now primary) SMS transport for Novara so the
// rest of the system never has to depend on Telnyx 10DLC verification.
//
// Body shapes accepted:
//   { phone: '+13013468452', message: '...' }            // looks up / creates contact by phone
//   { contactId: '...',      message: '...' }            // direct send
//   { email: '...', phone?: '...', message: '...' }      // by email
//
// Key behaviors:
//
//   1. **Phone numbers are normalized to E.164** (`+1XXXXXXXXXX` for US).
//      GHL rejects loosely-formatted numbers — common breakage that
//      causes silent send failures. We normalize before both the
//      contact-upsert *and* the message send.
//
//   2. **Outbound number is the verified GHL number**. GHL routes
//      outbound SMS through a specific phone number per location; if
//      multiple are provisioned (e.g. a hiring number + a customer
//      number), the default may be the wrong one. Set
//      `app_secrets.GHL_DEFAULT_SMS_NUMBER_ID` to the verified-number
//      id and we pass it as `phoneNumberId` so every send rides the
//      right caller-ID + 10DLC registration. Operators can also set
//      `GHL_DEFAULT_SMS_FROM_NUMBER` to the E.164 string and we'll
//      look up the id at boot.
//
//   3. **No-op when no message is provided** so a misconfigured caller
//      never spams the GHL inbox with empty messages.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Body {
  phone?: string;
  email?: string;
  contactId?: string;
  firstName?: string;
  lastName?: string;
  message: string;
  /** GHL channel ("SMS"/"WhatsApp") OR an internal category label used
   *  for routing/logging (e.g. "job_offer", "verification"). Anything that
   *  isn't a real GHL channel is mapped to "SMS" before sending. */
  type?: string;
  /** Override the default verified phone number for this send. Accept
   *  either the GHL phoneNumberId or the E.164 'from' string. */
  fromNumberId?: string;
  fromNumber?: string;
}

const logStep = (step: string, details?: unknown) => {
  const tail = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[SEND-GHL-SMS] ${step}${tail}`);
};

// E.164 normalizer for US numbers. Handles common shapes:
//   "+13013468452"       -> "+13013468452"
//   "13013468452"        -> "+13013468452"
//   "3013468452"         -> "+13013468452"
//   "(301) 346-8452"     -> "+13013468452"
//   "+44 20 7946 0958"   -> "+442079460958"  (non-US passthrough)
function toE164(input: string | undefined | null): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  if (raw.startsWith("+")) {
    const digits = raw.slice(1).replace(/[^0-9]/g, "");
    return digits ? `+${digits}` : null;
  }
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 7) return null; // local number, can't fix
  return digits ? `+${digits}` : null;
}

// Resolve a Supabase app_secrets value (DB-override layer). Falls back
// to env vars when the row is missing or empty so a new install works
// before the operator has populated app_secrets.
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

async function ghlFetch(path: string, init: RequestInit, token: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Version: GHL_VERSION,
    Accept: "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${GHL_BASE}${path}`, { ...init, headers });
  return res;
}

// GHL enforces two separate rate limits, and they fail identically (HTTP 429):
//   • a BURST limit  (x-ratelimit-remaining, resets every ~10s) — transient,
//     worth one retry.
//   • a DAILY limit  (x-ratelimit-daily-remaining, resets at the daily window)
//     — once it hits 0 every call 429s for hours, and retrying is pointless.
// Distinguishing them is the difference between "try again in a second" and
// "GHL is down for us until the quota resets", which callers need to know so a
// spent daily quota isn't mistaken for a bad phone number.
interface RateInfo {
  limited: boolean;
  dailyExhausted: boolean;
  dailyRemaining: string | null;
  intervalMs: number;
}
function readRateInfo(res: Response): RateInfo {
  const dailyRemaining = res.headers.get("x-ratelimit-daily-remaining");
  return {
    limited: res.status === 429,
    dailyExhausted: res.status === 429 && dailyRemaining === "0",
    dailyRemaining,
    intervalMs: Number(res.headers.get("x-ratelimit-interval-milliseconds") || "0"),
  };
}

// Retry a GHL call ONCE on a burst-limit 429. A daily-exhausted 429 is returned
// as-is — waiting 10s wouldn't help when the window resets in hours.
async function ghlFetchRetry(path: string, init: RequestInit, token: string) {
  let res = await ghlFetch(path, init, token);
  if (res.status === 429) {
    const info = readRateInfo(res);
    if (!info.dailyExhausted) {
      const wait = Math.min(Math.max(info.intervalMs, 1000), 3000);
      logStep("burst rate-limited — retrying once", { path, waitMs: wait });
      await new Promise((r) => setTimeout(r, wait));
      res = await ghlFetch(path, init, token);
    }
  }
  return res;
}

// Look up a phoneNumberId by its E.164 'phoneNumber' so operators can
// configure GHL_DEFAULT_SMS_FROM_NUMBER (the friendly +1… string) and we
// resolve the id at first use, cached per cold start.
let phoneIdCache: Map<string, string> | null = null;
async function resolvePhoneNumberId(
  e164: string,
  token: string,
  locationId: string,
): Promise<string | null> {
  if (!e164 || !token || !locationId) return null;
  if (phoneIdCache?.has(e164)) return phoneIdCache.get(e164)!;
  try {
    const res = await ghlFetch(
      `/phone-system/numbers/list?locationId=${encodeURIComponent(locationId)}&limit=100`,
      {},
      token,
    );
    if (!res.ok) {
      logStep("phone-number list failed", { status: res.status });
      return null;
    }
    const json = await res.json();
    const numbers = (json?.numbers || json?.data || []) as Array<{
      id?: string;
      phoneNumber?: string;
    }>;
    phoneIdCache = new Map();
    for (const n of numbers) {
      if (n.id && n.phoneNumber) phoneIdCache.set(n.phoneNumber, n.id);
    }
    return phoneIdCache.get(e164) || null;
  } catch (err) {
    logStep("phone-number lookup error", err instanceof Error ? err.message : String(err));
    return null;
  }
}

interface ContactResolution {
  contactId: string | null;
  rate: RateInfo | null;
}
async function resolveContactId(
  body: Body,
  token: string,
  locationId: string,
  normalizedPhone: string | null,
): Promise<ContactResolution> {
  if (body.contactId) return { contactId: body.contactId, rate: null };
  if (!body.email && !normalizedPhone) return { contactId: null, rate: null };
  const upsertBody: Record<string, unknown> = {
    locationId,
    email: body.email || undefined,
    phone: normalizedPhone || undefined,
    firstName: body.firstName || undefined,
    lastName: body.lastName || undefined,
    country: "US",
  };
  const res = await ghlFetchRetry(
    "/contacts/upsert",
    { method: "POST", body: JSON.stringify(upsertBody) },
    token,
  );
  if (res.status === 429) {
    const rate = readRateInfo(res);
    logStep("upsert rate-limited", rate);
    return { contactId: null, rate };
  }
  if (!res.ok) {
    const text = await res.text();
    logStep("upsert failed", { status: res.status, body: text.slice(0, 300) });
    return { contactId: null, rate: null };
  }
  const json = await res.json();
  return {
    contactId: (json?.contact?.id as string | undefined) ||
      (json?.id as string | undefined) || null,
    rate: null,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    );

    const token = (Deno.env.get("GHL_PIT_TOKEN") || "").trim();
    const locationId = (Deno.env.get("GHL_LOCATION_ID") || "").trim();
    if (!token || !locationId) {
      return new Response(JSON.stringify({ error: "GHL not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    const body: Body = await req.json();
    if (!body.message || !body.message.trim()) {
      return new Response(JSON.stringify({ error: "message required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // 1. Normalize the customer's phone to E.164 BEFORE upsert + send.
    const normalizedPhone = toE164(body.phone);
    if (body.phone && !normalizedPhone) {
      logStep("could not normalize phone", { input: body.phone });
    }

    // 2. Resolve the verified outbound phoneNumberId. Priority:
    //   a) body.fromNumberId (explicit override)
    //   b) body.fromNumber → look up the id
    //   c) app_secrets.GHL_DEFAULT_SMS_NUMBER_ID
    //   d) app_secrets.GHL_DEFAULT_SMS_FROM_NUMBER → look up the id
    //   e) (no phoneNumberId — GHL will use the location default)
    let phoneNumberId: string | null = body.fromNumberId || null;
    if (!phoneNumberId && body.fromNumber) {
      phoneNumberId = await resolvePhoneNumberId(
        toE164(body.fromNumber) || body.fromNumber,
        token,
        locationId,
      );
    }
    if (!phoneNumberId && body.type === "job_offer") {
      const offerFrom = await resolveSecret(supabase, "GHL_JOB_OFFER_SMS_FROM_NUMBER");
      const offerE164 = toE164(offerFrom || "+14432744402");
      if (offerE164) {
        phoneNumberId = await resolvePhoneNumberId(offerE164, token, locationId);
      }
    }
    if (!phoneNumberId) {
      const cfgId = await resolveSecret(supabase, "GHL_DEFAULT_SMS_NUMBER_ID");
      if (cfgId) phoneNumberId = cfgId;
    }
    if (!phoneNumberId) {
      const cfgFrom = await resolveSecret(supabase, "GHL_DEFAULT_SMS_FROM_NUMBER");
      if (cfgFrom) {
        phoneNumberId = await resolvePhoneNumberId(
          toE164(cfgFrom) || cfgFrom,
          token,
          locationId,
        );
      }
    }

    // 3. Resolve / upsert the contact.
    const resolution = await resolveContactId(
      body,
      token,
      locationId,
      normalizedPhone,
    );
    const contactId = resolution.contactId;
    if (!contactId) {
      // A 429 here is NOT "no such contact" — it's GHL refusing the call. Say
      // so distinctly (429 + rateLimited) so callers don't fall through to a
      // Telnyx/other transport on what is really a temporary GHL throttle, and
      // so logs stop blaming the phone number.
      if (resolution.rate?.limited) {
        return new Response(
          JSON.stringify({
            error: resolution.rate.dailyExhausted
              ? "GHL daily API quota exhausted — cannot send until it resets."
              : "GHL is rate-limiting requests right now.",
            rateLimited: true,
            dailyExhausted: resolution.rate.dailyExhausted,
            dailyRemaining: resolution.rate.dailyRemaining,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 429,
          },
        );
      }
      return new Response(
        JSON.stringify({ error: "unable to resolve contactId" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        },
      );
    }

    // 4. Send the message — include phoneNumberId only when we have one
    // so the location-default still works for ops that haven't picked a
    // verified number yet.
    //
    // IMPORTANT: GHL's /conversations/messages endpoint enforces a strict
    // enum on `type` (SMS | MMS | Email | …). Our callers pass internal
    // category labels in body.type (e.g. "verification",
    // "confirmation", "post_booking_confirmation") for logging only.
    // Map ANYTHING that isn't a known GHL message channel to "SMS" so a
    // caller's internal label can never cause a 422 from GHL.
    const GHL_MESSAGE_TYPES = new Set([
      "SMS", "MMS", "Email", "Live_Chat", "GMB", "FB", "IG", "WhatsApp",
    ]);
    const requestedType = String(body.type || "SMS");
    const ghlType = GHL_MESSAGE_TYPES.has(requestedType) ? requestedType : "SMS";
    const messagePayload: Record<string, unknown> = {
      type: ghlType,
      contactId,
      message: body.message,
    };
    if (phoneNumberId) messagePayload.phoneNumberId = phoneNumberId;

    const res = await ghlFetchRetry(
      "/conversations/messages",
      { method: "POST", body: JSON.stringify(messagePayload) },
      token,
    );
    const text = await res.text();
    if (res.status === 429) {
      const rate = readRateInfo(res);
      logStep("send rate-limited", rate);
      return new Response(
        JSON.stringify({
          error: rate.dailyExhausted
            ? "GHL daily API quota exhausted — cannot send until it resets."
            : "GHL is rate-limiting requests right now.",
          rateLimited: true,
          dailyExhausted: rate.dailyExhausted,
          dailyRemaining: rate.dailyRemaining,
          contactId,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 429,
        },
      );
    }
    if (!res.ok) {
      // The recipient texted STOP. This is a PERMANENT condition, not an
      // error: report success + suppressed so cron callers stamp their
      // sent_at markers and stop retrying, and nobody routes around the
      // opt-out via another transport (TCPA).
      if (/unsubscrib|CONVERSATIONS_MSG_UNSUBSCRIBED/i.test(text)) {
        logStep("recipient unsubscribed — suppressing permanently", { normalizedPhone });
        return new Response(
          JSON.stringify({
            success: true,
            suppressed: true,
            reason: "recipient_unsubscribed",
            contactId,
            normalizedPhone,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }
      logStep("send failed", { status: res.status, body: text.slice(0, 500) });
      return new Response(
        JSON.stringify({
          error: "send failed",
          status: res.status,
          body: text.slice(0, 500),
          usedPhoneNumberId: phoneNumberId,
          normalizedPhone,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 502,
        },
      );
    }
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text);
    } catch { /* ignore */ }
    return new Response(
      JSON.stringify({
        success: true,
        contactId,
        messageId: parsed.messageId || parsed.id || null,
        conversationId: parsed.conversationId || null,
        usedPhoneNumberId: phoneNumberId,
        normalizedPhone,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[send-ghl-sms] error", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

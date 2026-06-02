// ─── send-push ──────────────────────────────────────────────────────────────
//
// Sends a push notification to a cleaner's registered devices
// (cleaner_device_tokens). Android → FCM HTTP v1, iOS → APNs token-based
// (ES256 JWT). Credentials are read from app_secrets / env and the function
// no-ops gracefully when a transport isn't configured, so it's safe to wire
// into dispatch before the Apple/Google keys are in place.
//
// Body: { cleanerId?, userId?, tokens?: string[], title, body, data? }
//
// Secrets used (any subset):
//   FCM_SERVICE_ACCOUNT_JSON  — full Google service-account JSON (Android)
//   APNS_KEY_P8               — contents of the AuthKey_XXXX.p8 (iOS)
//   APNS_KEY_ID, APNS_TEAM_ID — from the Apple developer portal
//   APNS_BUNDLE_ID            — defaults to com.novaracleaning.contractor
//   APNS_PRODUCTION           — "true" for production APNs host

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveSecret } from "../_shared/app-secrets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (s: string, d?: unknown) =>
  console.log(`[send-push] ${s}${d ? ` ${JSON.stringify(d)}` : ""}`);

interface DeviceToken {
  token: string;
  platform: string;
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ─── FCM HTTP v1 (Android) ───────────────────────────────────────────────
async function getFcmAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(claim)}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.private_key) as unknown as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput)),
  );
  const jwt = `${signingInput}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) throw new Error(`FCM token exchange failed: ${JSON.stringify(json)}`);
  return json.access_token as string;
}

async function sendFcm(
  accessToken: string,
  projectId: string,
  token: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<boolean> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: { token, notification: { title, body }, data, android: { priority: "HIGH" } },
    }),
  });
  if (!res.ok) {
    log("fcm send failed", { status: res.status, body: (await res.text()).slice(0, 300) });
    return false;
  }
  return true;
}

// ─── APNs token-based (iOS) ──────────────────────────────────────────────
async function makeApnsJwt(p8: string, keyId: string, teamId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: keyId, typ: "JWT" };
  const claim = { iss: teamId, iat: now };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(claim)}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(p8) as unknown as ArrayBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signingInput)),
  );
  return `${signingInput}.${b64url(sig)}`;
}

async function sendApns(
  jwt: string,
  bundleId: string,
  production: boolean,
  token: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<boolean> {
  const host = production ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";
  const res = await fetch(`${host}/3/device/${token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    },
    body: JSON.stringify({ aps: { alert: { title, body }, sound: "default" }, ...data }),
  });
  if (!res.ok) {
    log("apns send failed", { status: res.status, body: (await res.text()).slice(0, 300) });
    return false;
  }
  return true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { cleanerId, userId, tokens: tokenList, title, body, data } = await req.json();
    if (!title || !body) {
      return new Response(JSON.stringify({ error: "title and body required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Resolve target device tokens.
    let devices: DeviceToken[] = [];
    if (Array.isArray(tokenList) && tokenList.length > 0) {
      devices = tokenList.map((t: string) => ({ token: t, platform: "unknown" }));
    } else if (cleanerId || userId) {
      let q = supabase.from("cleaner_device_tokens").select("token, platform");
      q = cleanerId ? q.eq("cleaner_id", cleanerId) : q.eq("user_id", userId);
      const { data: rows } = await q;
      devices = (rows as DeviceToken[]) || [];
    }

    if (devices.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0, reason: "no-devices" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dataStr: Record<string, string> = {};
    if (data && typeof data === "object") {
      for (const [k, v] of Object.entries(data)) dataStr[k] = String(v);
    }

    // Lazily prepare each transport based on which devices we have + creds.
    const hasAndroid = devices.some((d) => d.platform === "android" || d.platform === "unknown");
    const hasIos = devices.some((d) => d.platform === "ios" || d.platform === "unknown");

    let fcmAccessToken = "";
    let fcmProjectId = "";
    if (hasAndroid) {
      const saRaw = await resolveSecret(supabase, "FCM_SERVICE_ACCOUNT_JSON");
      if (saRaw) {
        try {
          const sa = JSON.parse(saRaw);
          fcmProjectId = sa.project_id;
          fcmAccessToken = await getFcmAccessToken(sa);
        } catch (e) {
          log("fcm init failed", { err: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    let apnsJwt = "";
    let apnsBundleId = "";
    let apnsProd = false;
    if (hasIos) {
      const p8 = await resolveSecret(supabase, "APNS_KEY_P8");
      const keyId = await resolveSecret(supabase, "APNS_KEY_ID");
      const teamId = await resolveSecret(supabase, "APNS_TEAM_ID");
      if (p8 && keyId && teamId) {
        try {
          apnsJwt = await makeApnsJwt(p8, keyId, teamId);
          apnsBundleId =
            (await resolveSecret(supabase, "APNS_BUNDLE_ID")) || "com.novaracleaning.contractor";
          apnsProd = (await resolveSecret(supabase, "APNS_PRODUCTION")) === "true";
        } catch (e) {
          log("apns init failed", { err: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    let sent = 0;
    let failed = 0;
    for (const d of devices) {
      const isIos = d.platform === "ios";
      const isAndroid = d.platform === "android";
      let ok = false;
      try {
        if ((isAndroid || (!isIos && fcmAccessToken)) && fcmAccessToken && fcmProjectId) {
          ok = await sendFcm(fcmAccessToken, fcmProjectId, d.token, title, body, dataStr);
        } else if ((isIos || (!isAndroid && apnsJwt)) && apnsJwt) {
          ok = await sendApns(apnsJwt, apnsBundleId, apnsProd, d.token, title, body, dataStr);
        }
      } catch (e) {
        log("send threw", { err: e instanceof Error ? e.message : String(e) });
      }
      if (ok) sent++;
      else failed++;
    }

    return new Response(JSON.stringify({ success: true, sent, failed, total: devices.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("ERROR", { message });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Lists new Indeed application emails from the hiring inbox.
// The mailbox is read with the Google service account already used for Drive,
// impersonating GOOGLE_DRIVE_IMPERSONATE_EMAIL. Domain-wide delegation must
// include https://www.googleapis.com/auth/gmail.readonly.
//
// Called by the hiring cron with the service role, or by pg_net with the anon
// key plus x-cron-secret. Returns headers and a short snippet only.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const QUERY = 'from:indeedemail.com subject:"New application" newer_than:7d';

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(rawPem: string): ArrayBuffer {
  const pem = rawPem.replace(/\\n/g, "\n");
  const header = "-----BEGIN PRIVATE KEY-----";
  const footer = "-----END PRIVATE KEY-----";
  const start = pem.indexOf(header);
  const end = pem.indexOf(footer);
  if (start < 0 || end < 0) throw new Error("missing_key");
  const body = pem.slice(start + header.length, end).replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function roleOf(req: Request): string {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const part = token.split(".")[1];
  if (!part) return "";
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/");
    return String(JSON.parse(atob(padded)).role || "");
  } catch {
    return "";
  }
}

async function authorized(req: Request, cronSecret: string): Promise<boolean> {
  const provided = req.headers.get("x-cron-secret") || "";
  if (cronSecret && provided && provided === cronSecret) return true;
  return roleOf(req) === "service_role";
}

async function accessToken(saEmail: string, privateKey: string, subject: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({
    iss: saEmail,
    sub: subject,
    scope: GMAIL_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const assertion = `${unsigned}.${b64url(sig)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = String(body.error || "");
    if (code === "unauthorized_client") throw new Error("gmail_scope");
    if (code === "invalid_grant") throw new Error("gmail_delegation");
    throw new Error("gmail_token");
  }
  if (!body.access_token) throw new Error("gmail_token");
  return String(body.access_token);
}

function header(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string {
  return headers?.find((row) => row.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

serve(async (req) => {
  if (req.method !== "POST") return json({ configured: false, error: "POST required" }, 405);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const { data: secretRows } = await supabase.from("app_secrets").select("key, value").in("key", [
    "CRON_SECRET",
    "GOOGLE_DRIVE_IMPERSONATE_EMAIL",
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  ]);
  const secrets = new Map((secretRows || []).map((row) => [String(row.key), String(row.value || "")]));
  if (!(await authorized(req, (secrets.get("CRON_SECRET") || Deno.env.get("CRON_SECRET") || "").trim()))) {
    return json({ configured: false, error: "unauthorized" }, 401);
  }

  const saEmail = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL") || secrets.get("GOOGLE_SERVICE_ACCOUNT_EMAIL") || "").trim();
  const privateKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY") || "";
  const mailbox = (secrets.get("GOOGLE_DRIVE_IMPERSONATE_EMAIL") || Deno.env.get("GOOGLE_DRIVE_IMPERSONATE_EMAIL") || "").trim();
  if (!saEmail || !privateKey) return json({ configured: false, error: "missing_key" });
  if (!mailbox) return json({ configured: false, error: "missing_mailbox" });

  let token = "";
  try {
    token = await accessToken(saEmail, privateKey, mailbox);
  } catch (err) {
    return json({ configured: false, error: err instanceof Error ? err.message : "gmail_token" });
  }

  const probe = new URL(req.url).searchParams.get("probe") === "1";
  const messages: Array<{ from: string; subject: string; snippet: string; messageId: string; threadId: string; date: string }> = [];
  let pageToken = "";
  for (let page = 0; page < 2; page++) {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", QUERY);
    url.searchParams.set("maxResults", "25");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const listed = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!listed.ok) return json({ configured: false, error: "gmail_list" });
    const list = await listed.json() as { messages?: Array<{ id: string; threadId: string }>; nextPageToken?: string };
    if (probe) return json({ configured: true, count: (list.messages || []).length });
    for (const item of list.messages || []) {
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) continue;
      const message = await res.json() as {
        snippet?: string;
        internalDate?: string;
        payload?: { headers?: Array<{ name?: string; value?: string }> };
      };
      const from = header(message.payload?.headers, "From");
      messages.push({
        from: from.match(/<([^>]+)>/)?.[1] || from,
        subject: header(message.payload?.headers, "Subject"),
        snippet: String(message.snippet || "").slice(0, 300),
        messageId: item.id,
        threadId: item.threadId,
        date: message.internalDate
          ? new Date(Number(message.internalDate)).toISOString()
          : header(message.payload?.headers, "Date"),
      });
    }
    pageToken = list.nextPageToken || "";
    if (!pageToken) break;
  }
  return json({ configured: true, messages });
});

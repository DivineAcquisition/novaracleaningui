// ─── store-service-agreement ────────────────────────────────────────────────
//
// Receives a customer's signed service / membership agreement (generated in
// the browser), stores the PDF in the private service-agreements bucket,
// records the acceptance in public.service_agreements, and uploads a copy to
// Google Drive (best-effort). Customer delivery is handled by GHL.
//
// Body: {
//   bookingId?, email, name, serviceType?, source?,
//   agreementType?: "one_time_service" | "membership",
//   agreed: { terms, disclaimer, refund, serviceAgreement },
//   pdfBase64
// }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const log = (s: string, d?: unknown) =>
  console.log(`[store-service-agreement] ${s}${d ? " " + JSON.stringify(d) : ""}`);

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Upload the agreement PDF to a shared Google Drive folder. No-ops unless the
// Google service account + GDRIVE_AGREEMENTS_FOLDER_ID are configured.
async function uploadToDrive(bytes: Uint8Array, filename: string): Promise<string | null> {
  const saEmail = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const saKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  const folderId = Deno.env.get("GDRIVE_AGREEMENTS_FOLDER_ID");
  if (!saEmail || !saKey || !folderId) {
    log("drive skipped — not configured");
    return null;
  }
  try {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
    const claim = b64url(
      new TextEncoder().encode(JSON.stringify({
        iss: saEmail,
        scope: "https://www.googleapis.com/auth/drive",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      })),
    );
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pemToDer(saKey) as unknown as ArrayBuffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = new Uint8Array(
      await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claim}`)),
    );
    const jwt = `${header}.${claim}.${b64url(sig)}`;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });
    const { access_token } = await tokenRes.json();
    if (!access_token) {
      log("drive token failed");
      return null;
    }
    const boundary = "novara" + crypto.randomUUID();
    const meta = JSON.stringify({ name: filename, parents: [folderId] });
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;
    const enc = new TextEncoder();
    const headBytes = enc.encode(head);
    const tailBytes = enc.encode(tail);
    const bodyBytes = new Uint8Array(headBytes.length + bytes.length + tailBytes.length);
    bodyBytes.set(headBytes, 0);
    bodyBytes.set(bytes, headBytes.length);
    bodyBytes.set(tailBytes, headBytes.length + bytes.length);
    const upRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: bodyBytes,
      },
    );
    if (!upRes.ok) {
      log("drive upload failed", { status: upRes.status, body: (await upRes.text()).slice(0, 200) });
      return null;
    }
    const file = await upRes.json();
    log("drive uploaded", { id: file.id });
    return file.id || null;
  } catch (e) {
    log("drive threw", { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const email = String(body?.email || "").trim().toLowerCase();
    const name = String(body?.name || "").trim();
    const bookingId = body?.bookingId ? String(body.bookingId) : null;
    const source = String(body?.source || "checkout");
    const agreed = body?.agreed || {};
    const pdfBase64 = String(body?.pdfBase64 || "");
    // Membership pay page must never land as one_time_service (DB default).
    const rawType = String(body?.agreementType || "").trim().toLowerCase();
    const agreementType =
      rawType === "membership" || rawType === "membership_recurring"
        ? "membership"
        : source === "membership_pay"
          ? "membership"
          : "one_time_service";

    if (!email.includes("@")) return json({ error: "email required" }, 400);
    if (!pdfBase64) return json({ error: "pdfBase64 required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: row, error: insErr } = await supabase
      .from("service_agreements")
      .insert({
        booking_id: bookingId,
        customer_email: email,
        customer_name: name || null,
        agreement_type: agreementType,
        agreed_terms: Boolean(agreed?.terms),
        agreed_disclaimer: Boolean(agreed?.disclaimer),
        agreed_refund: Boolean(agreed?.refund),
        agreed_service_agreement: Boolean(agreed?.serviceAgreement),
        signed_by: name || null,
        source,
        ip: req.headers.get("x-forwarded-for") || null,
        user_agent: req.headers.get("user-agent") || null,
      })
      .select("id")
      .single();
    if (insErr) throw insErr;

    const agreementId = row.id as string;
    const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
    const safe = (bookingId || email).replace(/[^a-zA-Z0-9._@-]/g, "_");
    const path = `${safe}/${agreementId}.pdf`;

    const { error: upErr } = await supabase.storage
      .from("service-agreements")
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (upErr) {
      log("storage upload failed", { error: upErr.message });
    } else {
      await supabase.from("service_agreements").update({ pdf_path: path }).eq("id", agreementId);
    }

    // Google Drive copy (best-effort).
    const fileName = `Novara ${agreementType === "membership" ? "Membership" : "Service"} Agreement - ${name || email} - ${new Date().toISOString().slice(0, 10)}.pdf`;
    await uploadToDrive(bytes, fileName);

    // NOTE: the agreement is intentionally NOT emailed from here — delivery to
    // the customer is handled by GoHighLevel.

    return json({ ok: true, id: agreementId, path });
  } catch (e) {
    log("ERROR", { error: e instanceof Error ? e.message : String(e) });
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

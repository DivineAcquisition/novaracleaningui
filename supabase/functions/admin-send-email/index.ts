// ─── admin-send-email — generic admin email sender ─────────────────────
//
// Powers the Manual Messages composer in the admin portal. Posts a single
// email through Resend with a small wrapper so the Inter font + signature
// are consistent with our other transactional emails.
//
// Body shape:
//   {
//     to: string;                  // single email
//     subject: string;
//     html: string;                // already-formatted HTML body
//     from?: string;               // defaults to "Novara Cleaning <hello@novaracleaning.com>"
//   }
//
// Returns 200 with { success: true, id } when Resend accepts.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (s: string, d?: unknown) =>
  console.log(`[ADMIN-SEND-EMAIL] ${s}${d ? " " + JSON.stringify(d) : ""}`);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = await req.json();
    const to = String(body.to || "").trim();
    const subject = String(body.subject || "").trim();
    const html = String(body.html || "");
    const from = String(body.from || "Novara Cleaning <hello@novaracleaning.com>");
    // Optional file attachments: [{ filename, content }] where content is
    // base64 (Resend's format). Passed straight through when provided.
    const attachments = Array.isArray(body.attachments) && body.attachments.length > 0
      ? body.attachments
          .map((a: { filename?: string; content?: string }) => ({
            filename: String(a?.filename || "attachment"),
            content: String(a?.content || ""),
          }))
          .filter((a: { content: string }) => a.content.length > 0)
      : undefined;
    if (!to || !subject || !html) {
      return new Response(JSON.stringify({ error: "to, subject, and html are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, html, ...(attachments ? { attachments } : {}) }),
    });
    const text = await res.text();
    if (!res.ok) {
      log("resend error", { status: res.status, body: text.slice(0, 300) });
      return new Response(JSON.stringify({ error: text }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let id = "";
    try {
      id = (JSON.parse(text)?.id as string) || "";
    } catch {
      /* ignore */
    }
    log("ok", { id, to, subject });
    return new Response(JSON.stringify({ success: true, id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    log("unhandled", { error: err instanceof Error ? err.message : String(err) });
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

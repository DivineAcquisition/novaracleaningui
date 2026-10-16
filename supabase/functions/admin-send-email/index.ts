// ─── admin-send-email — generic admin email sender ─────────────────────
//
// Every message through this function gets exactly one email type and the
// footer for that type. Marketing that fails a check is not sent. Service
// mail with a misplaced offer has that offer removed. The delivery log
// stores the rendered message.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { deliverCompliantEmail } from "../_shared/email-compliance-send.ts";

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
    if (!to || !subject || !html) {
      return new Response(JSON.stringify({ error: "to, subject, and html are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const fromHint = String(body.from || "");
    let declaredType = body.emailType || body.declaredType || null;
    if (!declaredType && /operations@novaracleaning\.com/i.test(fromHint)) {
      declaredType = "contractor_operational";
    }
    const personal = body.personalFrom && typeof body.personalFrom === "object" ? body.personalFrom : null;
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const attachments = Array.isArray(body.attachments) && body.attachments.length > 0
      ? body.attachments
        .map((a: { filename?: string; content?: string }) => ({
          filename: String(a?.filename || "attachment"),
          content: String(a?.content || ""),
        }))
        .filter((a: { content: string }) => a.content.length > 0)
      : undefined;
    const outcome = await deliverCompliantEmail(supabase, {
      apiKey,
      to,
      subject,
      html,
      text: typeof body.text === "string" ? body.text : null,
      declaredType,
      templateKey: body.templateKey || body.template_key || null,
      category: body.category || null,
      adminAcknowledged: body.adminAcknowledged === true,
      separatedOfferHtml: typeof body.separatedOfferHtml === "string" ? body.separatedOfferHtml : null,
      testSend: body.testSend === true,
      contractorRelationship: body.contractorRelationship || null,
      staffRecipient: body.staffRecipient === true ? true : body.staffRecipient === false ? false : undefined,
      personalFrom: personal,
      isReply: body.isReply === true,
      bookingId: body.bookingId || null,
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim().slice(0, 256) : "",
      attachments,
      cc: Array.isArray(body.cc) ? body.cc.map((item: unknown) => String(item)) : undefined,
    });
    if (!outcome.ok) {
      log(outcome.blocked ? "blocked" : "resend error", { to, subject, error: outcome.error });
      return new Response(JSON.stringify({
        error: outcome.error,
        blocked: outcome.blocked,
        blockReasons: outcome.blocked ? [outcome.error] : [],
        warnings: outcome.warnings,
        type: outcome.type,
      }), {
        status: outcome.blocked ? 409 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    log("ok", { id: outcome.id, to, subject, type: outcome.type });
    return new Response(JSON.stringify({ success: true, id: outcome.id, warnings: outcome.warnings, type: outcome.type }), {
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

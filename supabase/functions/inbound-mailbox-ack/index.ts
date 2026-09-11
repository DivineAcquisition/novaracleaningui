// Inbound mailbox ack — disputes, inquiries, and complaints only.
//
// Sends a short "we received your request and informed {Billing|Dispatch|Operations}"
// reply from NovaraCleaning. Hard gate: the receiving address MUST be
// support@novaracleaning.com or billing@novaracleaning.com. Anything else
// (contact@, hello@, personal inboxes) is ignored and never replied to.
//
// Accepts:
//   • Resend `email.received` webhooks
//   • A flattened JSON body { from, to, cc, subject, text, html, messageId }
//
// Never CCs maliksannie7@gmail.com. Never signs with a personal name.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { Resend } from "https://esm.sh/resend@4.0.0";
import {
  BLOCKED_CC,
  decideMailboxAck,
  parseResendReceivedEvent,
  SEND_AS,
  type InboundMail,
} from "../_shared/mailbox-ack.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function log(step: string, details?: unknown) {
  console.log(`[MAILBOX-ACK] ${step}`, details === undefined ? "" : JSON.stringify(details));
}

async function resolveSecret(supabase: ReturnType<typeof createClient>, key: string): Promise<string> {
  const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
  return ((data as { value?: string } | null)?.value as string) || Deno.env.get(key) || "";
}

function flagOn(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v === "" || v === "true" || v === "1" || v === "yes";
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const enabled = flagOn(await resolveSecret(supabase, "MAILBOX_ACK_ENABLED"));
  const raw = await req.text();

  let payload: Record<string, unknown> = {};
  try {
    payload = raw ? JSON.parse(raw) as Record<string, unknown> : {};
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  let mail: InboundMail | null = parseResendReceivedEvent(payload);
  if (!mail) {
    mail = {
      messageId: String(payload.messageId ?? payload.message_id ?? payload.id ?? ""),
      from: payload.from as string | undefined,
      to: payload.to as string | string[] | undefined,
      cc: payload.cc as string | string[] | undefined,
      bcc: payload.bcc as string | string[] | undefined,
      deliveredTo: payload.deliveredTo as string | undefined,
      subject: payload.subject as string | undefined,
      text: payload.text as string | undefined,
      html: payload.html as string | undefined,
    };
  }

  // Resend email.received often has metadata only. Pull the body when we
  // have an email_id and a Resend key — still decide from recipients first.
  const emailId = String(
    (payload as { data?: { email_id?: string } }).data?.email_id
      || payload.email_id
      || mail.messageId
      || "",
  );
  const looksLikeResendReceived = payload.type === "email.received" || Boolean(
    (payload as { data?: { email_id?: string } }).data?.email_id,
  );
  if (looksLikeResendReceived && emailId && !mail.text && !mail.html) {
    const resendKey = await resolveSecret(supabase, "RESEND_API_KEY");
    if (resendKey) {
      try {
        const resend = new Resend(resendKey);
        const fetched = await resend.emails.receiving.get(emailId);
        const full = (fetched as { data?: Record<string, unknown> }).data || {};
        mail = {
          ...mail,
          messageId: emailId,
          from: (full.from as string) || mail.from,
          to: (full.to as string | string[]) || mail.to,
          cc: (full.cc as string | string[]) || mail.cc,
          subject: (full.subject as string) || mail.subject,
          text: (full.text as string) || mail.text,
          html: (full.html as string) || mail.html,
        };
      } catch (err) {
        log("resend_fetch_failed", { emailId, error: String((err as Error)?.message || err) });
      }
    }
  }

  if (!enabled) {
    log("disabled", { to: mail.to });
    return json({ skipped: true, reason: "disabled" });
  }

  const decision = decideMailboxAck(mail);
  const dedupeKey = mail.messageId && mail.messageId.length > 0
    ? mail.messageId
    : await sha256Hex(raw || JSON.stringify(mail));

  const { data: existing } = await supabase
    .from("mailbox_ack_log")
    .select("id, status")
    .eq("source_message_id", dedupeKey)
    .maybeSingle();
  if (existing) {
    log("duplicate", { dedupeKey, status: (existing as { status?: string }).status });
    return json({ skipped: true, reason: "duplicate" });
  }

  if (decision.action === "skip") {
    log("skip", { reason: decision.reason, to: mail.to, from: mail.from });
    await supabase.from("mailbox_ack_log").insert({
      source_message_id: dedupeKey,
      mailbox: null,
      from_email: mail.from || null,
      kind: null,
      party: null,
      status: "skipped",
      skip_reason: decision.reason,
    });
    return json({ skipped: true, reason: decision.reason });
  }

  const resendKey = await resolveSecret(supabase, "RESEND_API_KEY") || Deno.env.get("RESEND_API_KEY") || "";
  if (!resendKey) {
    log("missing_resend_key");
    return json({ error: "RESEND_API_KEY not configured" }, 500);
  }

  const resend = new Resend(resendKey);
  const { data: sent, error: sendError } = await resend.emails.send({
    from: SEND_AS,
    to: [decision.to],
    replyTo: decision.replyTo,
    subject: decision.subject,
    text: decision.text,
    html: decision.html,
    headers: {
      "X-Novara-Mailbox-Ack": "1",
      "X-Novara-Party": decision.party,
    },
  });

  if (sendError) {
    log("send_failed", { error: sendError });
    await supabase.from("mailbox_ack_log").insert({
      source_message_id: dedupeKey,
      mailbox: decision.mailbox,
      from_email: decision.to,
      kind: decision.kind,
      party: decision.party,
      status: "failed",
      skip_reason: String((sendError as { message?: string }).message || sendError),
    });
    return json({ error: "send_failed" }, 502);
  }

  log("sent", {
    to: decision.to,
    mailbox: decision.mailbox,
    party: decision.party,
    kind: decision.kind,
    blockedCc: BLOCKED_CC,
    id: (sent as { id?: string } | null)?.id,
  });

  await supabase.from("mailbox_ack_log").insert({
    source_message_id: dedupeKey,
    mailbox: decision.mailbox,
    from_email: decision.to,
    kind: decision.kind,
    party: decision.party,
    status: "sent",
    resend_id: (sent as { id?: string } | null)?.id || null,
  });

  return json({
    sent: true,
    party: decision.party,
    kind: decision.kind,
    mailbox: decision.mailbox,
  });
});

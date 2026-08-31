import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  mergePartnershipSettings,
  partnershipRecipientKey,
  retryBackoffMs,
} from "./policy";
import { substitutePartnershipTemplate } from "./substitute";
import type {
  PartnershipChannel,
  PartnershipChannelResult,
  PartnershipCommsSettings,
  PartnershipMessageStatus,
  PartnershipPolicyDecision,
  PartnershipPriority,
  PartnershipRole,
  PartnershipSendInput,
  PartnershipSendResult,
  PartnershipTemplate,
} from "./types";
import { DEFAULT_PARTNERSHIP_COMMS_SETTINGS } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = SupabaseClient | any;

export async function loadPartnershipSettings(supabase: SB): Promise<PartnershipCommsSettings> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "partnership_comms_settings")
    .maybeSingle();
  return mergePartnershipSettings(data?.value);
}

function mintToken(): string {
  return randomBytes(18).toString("base64url");
}

function validEmail(value?: string | null): string | null {
  const v = String(value || "").trim();
  return /.+@.+\..+/.test(v) ? v : null;
}

function validPhone(value?: string | null): string | null {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 ? String(value || "").trim() : null;
}

async function loadTemplate(supabase: SB, key: string): Promise<PartnershipTemplate | null> {
  const { data } = await supabase
    .from("partnership_message_templates")
    .select("*")
    .eq("key", key)
    .eq("is_current", true)
    .maybeSingle();
  return (data as PartnershipTemplate | null) || null;
}

async function policyCheck(
  supabase: SB,
  args: {
    email: string | null;
    phone: string | null;
    channel: PartnershipChannel;
    priority: PartnershipPriority;
  },
): Promise<PartnershipPolicyDecision> {
  const { data, error } = await supabase.rpc("partnership_comms_check", {
    p_email: args.email,
    p_phone: args.phone,
    p_channel: args.channel,
    p_priority: args.priority,
  });
  if (error || !data) {
    // Migration not applied yet — do not silently skip a real send, but
    // never invent a suppress. Production has the RPC.
    console.warn("[partnership-comms] policy RPC unavailable", error?.message);
    return {
      action: "send",
      reason: "rpc_unavailable",
      recipient_key: partnershipRecipientKey(args.email, args.phone),
    };
  }
  const row = data as PartnershipPolicyDecision;
  return {
    action: row.action === "queue" || row.action === "suppress" ? row.action : "send",
    reason: String(row.reason || ""),
    recipient_key: row.recipient_key,
    send_after: row.send_after || null,
  };
}

function unsubscribePageUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/partner/unsubscribe?t=${encodeURIComponent(token)}`;
}

function unsubscribeApiUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/api/partnership-comms/unsubscribe?t=${encodeURIComponent(token)}`;
}

function withEmailFooter(html: string, role: PartnershipRole, unsub: string | null): string {
  if (role !== "partner" || !unsub) return html;
  if (/unsubscribe/i.test(html)) return html;
  return `${html}<p style="margin-top:28px;font-size:12px;line-height:1.5;color:#64748b">This is a transactional notice about your Novara account. <a href="${unsub}">Unsubscribe from partnership emails</a>.</p>`;
}

async function deliverEmail(
  supabase: SB,
  args: {
    to: string;
    subject: string;
    html: string;
    from: string;
    replyTo: string;
    unsub: string | null;
    idempotencyKey: string;
    attachments?: Array<{ filename: string; content: string }>;
  },
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const headers: Record<string, string> = {};
  if (args.unsub) {
    headers["List-Unsubscribe"] = `<${args.unsub}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  const { data, error } = await supabase.functions.invoke("admin-send-email", {
    body: {
      to: args.to,
      subject: args.subject,
      html: args.html,
      from: args.from,
      replyTo: args.replyTo,
      headers,
      idempotencyKey: args.idempotencyKey,
      attachments: args.attachments,
    },
  });
  if (error) return { ok: false, error: error.message };
  const id = (data as { id?: string } | null)?.id;
  return { ok: true, id };
}

async function deliverSms(
  supabase: SB,
  args: { phone: string; email: string | null; message: string },
): Promise<{ ok: boolean; suppressed?: boolean; id?: string; error?: string }> {
  const { data, error } = await supabase.functions.invoke("send-ghl-sms", {
    body: {
      phone: args.phone,
      email: args.email || undefined,
      message: args.message,
      type: "confirmation",
    },
  });
  if ((data as { suppressed?: boolean } | null)?.suppressed) {
    return { ok: true, suppressed: true };
  }
  if (error) return { ok: false, error: error.message };
  if ((data as { error?: string } | null)?.error) {
    return { ok: false, error: String((data as { error: string }).error) };
  }
  const id = (data as { messageId?: string; id?: string } | null)?.messageId
    || (data as { id?: string } | null)?.id;
  return { ok: true, id };
}

async function escalateUrgentFailure(
  supabase: SB,
  row: {
    id: string;
    template_key: string;
    to_email: string | null;
    to_phone: string | null;
    error: string | null;
    attempt_count: number;
  },
): Promise<void> {
  await supabase.from("partnership_messages").update({
    escalated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);
  await supabase.from("events").insert({
    event_type: "partnership_comms.urgent_failed",
    source: "partnership-comms",
    summary:
      `Urgent partnership ${row.template_key} failed after ${row.attempt_count} attempt(s) ` +
      `to ${row.to_email || row.to_phone || "unknown"}: ${row.error || "no provider response"}`,
    data: {
      message_id: row.id,
      template_key: row.template_key,
      to_email: row.to_email,
      to_phone: row.to_phone,
      error: row.error,
    },
  });
}

export async function deliverPartnershipRow(
  supabase: SB,
  row: Record<string, unknown>,
  settings: PartnershipCommsSettings,
  extras?: { attachments?: Array<{ filename: string; content: string }> },
): Promise<PartnershipChannelResult> {
  const channel = row.channel as PartnershipChannel;
  const id = String(row.id);
  const priority = (row.priority as PartnershipPriority) || "standard";
  const maxAttempts = Number(row.max_attempts) || (priority === "urgent"
    ? settings.urgent_max_attempts
    : settings.standard_max_attempts);
  const attempt = Number(row.attempt_count || 0) + 1;
  const unsubToken = String(row.unsubscribe_token || "");
  const origin = settings.partners_origin;
  const unsubHeader = row.role === "partner" && unsubToken ? unsubscribeApiUrl(origin, unsubToken) : null;
  const sender = settings.senders[(row.role as PartnershipRole) || "partner"]
    || settings.senders.partner;

  await supabase.from("partnership_messages").update({
    status: "sending",
    attempt_count: attempt,
    updated_at: new Date().toISOString(),
  }).eq("id", id);

  let delivered: { ok: boolean; suppressed?: boolean; id?: string; error?: string };
  if (channel === "email") {
    delivered = await deliverEmail(supabase, {
      to: String(row.to_email || ""),
      subject: String(row.subject || ""),
      html: String(row.body || ""),
      from: sender.from,
      replyTo: sender.reply_to,
      unsub: unsubHeader,
      idempotencyKey: String(row.idempotency_key || id),
      attachments: extras?.attachments,
    });
  } else {
    delivered = await deliverSms(supabase, {
      phone: String(row.to_phone || ""),
      email: (row.to_email as string) || null,
      message: String(row.body || ""),
    });
  }

  if (delivered.suppressed) {
    await supabase.from("partnership_messages").update({
      status: "suppressed",
      error: "provider_unsubscribed",
      provider: channel === "sms" ? "ghl" : "resend",
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    await recordPartnershipOptOut(supabase, {
      email: (row.to_email as string) || null,
      phone: (row.to_phone as string) || null,
      channel,
      source: "provider_unsubscribed",
    });
    return { channel, status: "suppressed", reason: "provider_unsubscribed", id };
  }

  if (delivered.ok) {
    await supabase.from("partnership_messages").update({
      status: "sent",
      sent_at: new Date().toISOString(),
      provider: channel === "sms" ? "ghl" : "resend",
      provider_id: delivered.id || null,
      error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    return { channel, status: "sent", id };
  }

  const exhausted = attempt >= maxAttempts;
  const nextStatus: PartnershipMessageStatus = exhausted ? "failed" : "retry";
  const sendAfter = exhausted
    ? new Date().toISOString()
    : new Date(Date.now() + retryBackoffMs(attempt, priority)).toISOString();
  await supabase.from("partnership_messages").update({
    status: nextStatus,
    error: delivered.error || "send_failed",
    failed_at: exhausted ? new Date().toISOString() : null,
    send_after: sendAfter,
    updated_at: new Date().toISOString(),
  }).eq("id", id);

  if (exhausted && priority === "urgent") {
    await escalateUrgentFailure(supabase, {
      id,
      template_key: String(row.template_key),
      to_email: (row.to_email as string) || null,
      to_phone: (row.to_phone as string) || null,
      error: delivered.error || "send_failed",
      attempt_count: attempt,
    });
  }

  return {
    channel,
    status: nextStatus,
    reason: delivered.error || "send_failed",
    id,
    error: delivered.error,
  };
}

export async function sendPartnershipMessage(
  supabase: SB,
  input: PartnershipSendInput,
): Promise<PartnershipSendResult> {
  const email = validEmail(input.email);
  const phone = validPhone(input.phone);
  if (!email && !phone) {
    return { ok: false, emailed: false, texted: false, results: [] };
  }

  const settings = await loadPartnershipSettings(supabase);
  const template = await loadTemplate(supabase, input.templateKey);
  const role: PartnershipRole = input.role || template?.role || "partner";
  const priority: PartnershipPriority = input.priority || template?.priority || "standard";
  const templateChannels = (input.channels && input.channels.length
    ? input.channels
    : (template?.channels || ["email"])) as PartnershipChannel[];
  const channels: PartnershipChannel[] = templateChannels.filter((ch) => {
    if (ch === "email") return !!email && !!(input.html || template?.html);
    return !!phone && !!(input.sms || template?.sms_body);
  });
  // Honor an explicit HTML/SMS override even when the stored template is
  // missing a body (admin-composed proposal copy).
  if (email && input.html && !channels.includes("email") && (!input.channels || input.channels.includes("email"))) {
    channels.push("email");
  }
  if (phone && input.sms && !channels.includes("sms") && (!input.channels || input.channels.includes("sms"))) {
    channels.push("sms");
  }
  if (channels.length === 0) {
    return { ok: false, emailed: false, texted: false, results: [] };
  }

  const vars = {
    first_name: "",
    ...(input.vars || {}),
  };
  const subjectRendered = input.subject != null
    ? input.subject
    : substitutePartnershipTemplate(template?.subject, vars);
  const htmlRendered = withEmailFooter(
    input.html != null ? input.html : substitutePartnershipTemplate(template?.html, vars),
    role,
    null, // token filled per-row below
  );
  const smsRendered = input.sms != null
    ? input.sms
    : substitutePartnershipTemplate(template?.sms_body, vars);

  const maxAttempts = priority === "urgent"
    ? settings.urgent_max_attempts
    : settings.standard_max_attempts;
  const results: PartnershipChannelResult[] = [];

  for (const channel of channels) {
    const body = channel === "email" ? htmlRendered : smsRendered;
    if (!body.trim() && !(channel === "email" && input.attachments?.length)) continue;

    const idempotency = input.idempotencyKey
      ? `${input.idempotencyKey}:${channel}`
      : null;
    if (idempotency) {
      const { data: existing } = await supabase
        .from("partnership_messages")
        .select("id, status")
        .eq("idempotency_key", idempotency)
        .maybeSingle();
      if (existing?.id) {
        results.push({
          channel,
          status: existing.status as PartnershipMessageStatus,
          id: existing.id,
          reason: "idempotent",
        });
        continue;
      }
    }

    let decision = await policyCheck(supabase, { email, phone, channel, priority });
    // PDFs cannot live on the retry queue. A signature-triggered COI still
    // honors opt-out, but it is not held for quiet hours.
    if (decision.action === "queue" && input.attachments?.length) {
      decision = { ...decision, action: "send", reason: "attachments_cannot_queue" };
    }
    const unsubToken = mintToken();
    const htmlWithUnsub = channel === "email"
      ? withEmailFooter(
        input.html != null ? input.html : substitutePartnershipTemplate(template?.html, vars),
        role,
        unsubscribePageUrl(settings.partners_origin, unsubToken),
      )
      : body;

    const insert: Record<string, unknown> = {
      template_key: input.templateKey,
      template_version: template?.version ?? null,
      role,
      priority,
      channel,
      status: decision.action === "suppress" ? "suppressed" : decision.action === "queue" ? "queued" : "queued",
      trigger_source: input.trigger,
      recipient_key: decision.recipient_key || partnershipRecipientKey(email, phone) || "unknown",
      to_email: email,
      to_phone: phone,
      subject: channel === "email" ? subjectRendered : null,
      body: channel === "email" ? htmlWithUnsub : body,
      vars,
      max_attempts: maxAttempts,
      send_after: decision.send_after || new Date().toISOString(),
      idempotency_key: idempotency,
      unsubscribe_token: unsubToken,
      host_id: input.hostId || null,
      business_account_id: input.accountId || null,
      walkthrough_id: input.walkthroughId || null,
      error: decision.action === "suppress" ? decision.reason : null,
    };

    const { data: row, error } = await supabase
      .from("partnership_messages")
      .insert(insert)
      .select("*")
      .maybeSingle();

    if (error) {
      // Unique race on idempotency.
      if (idempotency && /duplicate|unique/i.test(error.message)) {
        results.push({ channel, status: "queued", reason: "idempotent" });
        continue;
      }
      console.warn("[partnership-comms] log insert failed", error.message);
      results.push({ channel, status: "failed", error: error.message, reason: "log_failed" });
      continue;
    }

    if (decision.action === "suppress") {
      results.push({
        channel,
        status: "suppressed",
        reason: decision.reason,
        id: row?.id,
      });
      continue;
    }
    if (decision.action === "queue") {
      results.push({
        channel,
        status: "queued",
        reason: decision.reason,
        id: row?.id,
      });
      continue;
    }

    const delivered = await deliverPartnershipRow(
      supabase,
      row as Record<string, unknown>,
      settings,
      { attachments: input.attachments },
    );
    results.push(delivered);
  }

  const emailed = results.some((r) => r.channel === "email" && (r.status === "sent" || r.status === "queued" || r.status === "retry"));
  const texted = results.some((r) => r.channel === "sms" && (r.status === "sent" || r.status === "queued" || r.status === "retry"));
  const ok = results.some((r) => r.status === "sent" || r.status === "queued" || r.status === "retry");
  return { ok, emailed, texted, results };
}

/** Drain due queued/retry rows. Used by the Next cron fallback and tests. */
export async function drainPartnershipQueue(
  supabase: SB,
  limit = 40,
): Promise<{ processed: number; sent: number; failed: number; escalated: number }> {
  const settings = await loadPartnershipSettings(supabase);
  const { data: rows } = await supabase
    .from("partnership_messages")
    .select("*")
    .in("status", ["queued", "retry"])
    .lte("send_after", new Date().toISOString())
    .order("send_after", { ascending: true })
    .limit(limit);
  let sent = 0, failed = 0, escalated = 0;
  for (const row of rows || []) {
    const out = await deliverPartnershipRow(supabase, row as Record<string, unknown>, settings);
    if (out.status === "sent") sent++;
    if (out.status === "failed") {
      failed++;
      if ((row as { priority?: string }).priority === "urgent") escalated++;
    }
  }
  return { processed: (rows || []).length, sent, failed, escalated };
}

/**
 * Passwordless portal magic link. The Partner Portal PR can call this
 * instead of talking to Resend/GHL directly.
 */
export async function sendPortalMagicLink(
  supabase: SB,
  input: {
    email: string;
    phone?: string | null;
    firstName?: string | null;
    link: string;
    expiresMinutes?: number;
    hostId?: string | null;
    accountId?: string | null;
  },
): Promise<PartnershipSendResult> {
  const minutes = input.expiresMinutes ?? 15;
  return sendPartnershipMessage(supabase, {
    templateKey: "portal_magic_link",
    trigger: "partner-portal.magic_link",
    email: input.email,
    phone: input.phone,
    hostId: input.hostId,
    accountId: input.accountId,
    priority: "urgent",
    vars: {
      first_name: (input.firstName || "there").split(" ")[0],
      link: input.link,
      expires_minutes: String(minutes),
    },
  });
}

export async function recordPartnershipOptOut(
  supabase: SB,
  args: {
    email?: string | null;
    phone?: string | null;
    channel: PartnershipChannel;
    source?: string;
  },
): Promise<void> {
  const email = args.email ? String(args.email).trim().toLowerCase() : null;
  const digits = args.phone ? String(args.phone).replace(/\D/g, "") : null;
  if (!email && !digits) return;
  let exists = supabase.from("partnership_opt_outs").select("id").eq("channel", args.channel).is("revoked_at", null);
  if (args.channel === "email" && email) exists = exists.eq("email", email);
  if (args.channel === "sms" && digits) exists = exists.eq("phone_digits", digits);
  const { data: row } = await exists.limit(1).maybeSingle();
  if (row?.id) return;
  await supabase.from("partnership_opt_outs").insert({
    email: args.channel === "email" ? email : email,
    phone_digits: digits || null,
    channel: args.channel,
    source: args.source || "recipient",
  });
}

export async function revokePartnershipOptOut(
  supabase: SB,
  args: { email?: string | null; phone?: string | null; channel: PartnershipChannel },
): Promise<void> {
  const email = args.email ? String(args.email).trim().toLowerCase() : null;
  const digits = args.phone ? String(args.phone).replace(/\D/g, "") : null;
  let q = supabase.from("partnership_opt_outs").update({ revoked_at: new Date().toISOString() }).eq("channel", args.channel).is("revoked_at", null);
  if (args.channel === "email" && email) q = q.eq("email", email);
  if (args.channel === "sms" && digits) q = q.eq("phone_digits", digits);
  await q;
}

export { DEFAULT_PARTNERSHIP_COMMS_SETTINGS };

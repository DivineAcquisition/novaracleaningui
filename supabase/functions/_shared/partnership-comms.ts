// Partnership communications layer for Edge Functions.
// Policy lives in SQL (`partnership_comms_check`). Delivery reuses Resend
// (admin-send-email) and GHL (send-ghl-sms). Do not add a third vendor.

import { substitutePartnershipTemplate } from "./partnership-comms-substitute.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export type PartnershipRole = "partner" | "walkthrough_agent" | "admin";
export type PartnershipPriority = "urgent" | "standard" | "routine";
export type PartnershipChannel = "email" | "sms";

export interface PartnershipSendInput {
  templateKey: string;
  trigger: string;
  email?: string | null;
  phone?: string | null;
  vars?: Record<string, string | number | null | undefined>;
  channels?: PartnershipChannel[];
  subject?: string | null;
  html?: string | null;
  sms?: string | null;
  attachments?: Array<{ filename: string; content: string }>;
  idempotencyKey?: string;
  hostId?: string | null;
  accountId?: string | null;
  walkthroughId?: string | null;
  priority?: PartnershipPriority;
  role?: PartnershipRole;
}

export interface PartnershipChannelResult {
  channel: PartnershipChannel;
  status: string;
  reason?: string;
  id?: string;
  error?: string;
}

const DEFAULT_SETTINGS = {
  timezone: "America/New_York",
  quiet_hours_start: "21:00",
  quiet_hours_end: "08:00",
  frequency_cap_count: 3,
  frequency_cap_hours: 4,
  standard_max_attempts: 3,
  urgent_max_attempts: 5,
  partners_origin: "https://partner.novaracleaning.com",
  senders: {
    partner: { from: "Novara Cleaning <hello@novaracleaning.com>", reply_to: "support@novaracleaning.com" },
    walkthrough_agent: { from: "Novara Ops <ops@novaracleaning.com>", reply_to: "ops@novaracleaning.com" },
    admin: { from: "Novara Cleaning <ops@novaracleaning.com>", reply_to: "ops@novaracleaning.com" },
  },
};

function mintToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function validEmail(value?: string | null): string | null {
  const v = String(value || "").trim();
  return /.+@.+\..+/.test(v) ? v : null;
}
function validPhone(value?: string | null): string | null {
  return String(value || "").replace(/\D/g, "").length >= 10 ? String(value || "").trim() : null;
}

function recipientKey(email?: string | null, phone?: string | null): string {
  const em = String(email || "").trim().toLowerCase();
  if (em) return em;
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `tel:${digits}` : "unknown";
}

function backoffMs(attempt: number, priority: string): number {
  if (priority === "urgent") return [30_000, 60_000, 120_000, 300_000, 600_000][Math.max(0, attempt)] ?? 600_000;
  return [60_000, 300_000, 900_000, 3_600_000][Math.max(0, attempt)] ?? 3_600_000;
}

async function loadSettings(admin: SB) {
  const { data } = await admin.from("app_settings").select("value")
    .eq("key", "partnership_comms_settings").maybeSingle();
  const v = (data?.value || {}) as Record<string, unknown>;
  return {
    ...DEFAULT_SETTINGS,
    ...v,
    senders: {
      ...DEFAULT_SETTINGS.senders,
      ...((v.senders && typeof v.senders === "object") ? v.senders as typeof DEFAULT_SETTINGS.senders : {}),
    },
  };
}

function withFooter(html: string, role: string, unsub: string | null): string {
  if (role !== "partner" || !unsub || /unsubscribe/i.test(html)) return html;
  return `${html}<p style="margin-top:28px;font-size:12px;line-height:1.5;color:#64748b">This is a transactional notice about your Novara account. <a href="${unsub}">Unsubscribe from partnership emails</a>.</p>`;
}

export async function recordPartnershipOptOut(
  admin: SB,
  args: { email?: string | null; phone?: string | null; channel: PartnershipChannel; source?: string },
): Promise<void> {
  const email = args.email ? String(args.email).trim().toLowerCase() : null;
  const digits = args.phone ? String(args.phone).replace(/\D/g, "") : null;
  if (!email && !digits) return;
  let exists = admin.from("partnership_opt_outs").select("id").eq("channel", args.channel).is("revoked_at", null);
  if (args.channel === "email" && email) exists = exists.ilike("email", email);
  if (args.channel === "sms" && digits) exists = exists.eq("phone_digits", digits);
  const { data: row } = await exists.limit(1).maybeSingle();
  if (row?.id) return;
  await admin.from("partnership_opt_outs").insert({
    email,
    phone_digits: digits || null,
    channel: args.channel,
    source: args.source || "recipient",
  });
}

export async function revokePartnershipOptOut(
  admin: SB,
  args: { email?: string | null; phone?: string | null; channel: PartnershipChannel },
): Promise<void> {
  const email = args.email ? String(args.email).trim().toLowerCase() : null;
  const digits = args.phone ? String(args.phone).replace(/\D/g, "") : null;
  let q = admin.from("partnership_opt_outs").update({ revoked_at: new Date().toISOString() })
    .eq("channel", args.channel).is("revoked_at", null);
  if (args.channel === "email" && email) q = q.ilike("email", email);
  if (args.channel === "sms" && digits) q = q.eq("phone_digits", digits);
  await q;
}

async function escalate(admin: SB, row: Record<string, unknown>, error: string, attempts: number) {
  await admin.from("partnership_messages").update({
    escalated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);
  await admin.from("events").insert({
    event_type: "partnership_comms.urgent_failed",
    source: "partnership-comms",
    summary:
      `Urgent partnership ${row.template_key} failed after ${attempts} attempt(s) ` +
      `to ${row.to_email || row.to_phone || "unknown"}: ${error}`,
    data: {
      message_id: row.id,
      template_key: row.template_key,
      to_email: row.to_email,
      to_phone: row.to_phone,
      error,
    },
  });
}

export async function deliverPartnershipRow(
  admin: SB,
  row: Record<string, unknown>,
  extras?: { attachments?: Array<{ filename: string; content: string }> },
): Promise<PartnershipChannelResult> {
  const settings = await loadSettings(admin);
  const channel = row.channel as PartnershipChannel;
  const priority = String(row.priority || "standard");
  const maxAttempts = Number(row.max_attempts) || (priority === "urgent" ? settings.urgent_max_attempts : settings.standard_max_attempts);
  const attempt = Number(row.attempt_count || 0) + 1;
  const sender = (settings.senders as Record<string, { from: string; reply_to: string }>)[String(row.role)]
    || settings.senders.partner;
  const origin = String(settings.partners_origin || DEFAULT_SETTINGS.partners_origin)
    .replace(/\/+$/, "")
    .replace(/^(https?:\/\/)partners\.novaracleaning\.com/i, "$1partner.novaracleaning.com");
  const unsubHeader = row.role === "partner" && row.unsubscribe_token
    ? `${origin}/api/partnership-comms/unsubscribe?t=${encodeURIComponent(String(row.unsubscribe_token))}`
    : null;

  await admin.from("partnership_messages").update({
    status: "sending",
    attempt_count: attempt,
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);

  let ok = false;
  let suppressed = false;
  let providerId: string | undefined;
  let err: string | undefined;

  try {
    if (channel === "email") {
      const { data, error } = await admin.functions.invoke("admin-send-email", {
        body: {
          to: row.to_email,
          subject: row.subject,
          html: row.body,
          from: sender.from,
          replyTo: sender.reply_to,
          headers: unsubHeader
            ? { "List-Unsubscribe": `<${unsubHeader}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
            : undefined,
          idempotencyKey: row.idempotency_key || row.id,
          attachments: extras?.attachments,
        },
      });
      if (error) err = error.message;
      else {
        ok = true;
        providerId = (data as { id?: string } | null)?.id;
      }
    } else {
      const { data, error } = await admin.functions.invoke("send-ghl-sms", {
        body: {
          phone: row.to_phone,
          email: row.to_email || undefined,
          message: row.body,
          type: "confirmation",
        },
      });
      if ((data as { suppressed?: boolean } | null)?.suppressed) {
        ok = true;
        suppressed = true;
      } else if (error || (data as { error?: string } | null)?.error) {
        err = error?.message || String((data as { error?: string })?.error);
      } else {
        ok = true;
        providerId = (data as { messageId?: string; id?: string } | null)?.messageId
          || (data as { id?: string } | null)?.id;
      }
    }
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }

  if (suppressed) {
    await admin.from("partnership_messages").update({
      status: "suppressed",
      error: "provider_unsubscribed",
      provider: channel === "sms" ? "ghl" : "resend",
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    await recordPartnershipOptOut(admin, {
      email: (row.to_email as string) || null,
      phone: (row.to_phone as string) || null,
      channel,
      source: "provider_unsubscribed",
    });
    return { channel, status: "suppressed", reason: "provider_unsubscribed", id: String(row.id) };
  }

  if (ok) {
    await admin.from("partnership_messages").update({
      status: "sent",
      sent_at: new Date().toISOString(),
      provider: channel === "sms" ? "ghl" : "resend",
      provider_id: providerId || null,
      error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    return { channel, status: "sent", id: String(row.id) };
  }

  const exhausted = attempt >= Number(maxAttempts);
  const next = exhausted ? "failed" : "retry";
  await admin.from("partnership_messages").update({
    status: next,
    error: err || "send_failed",
    failed_at: exhausted ? new Date().toISOString() : null,
    send_after: exhausted
      ? new Date().toISOString()
      : new Date(Date.now() + backoffMs(attempt, priority)).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);
  if (exhausted && priority === "urgent") {
    await escalate(admin, row, err || "send_failed", attempt);
  }
  return { channel, status: next, reason: err, id: String(row.id), error: err };
}

export async function sendPartnership(admin: SB, input: PartnershipSendInput): Promise<{
  ok: boolean;
  emailed: boolean;
  texted: boolean;
  results: PartnershipChannelResult[];
}> {
  const email = validEmail(input.email);
  const phone = validPhone(input.phone);
  if (!email && !phone) return { ok: false, emailed: false, texted: false, results: [] };

  const { data: template } = await admin.from("partnership_message_templates")
    .select("*").eq("key", input.templateKey).eq("is_current", true).maybeSingle();
  const role: PartnershipRole = input.role || template?.role || "partner";
  const priority: PartnershipPriority = input.priority || template?.priority || "standard";
  const settings = await loadSettings(admin);
  const requested = (input.channels && input.channels.length
    ? input.channels
    : (template?.channels || ["email"])) as PartnershipChannel[];
  const channels = requested.filter((ch) => {
    if (ch === "email") return !!email && !!(input.html || template?.html);
    return !!phone && !!(input.sms || template?.sms_body);
  });
  if (email && input.html && !channels.includes("email") && (!input.channels || input.channels.includes("email"))) {
    channels.push("email");
  }
  if (phone && input.sms && !channels.includes("sms") && (!input.channels || input.channels.includes("sms"))) {
    channels.push("sms");
  }

  const results: PartnershipChannelResult[] = [];
  for (const channel of channels) {
    const rawBody = channel === "email"
      ? (input.html != null ? input.html : substitutePartnershipTemplate(template?.html, input.vars))
      : (input.sms != null ? input.sms : substitutePartnershipTemplate(template?.sms_body, input.vars));
    if (!String(rawBody || "").trim()) continue;

    const idempotency = input.idempotencyKey ? `${input.idempotencyKey}:${channel}` : null;
    if (idempotency) {
      const { data: existing } = await admin.from("partnership_messages")
        .select("id, status").eq("idempotency_key", idempotency).maybeSingle();
      if (existing?.id) {
        results.push({ channel, status: existing.status, id: existing.id, reason: "idempotent" });
        continue;
      }
    }

    const { data: decisionRaw, error: rpcErr } = await admin.rpc("partnership_comms_check", {
      p_email: email,
      p_phone: phone,
      p_channel: channel,
      p_priority: priority,
    });
    let action = rpcErr ? "send" : String(decisionRaw?.action || "send");
    const reason = rpcErr ? "rpc_unavailable" : String(decisionRaw?.reason || "ok");
    if (action === "queue" && input.attachments?.length) action = "send";
    const unsubToken = mintToken();
    const origin = String(settings.partners_origin || DEFAULT_SETTINGS.partners_origin)
      .replace(/\/+$/, "")
      .replace(/^(https?:\/\/)partners\.novaracleaning\.com/i, "$1partner.novaracleaning.com");
    const unsub = `${origin}/partner/unsubscribe?t=${encodeURIComponent(unsubToken)}`;
    const body = channel === "email" ? withFooter(String(rawBody), role, unsub) : String(rawBody);
    const subject = channel === "email"
      ? (input.subject != null ? input.subject : substitutePartnershipTemplate(template?.subject, input.vars))
      : null;

    const insert = {
      template_key: input.templateKey,
      template_version: template?.version ?? null,
      role,
      priority,
      channel,
      status: action === "suppress" ? "suppressed" : "queued",
      trigger_source: input.trigger,
      recipient_key: decisionRaw?.recipient_key || recipientKey(email, phone),
      to_email: email,
      to_phone: phone,
      subject,
      body,
      vars: input.vars || {},
      max_attempts: priority === "urgent" ? settings.urgent_max_attempts : settings.standard_max_attempts,
      send_after: decisionRaw?.send_after || new Date().toISOString(),
      idempotency_key: idempotency,
      unsubscribe_token: unsubToken,
      host_id: input.hostId || null,
      business_account_id: input.accountId || null,
      walkthrough_id: input.walkthroughId || null,
      error: action === "suppress" ? reason : null,
    };
    const { data: row, error } = await admin.from("partnership_messages").insert(insert).select("*").maybeSingle();
    if (error) {
      results.push({ channel, status: "failed", error: error.message, reason: "log_failed" });
      continue;
    }
    if (action === "suppress") {
      results.push({ channel, status: "suppressed", reason, id: row?.id });
      continue;
    }
    if (action === "queue") {
      results.push({ channel, status: "queued", reason, id: row?.id });
      continue;
    }
    results.push(await deliverPartnershipRow(admin, row, { attachments: input.attachments }));
  }

  const emailed = results.some((r) => r.channel === "email" && ["sent", "queued", "retry"].includes(r.status));
  const texted = results.some((r) => r.channel === "sms" && ["sent", "queued", "retry"].includes(r.status));
  return { ok: results.some((r) => ["sent", "queued", "retry"].includes(r.status)), emailed, texted, results };
}

const HOST_TEMPLATE: Record<string, string> = {
  application_received: "host_application_received",
  welcome: "host_agreement_signed",
  agreement_sent: "host_onboarding_link",
  agreement_signed: "host_agreement_signed",
  payment_link: "host_payment_link",
  turnover_confirmed: "host_turnover_confirmed",
  turnover_assigned: "host_turnover_assigned",
  turnover_cleaner_confirmed: "host_turnover_assigned",
  turnover_in_progress: "host_turnover_assigned",
  turnover_completed: "host_turnover_completed",
  turnover_cancelled: "host_turnover_cancelled",
  turnover_rescheduled: "host_turnover_rescheduled",
};

/** Host lifecycle adapter. Replaces send-partner-email + host SMS pairs. Never used for cleaner-facing traffic. */
export async function sendHostPartnership(
  admin: SB,
  type: string,
  email: string | null | undefined,
  phone: string | null | undefined,
  data: Record<string, unknown>,
  extras?: {
    hostId?: string | null;
    trigger?: string;
    channels?: PartnershipChannel[];
    sms?: string | null;
    html?: string | null;
    subject?: string | null;
  },
): Promise<void> {
  const templateKey = HOST_TEMPLATE[type];
  if (!templateKey) {
    console.warn("[partnership-comms] unknown host type", type);
    return;
  }
  const name = String(data.name || "there");
  const link = String(data.agreementUrl || data.checkoutUrl || data.galleryUrl || data.link || "https://partner.novaracleaning.com/partner");
  const rate = String(data.rateSummary || "");
  const smsOverride = extras?.sms ?? (typeof data.smsOverride === "string" ? String(data.smsOverride) : null);
  await sendPartnership(admin, {
    templateKey,
    trigger: extras?.trigger || `partner-turnover.${type}`,
    email,
    phone,
    hostId: extras?.hostId,
    channels: extras?.channels,
    sms: smsOverride,
    html: extras?.html,
    subject: extras?.subject,
    vars: {
      first_name: name.split(" ")[0] || name,
      property: String(data.property || ""),
      address: String(data.address || data.property || ""),
      date: String(data.date || ""),
      window: String(data.window || ""),
      price: String(data.price || ""),
      link,
      fee_html: data.fee_html != null ? String(data.fee_html) : "",
      fee_sms: data.fee_sms != null ? String(data.fee_sms) : "",
      rate_summary_html: rate
        ? `<p style="background:#EDE9FE;border-radius:8px;padding:12px 14px;"><strong>Your rate schedule:</strong><br/>${rate.replace(/</g, "&lt;")}</p>`
        : "",
    },
  });
}

export async function drainPartnershipQueue(admin: SB, limit = 40): Promise<{ processed: number; sent: number; failed: number }> {
  const { data: rows } = await admin.from("partnership_messages")
    .select("*")
    .in("status", ["queued", "retry"])
    .lte("send_after", new Date().toISOString())
    .order("send_after", { ascending: true })
    .limit(limit);
  let sent = 0, failed = 0;
  for (const row of rows || []) {
    const out = await deliverPartnershipRow(admin, row);
    if (out.status === "sent") sent++;
    if (out.status === "failed") failed++;
  }
  return { processed: (rows || []).length, sent, failed };
}

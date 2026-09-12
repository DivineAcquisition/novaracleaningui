// Inbound mailbox ack policy.
//
// Auto-replies for disputes, customer inquiries, and complaints — and
// ONLY when the receiving address is support@ or billing@. Mail to
// contact@, hello@, personal inboxes, or anything else is a no-op.
//
// The reply is deliberately short: we received the request, and we
// informed Billing, Dispatch, or Operations. Nothing else.

export const ALLOWED_MAILBOXES = [
  "support@novaracleaning.com",
  "billing@novaracleaning.com",
] as const;

export const SEND_AS = "NovaraCleaning <hello@novaracleaning.com>";
export const SIGNATURE = "NovaraCleaning";
export const BLOCKED_CC = "maliksannie7@gmail.com";

export type MailboxParty = "Billing" | "Dispatch" | "Operations";
export type MailboxKind = "dispute" | "inquiry" | "complaint";

export type InboundMail = {
  messageId?: string | null;
  from?: string | null;
  to?: string | string[] | null;
  cc?: string | string[] | null;
  bcc?: string | string[] | null;
  deliveredTo?: string | string[] | null;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
};

export type MailboxAckDecision =
  | {
      action: "skip";
      reason: string;
    }
  | {
      action: "send";
      kind: MailboxKind;
      party: MailboxParty;
      mailbox: (typeof ALLOWED_MAILBOXES)[number];
      to: string;
      replyTo: (typeof ALLOWED_MAILBOXES)[number];
      subject: string;
      text: string;
      html: string;
      firstName: string;
    };

const COMPANY_DOMAINS = [
  "novaracleaning.com",
  "notify.novaracleaning.com",
  "mail.novaracleaning.com",
];

const SKIP_LOCAL_PARTS = [
  "noreply",
  "no-reply",
  "no_reply",
  "mailer-daemon",
  "postmaster",
  "bounce",
  "bounces",
  "notifications",
  "notification",
  "calendar-notification",
  "donotreply",
  "do-not-reply",
];

const DISPUTE_RE =
  /\b(dispute|chargeback|unauthorized|double.?charg|billed twice|overcharg|wrong charg|didn't authorize|did not authorize)\b/i;
const COMPLAINT_RE =
  /\b(complaint|incident|injured|injury|unprofessional|dirty|trashed|horrible|terrible|awful|poor (service|quality)|messed|never again|do better|allegation)\b/i;
const DISPATCH_RE =
  /\b(cancel|reschedule|don'?t come|do not come|not to come|running late|no.?show|cleaner (was|is|coming)|arrival|schedule|this month'?s service|further service)\b/i;
const BILLING_RE =
  /\b(refund|invoice|charge|payment|billing|bill|card|receipt|deposit|balance|charged)\b/i;

export function extractEmailAddresses(value: unknown): string[] {
  const chunks: string[] = [];
  const walk = (v: unknown) => {
    if (v == null) return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    if (typeof v === "object") {
      const rec = v as Record<string, unknown>;
      walk(rec.email ?? rec.address ?? rec.value ?? rec.raw);
      return;
    }
    if (typeof v === "string") chunks.push(v);
  };
  walk(value);

  const found: string[] = [];
  const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  for (const chunk of chunks) {
    const matches = chunk.toLowerCase().match(re) || [];
    for (const m of matches) found.push(m);
  }
  return [...new Set(found)];
}

export function matchedAllowedMailbox(mail: InboundMail): (typeof ALLOWED_MAILBOXES)[number] | null {
  const recipients = [
    ...extractEmailAddresses(mail.to),
    ...extractEmailAddresses(mail.cc),
    ...extractEmailAddresses(mail.deliveredTo),
  ];
  for (const allowed of ALLOWED_MAILBOXES) {
    if (recipients.includes(allowed)) return allowed;
  }
  return null;
}

export function primaryFromAddress(from: string | null | undefined): string | null {
  const emails = extractEmailAddresses(from);
  return emails[0] ?? null;
}

export function firstNameFrom(from: string | null | undefined, body: string): string {
  const raw = String(from || "").trim();
  const display = raw.includes("<") ? raw.slice(0, raw.indexOf("<")).trim().replace(/^"|"$/g, "") : "";
  const first = display.split(/\s+/).filter(Boolean)[0];
  if (first && /^[A-Za-z][A-Za-z'.-]{0,30}$/.test(first) && !first.includes("@")) {
    return first.charAt(0).toUpperCase() + first.slice(1);
  }
  const greeting = body.match(/^(?:hi|hello|hey|dear)\s+([A-Za-z][A-Za-z'.-]{0,30})\b/i);
  if (greeting?.[1]) {
    const g = greeting[1];
    return g.charAt(0).toUpperCase() + g.slice(1).toLowerCase();
  }
  return "there";
}

function domainOf(email: string): string {
  return email.split("@")[1] || "";
}

function localPartOf(email: string): string {
  return email.split("@")[0] || "";
}

export function isLoopSender(fromEmail: string | null): boolean {
  if (!fromEmail) return true;
  const domain = domainOf(fromEmail);
  return COMPANY_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export function isAutomatedSender(fromEmail: string | null): boolean {
  if (!fromEmail) return true;
  const local = localPartOf(fromEmail);
  if (SKIP_LOCAL_PARTS.includes(local)) return true;
  if (local.includes("noreply") || local.includes("no-reply")) return true;
  if (fromEmail === BLOCKED_CC) return true;
  return false;
}

export function classifyKind(subject: string, body: string): MailboxKind {
  const hay = `${subject}\n${body}`;
  if (DISPUTE_RE.test(hay)) return "dispute";
  if (COMPLAINT_RE.test(hay)) return "complaint";
  return "inquiry";
}

export function classifyParty(
  mailbox: (typeof ALLOWED_MAILBOXES)[number],
  kind: MailboxKind,
  subject: string,
  body: string,
): MailboxParty {
  if (mailbox === "billing@novaracleaning.com") return "Billing";
  const hay = `${subject}\n${body}`;
  if (BILLING_RE.test(hay) || kind === "dispute") return "Billing";
  if (DISPATCH_RE.test(hay)) return "Dispatch";
  return "Operations";
}

function topicFor(kind: MailboxKind, party: MailboxParty, subject: string, body: string): string {
  const hay = `${subject}\n${body}`.toLowerCase();
  if (/\bcancel/.test(hay)) return " to cancel service";
  if (/\brefund/.test(hay)) return " about the refund";
  if (/\binvoice|\bbill|\bcharg/.test(hay)) return " about billing";
  if (/\bincident|\binjur/.test(hay)) return " regarding the service";
  if (kind === "complaint") return " regarding the service";
  if (party === "Dispatch") return " about scheduling";
  return "";
}

export function composeAck(opts: {
  firstName: string;
  kind: MailboxKind;
  party: MailboxParty;
  subject: string;
  body: string;
}): { text: string; html: string; subject: string } {
  const topic = topicFor(opts.kind, opts.party, opts.subject, opts.body);
  const name = opts.firstName === "there" ? "Hello" : opts.firstName;
  const greeting = name === "Hello" ? "Hello," : `${name},`;
  const text =
    `${greeting}\n\n` +
    `We received your request${topic} and have informed ${opts.party}.\n\n` +
    `${SIGNATURE}`;
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111827">` +
    `<p>${escapeHtml(greeting)}</p>` +
    `<p>We received your request${escapeHtml(topic)} and have informed ${opts.party}.</p>` +
    `<p>${SIGNATURE}</p>` +
    `</div>`;
  const subject = replySubject(opts.subject);
  return { text, html, subject };
}

export function replySubject(subject: string | null | undefined): string {
  const s = String(subject || "your request").replace(/\s+/g, " ").trim() || "your request";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function decideMailboxAck(mail: InboundMail): MailboxAckDecision {
  const mailbox = matchedAllowedMailbox(mail);
  if (!mailbox) {
    return { action: "skip", reason: "not_allowed_mailbox" };
  }

  const fromEmail = primaryFromAddress(mail.from);
  if (!fromEmail) {
    return { action: "skip", reason: "missing_from" };
  }
  if (isLoopSender(fromEmail)) {
    return { action: "skip", reason: "company_loop" };
  }
  if (isAutomatedSender(fromEmail)) {
    return { action: "skip", reason: "automated_sender" };
  }
  if (fromEmail === BLOCKED_CC) {
    return { action: "skip", reason: "blocked_address" };
  }

  const body = String(mail.text || stripHtml(mail.html || "")).trim();
  const subject = String(mail.subject || "").trim();
  const kind = classifyKind(subject, body);
  const party = classifyParty(mailbox, kind, subject, body);
  const firstName = firstNameFrom(mail.from, body);
  const composed = composeAck({ firstName, kind, party, subject, body });

  return {
    action: "send",
    kind,
    party,
    mailbox,
    to: fromEmail,
    replyTo: mailbox,
    subject: composed.subject,
    text: composed.text,
    html: composed.html,
    firstName,
  };
}

export function parseResendReceivedEvent(payload: unknown): InboundMail | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const data = (root.data && typeof root.data === "object" ? root.data : root) as Record<string, unknown>;
  const email = (data.email && typeof data.email === "object" ? data.email : data) as Record<string, unknown>;

  const from = (email.from ?? data.from ?? root.from) as string | undefined;
  const to = (email.to ?? data.to ?? root.to) as string | string[] | undefined;
  if (!from && !to) return null;

  return {
    messageId: String(email.email_id ?? data.email_id ?? email.message_id ?? data.messageId ?? root.id ?? ""),
    from,
    to,
    cc: (email.cc ?? data.cc ?? root.cc) as string | string[] | undefined,
    bcc: (email.bcc ?? data.bcc ?? root.bcc) as string | string[] | undefined,
    deliveredTo: (email.headers as Record<string, unknown> | undefined)?.["delivered-to"] as string | undefined,
    subject: (email.subject ?? data.subject ?? root.subject) as string | undefined,
    text: (email.text ?? data.text ?? root.text) as string | undefined,
    html: (email.html ?? data.html ?? root.html) as string | undefined,
  };
}

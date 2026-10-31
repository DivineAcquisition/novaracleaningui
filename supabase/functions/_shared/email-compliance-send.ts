// Edge-function sender. Same rules as src/lib/email-compliance/deliver.ts.
// The engine file is the copy of src/lib/email-compliance/engine.ts.

import {
  evaluateEmail,
  mergeBusinessIdentity,
  normalizeEmail,
  toDeliveryRecord,
  IDENTITY_SETTING_KEY,
  CLAIMS_SETTING_KEY,
  type ApprovedClaim,
  type BusinessIdentity,
  type ConsentRecord,
  type PrepareInput,
} from "./email-compliance.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type SB = { from: (table: string) => any };

function token(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function loadIdentity(supabase: SB): Promise<BusinessIdentity> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", IDENTITY_SETTING_KEY).maybeSingle();
  return mergeBusinessIdentity(data?.value);
}

async function loadClaims(supabase: SB): Promise<ApprovedClaim[]> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", CLAIMS_SETTING_KEY).maybeSingle();
  const rows = Array.isArray(data?.value) ? data.value : [];
  return rows.map((row: ApprovedClaim) => ({
    id: String(row?.id || ""),
    phrase: String(row?.phrase || ""),
    basis: String(row?.basis || ""),
    conditional: Boolean(row?.conditional),
    requiredWording: String(row?.requiredWording || ""),
    active: Boolean(row?.active),
  })).filter((row: ApprovedClaim) => row.id && row.phrase);
}

async function loadConsent(supabase: SB, email: string): Promise<ConsentRecord | null> {
  const { data } = await supabase.from("email_marketing_contacts").select("*").eq("email", email).maybeSingle();
  if (!data) return null;
  return {
    status: data.status,
    source: data.source || "unknown",
    sourceNote: data.source_note || "",
    consentBasis: data.consent_basis || "",
    categories: data.categories || null,
    at: data.consented_at || data.unsubscribed_at || data.updated_at || null,
  };
}

async function suppressed(supabase: SB, email: string): Promise<{ suppressed: boolean; reason: string }> {
  const { data } = await supabase.from("email_suppression").select("reason").eq("email", email).is("revoked_at", null).maybeSingle();
  if (!data) return { suppressed: false, reason: "" };
  return { suppressed: true, reason: String(data.reason || "unsubscribe") };
}

async function ensureToken(supabase: SB, email: string): Promise<string> {
  const { data } = await supabase.from("email_preference_tokens").select("token").eq("email", email).maybeSingle();
  if (data?.token) return String(data.token);
  const value = token();
  await supabase.from("email_preference_tokens").insert({ token: value, email });
  return value;
}

/** Every contractor email is copied here so the team can see what contractors are sent. */
export const CONTRACTOR_COMMS_CC = "contact@novaracleaning.com";

export function contractorCopy(type: string, to: string, cc?: string[]): string[] | undefined {
  const isContractor = type === "contractor_operational" || type === "contractor_tax";
  const list = (cc || []).map((a) => String(a || "").trim()).filter(Boolean);
  if (!isContractor) return list.length ? list : undefined;
  const lower = new Set([to.toLowerCase(), ...list.map((a) => a.toLowerCase())]);
  if (!lower.has(CONTRACTOR_COMMS_CC)) list.push(CONTRACTOR_COMMS_CC);
  return list;
}

export interface EdgeDeliverInput extends Omit<PrepareInput, "identity" | "claims" | "consent" | "suppressed" | "unsubscribeUrl" | "preferencesUrl" | "oneClickUrl" | "taxElectronicConsentAt"> {
  to: string;
  cc?: string[];
  attachments?: Array<{ filename: string; content: string }>;
  idempotencyKey?: string;
  bookingId?: string | null;
  apiKey: string;
}

export async function deliverCompliantEmail(supabase: SB, input: EdgeDeliverInput): Promise<{
  ok: boolean;
  blocked: boolean;
  id: string;
  error: string;
  warnings: string[];
  type: string;
}> {
  const to = normalizeEmail(input.to);
  const identity = await loadIdentity(supabase);
  const claims = await loadClaims(supabase);
  const consent = await loadConsent(supabase, to);
  const block = await suppressed(supabase, to);
  let taxAt: string | null = null;
  if (input.declaredType === "contractor_tax" || input.templateKey === "contractor_tax") {
    const { data } = await supabase.from("email_tax_e_consent").select("consented_at, withdrawn_at").eq("email", to).maybeSingle();
    if (data?.consented_at && !data.withdrawn_at) taxAt = String(data.consented_at);
  }
  const preferenceToken = await ensureToken(supabase, to);
  const origin = identity.publicOrigin.replace(/\/+$/, "");
  const encoded = encodeURIComponent(preferenceToken);
  const result = evaluateEmail({
    ...input,
    identity,
    claims,
    consent,
    suppressed: block.suppressed,
    suppressionReason: block.reason,
    unsubscribeUrl: `${origin}/email/unsubscribe?t=${encoded}`,
    preferencesUrl: `${origin}/email/preferences?t=${encoded}`,
    oneClickUrl: `${origin}/api/email/unsubscribe?t=${encoded}`,
    taxElectronicConsentAt: taxAt,
  });
  const record = toDeliveryRecord(result, { to, templateKey: input.templateKey, testSend: input.testSend });
  const log = async (status: string, providerId = "", reasons: string[] = []) => {
    try {
    const { data } = await supabase.from("email_delivery_log").insert({
      contact_email: record.contactEmail,
      email_type: record.emailType,
      template_key: record.templateKey,
      sender: record.sender,
      reply_to: record.replyTo,
      recipient: record.recipient,
      subject: record.subject,
      html: record.html,
      text_body: record.text,
      footer_version: record.footerVersion,
      footer_html: record.footerHtml,
      stream: record.stream,
      provider: "resend",
      provider_id: providerId || null,
      sent_at: record.sentAt,
      test_send: record.testSend,
      booking_id: input.bookingId || null,
      status,
      block_reasons: reasons,
    }).select("id").maybeSingle();
    if (status === "sent" || status === "test") {
      await supabase.from("email_footer_versions").select("version_key").eq("version_key", result.footer.versionKey).maybeSingle()
        .then(async (existing: { data?: { version_key?: string } }) => {
          if (existing?.data?.version_key) return;
          await supabase.from("email_footer_versions").insert({
            version_key: result.footer.versionKey,
            email_type: result.type,
            html: result.footer.html,
            dark_html: result.footer.darkHtml,
            text_body: result.footer.text,
            identity_snapshot: identity,
          });
        });
      if (!record.testSend) {
        await supabase.from("email_conversation_messages").insert({
          contact_email: record.contactEmail,
          direction: "outbound",
          mailbox: record.replyTo,
          subject: record.subject,
          body: record.text,
          email_type: record.emailType,
          delivery_log_id: data?.id || null,
        });
      }
    }
    } catch {
      /* Delivery still happened. The log insert is retried by the next send, not by failing this one. */
    }
  };

  if (result.decision === "block") {
    await log("blocked", "", result.blockReasons);
    return { ok: false, blocked: true, id: "", error: result.blockReasons[0] || "This email cannot be sent.", warnings: result.warnings, type: result.type };
  }

  const copy = contractorCopy(result.type, to, input.cc);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: result.from,
      to: [to],
      subject: result.subject,
      html: result.html,
      text: result.text,
      reply_to: result.replyTo,
      headers: result.headers,
      tags: [{ name: "stream", value: result.stream }, { name: "email_type", value: result.type }],
      ...(copy?.length ? { cc: copy } : {}),
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    await log("failed", "", [raw.slice(0, 300)]);
    return { ok: false, blocked: false, id: "", error: raw.slice(0, 300), warnings: result.warnings, type: result.type };
  }
  let id = "";
  try {
    id = String(JSON.parse(raw)?.id || "");
  } catch { /* resend id is optional */ }
  await log(input.testSend ? "test" : "sent", id);
  return { ok: true, blocked: false, id, error: "", warnings: result.warnings, type: result.type };
}

/** Apply the Novara card and type footer, then send. From and Reply-To follow the email type. */
export async function sendThroughCompliance(
  apiKey: string,
  input: {
    to: string | string[];
    subject: string;
    html: string;
    text?: string | null;
    templateKey?: string | null;
    declaredType?: string | null;
    cc?: string[];
    bookingId?: string | null;
    staffRecipient?: boolean;
    isReply?: boolean;
    personalFrom?: { displayName?: string; address?: string; replyTo?: string } | null;
  },
  supabase?: SB,
): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
  const db = supabase || createServiceDb();
  const recipients = (Array.isArray(input.to) ? input.to : [input.to])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (!recipients.length) return { data: null, error: { message: "Missing recipient." } };
  let lastId = "";
  let lastError = "";
  for (const to of recipients) {
    const outcome = await deliverCompliantEmail(db, {
      apiKey,
      to,
      cc: input.cc,
      subject: input.subject,
      html: input.html,
      text: input.text,
      templateKey: input.templateKey,
      declaredType: input.declaredType || "customer_service",
      bookingId: input.bookingId,
      staffRecipient: input.staffRecipient,
      isReply: input.isReply,
      personalFrom: input.personalFrom,
    });
    if (!outcome.ok) lastError = outcome.error;
    else lastId = outcome.id;
  }
  if (!lastId) return { data: null, error: { message: lastError || "This email cannot be sent." } };
  return { data: { id: lastId }, error: null };
}

function createServiceDb(): SB {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
}

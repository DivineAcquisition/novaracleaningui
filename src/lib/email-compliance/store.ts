// Persistence for identity, consent, suppression, footer versions, and the
// delivery log. Rules live in engine.ts. This file only reads and writes them.
// Service-role client. An admin cannot subscribe someone.

import { randomBytes } from "node:crypto";
import {
  applyConsentChange,
  type ApprovedClaim,
  type BusinessIdentity,
  type ConsentActor,
  type ConsentRecord,
  CLAIMS_SETTING_KEY,
  type DeliveryRecord,
  IDENTITY_SETTING_KEY,
  mergeBusinessIdentity,
  normalizeEmail,
  type PrepareResult,
} from "./engine";

type SB = {
  from: (table: string) => any;
};

function token(): string {
  return randomBytes(18).toString("base64url");
}

export async function loadIdentity(supabase: SB): Promise<BusinessIdentity> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", IDENTITY_SETTING_KEY).maybeSingle();
  return mergeBusinessIdentity(data?.value);
}

export async function saveIdentity(supabase: SB, raw: unknown, _actor: string): Promise<BusinessIdentity> {
  const identity = mergeBusinessIdentity(raw);
  const { error } = await supabase.from("app_settings").upsert({
    key: IDENTITY_SETTING_KEY,
    value: identity,
    description: "Business details every email footer is built from. Marketing cannot send without a mailing address.",
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });
  if (error) throw new Error(error.message || "Could not save email settings.");
  return identity;
}

export async function loadClaims(supabase: SB): Promise<ApprovedClaim[]> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", CLAIMS_SETTING_KEY).maybeSingle();
  const rows = Array.isArray(data?.value) ? data.value : [];
  return rows.map((row: ApprovedClaim) => ({
    id: String(row.id || ""),
    phrase: String(row.phrase || ""),
    basis: String(row.basis || ""),
    conditional: Boolean(row.conditional),
    requiredWording: String(row.requiredWording || ""),
    active: Boolean(row.active),
  })).filter((row: ApprovedClaim) => row.id && row.phrase);
}

export async function saveClaims(supabase: SB, claims: ApprovedClaim[]): Promise<ApprovedClaim[]> {
  const cleaned = claims
    .map((row) => ({
      id: String(row.id || "").trim(),
      phrase: String(row.phrase || "").trim(),
      basis: String(row.basis || "").trim(),
      conditional: Boolean(row.conditional),
      requiredWording: String(row.requiredWording || "").trim(),
      active: Boolean(row.active) && Boolean(String(row.basis || "").trim()),
    }))
    .filter((row) => row.id && row.phrase);
  const { error } = await supabase.from("app_settings").upsert({
    key: CLAIMS_SETTING_KEY,
    value: cleaned,
    description: "Claims an email may make, each with the basis for saying it.",
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });
  if (error) throw new Error(error.message || "Could not save claims.");
  return cleaned;
}

export async function loadConsent(supabase: SB, email: string): Promise<ConsentRecord | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const { data } = await supabase.from("email_marketing_contacts").select("*").eq("email", normalized).maybeSingle();
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

export async function isSuppressed(supabase: SB, email: string): Promise<{ suppressed: boolean; reason: string }> {
  const normalized = normalizeEmail(email);
  if (!normalized) return { suppressed: false, reason: "" };
  const { data } = await supabase
    .from("email_suppression")
    .select("reason")
    .eq("email", normalized)
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return { suppressed: false, reason: "" };
  return { suppressed: true, reason: String(data.reason || "unsubscribe") };
}

async function writeEvent(
  supabase: SB,
  email: string,
  actor: ConsentActor,
  previous: string,
  next: string,
  source: string,
  detail: string,
): Promise<void> {
  await supabase.from("email_consent_events").insert({
    email,
    actor,
    previous_status: previous,
    next_status: next,
    source,
    detail,
  });
}

export async function recordContactSource(
  supabase: SB,
  input: { email: string; source: string; sourceNote?: string; consentBasis?: string; status?: "subscribed" | "not_asked"; actor?: ConsentActor },
): Promise<{ ok: boolean; error: string }> {
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, error: "An email address is required." };
  const existing = await loadConsent(supabase, email);
  if (existing?.status === "unsubscribed") {
    return { ok: false, error: "This address is unsubscribed. Only that person can resubscribe." };
  }
  const status = input.status || "not_asked";
  if (status === "subscribed" && input.actor !== "contact") {
    return { ok: false, error: "Only the person can subscribe." };
  }
  const now = new Date().toISOString();
  const { error } = await supabase.from("email_marketing_contacts").upsert({
    email,
    status,
    source: input.source,
    source_note: input.sourceNote || "",
    consent_basis: input.consentBasis || "",
    consented_at: status === "subscribed" ? now : null,
    updated_at: now,
  }, { onConflict: "email" });
  if (error) return { ok: false, error: error.message || "Could not save consent." };
  await writeEvent(supabase, email, input.actor || "system", existing?.status || "not_asked", status, input.source, input.sourceNote || "");
  return { ok: true, error: "" };
}

export async function suppressAddress(
  supabase: SB,
  input: { email: string; reason: "unsubscribe" | "bounce" | "complaint"; source: string; actor?: ConsentActor },
): Promise<{ ok: boolean; at: string; smsUnchanged: true }> {
  const email = normalizeEmail(input.email);
  const now = new Date().toISOString();
  if (!email) return { ok: false, at: now, smsUnchanged: true };
  const existing = await loadConsent(supabase, email);
  const actor = input.actor || (input.reason === "unsubscribe" ? "contact" : "system");
  const change = applyConsentChange({
    actor: actor === "admin" ? "admin" : actor,
    current: existing?.status || "not_asked",
    next: "unsubscribed",
    source: input.source,
  });
  if (!change.ok && actor === "admin") return { ok: false, at: now, smsUnchanged: true };
  await supabase.from("email_suppression").upsert({
    email,
    reason: input.reason,
    source: input.source,
    created_at: now,
    revoked_at: null,
  }, { onConflict: "email" });
  await supabase.from("email_marketing_contacts").upsert({
    email,
    status: "unsubscribed",
    source: existing?.source || input.source,
    source_note: existing?.sourceNote || "",
    consent_basis: existing?.consentBasis || "",
    categories: existing?.categories || null,
    unsubscribed_at: now,
    updated_at: now,
  }, { onConflict: "email" });
  await writeEvent(supabase, email, actor, existing?.status || "not_asked", "unsubscribed", input.source, input.reason);
  await supabase.from("partnership_opt_outs").insert({
    email,
    channel: "email",
    source: input.source,
  }).then(() => undefined, () => undefined);
  return { ok: true, at: now, smsUnchanged: true };
}

export async function resubscribeAddress(
  supabase: SB,
  input: { email: string; source: string },
): Promise<{ ok: boolean; error: string; smsUnchanged: true }> {
  const email = normalizeEmail(input.email);
  const existing = await loadConsent(supabase, email);
  const change = applyConsentChange({
    actor: "contact",
    current: existing?.status || "not_asked",
    next: "subscribed",
    source: input.source,
  });
  if (!change.ok) return { ok: false, error: change.error, smsUnchanged: true };
  const now = new Date().toISOString();
  await supabase.from("email_marketing_contacts").upsert({
    email,
    status: "subscribed",
    source: input.source,
    source_note: existing?.sourceNote || "Resubscribed from the preference page.",
    consent_basis: "contact_resubscribe",
    categories: existing?.categories || null,
    consented_at: now,
    unsubscribed_at: null,
    updated_at: now,
  }, { onConflict: "email" });
  await supabase.from("email_suppression").update({ revoked_at: now }).eq("email", email).is("revoked_at", null);
  await writeEvent(supabase, email, "contact", existing?.status || "not_asked", "subscribed", input.source, "contact resubscribed");
  return { ok: true, error: "", smsUnchanged: true };
}

export async function saveCategoryChoices(
  supabase: SB,
  email: string,
  categories: Record<string, boolean>,
): Promise<void> {
  const normalized = normalizeEmail(email);
  const now = new Date().toISOString();
  await supabase.from("email_marketing_contacts").upsert({
    email: normalized,
    categories,
    updated_at: now,
  }, { onConflict: "email" });
  await writeEvent(supabase, normalized, "contact", "subscribed", "subscribed", "preference_page", JSON.stringify(categories));
}

export async function ensureToken(supabase: SB, email: string): Promise<string> {
  const normalized = normalizeEmail(email);
  const { data } = await supabase.from("email_preference_tokens").select("token").eq("email", normalized).maybeSingle();
  if (data?.token) return String(data.token);
  const value = token();
  await supabase.from("email_preference_tokens").insert({ token: value, email: normalized });
  return value;
}

export async function emailForToken(supabase: SB, value: string): Promise<string | null> {
  const tokenValue = String(value || "").trim();
  if (!tokenValue) return null;
  const { data } = await supabase.from("email_preference_tokens").select("email").eq("token", tokenValue).maybeSingle();
  return data?.email ? normalizeEmail(data.email) : null;
}

export async function rememberFooter(supabase: SB, result: PrepareResult, identity: BusinessIdentity): Promise<void> {
  const { data } = await supabase.from("email_footer_versions").select("version_key").eq("version_key", result.footer.versionKey).maybeSingle();
  if (data?.version_key) return;
  await supabase.from("email_footer_versions").insert({
    version_key: result.footer.versionKey,
    email_type: result.type,
    html: result.footer.html,
    dark_html: result.footer.darkHtml,
    text_body: result.footer.text,
    identity_snapshot: identity,
  });
}

export async function recordDelivery(
  supabase: SB,
  record: DeliveryRecord,
  extra: { provider?: string; providerId?: string; bookingId?: string | null; status?: string; blockReasons?: string[] },
): Promise<string | null> {
  const { data, error } = await supabase.from("email_delivery_log").insert({
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
    provider: extra.provider || "resend",
    provider_id: extra.providerId || null,
    sent_at: record.sentAt,
    test_send: record.testSend,
    booking_id: extra.bookingId || null,
    status: extra.status || "sent",
    block_reasons: extra.blockReasons || [],
  }).select("id").maybeSingle();
  if (error) return null;
  if (extra.status !== "blocked" && !record.testSend) {
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
  return data?.id ? String(data.id) : null;
}

export async function recordInbound(
  supabase: SB,
  input: { email: string; mailbox: string; subject: string; body: string },
): Promise<void> {
  const email = normalizeEmail(input.email);
  if (!email) return;
  await supabase.from("email_conversation_messages").insert({
    contact_email: email,
    direction: "inbound",
    mailbox: normalizeEmail(input.mailbox),
    subject: input.subject || "",
    body: input.body || "",
    email_type: "customer_service",
  });
}

export async function loadTaxConsent(supabase: SB, email: string): Promise<{ consentedAt: string | null; withdrawnAt: string | null }> {
  const { data } = await supabase.from("email_tax_e_consent").select("consented_at, withdrawn_at").eq("email", normalizeEmail(email)).maybeSingle();
  if (!data || data.withdrawn_at) return { consentedAt: null, withdrawnAt: data?.withdrawn_at || null };
  return { consentedAt: data.consented_at || null, withdrawnAt: null };
}

export async function recordTaxConsent(
  supabase: SB,
  input: { email: string; contractorId?: string | null; source: string },
): Promise<{ ok: boolean; at: string }> {
  const email = normalizeEmail(input.email);
  const now = new Date().toISOString();
  if (!email) return { ok: false, at: now };
  await supabase.from("email_tax_e_consent").upsert({
    email,
    contractor_id: input.contractorId || null,
    consented_at: now,
    withdrawn_at: null,
    source: input.source,
  }, { onConflict: "email" });
  await writeEvent(supabase, email, "contact", "not_asked", "not_asked", input.source, "electronic tax delivery consent");
  return { ok: true, at: now };
}

export async function withdrawTaxConsent(supabase: SB, email: string): Promise<{ ok: boolean; at: string }> {
  const normalized = normalizeEmail(email);
  const now = new Date().toISOString();
  await supabase.from("email_tax_e_consent").update({ withdrawn_at: now }).eq("email", normalized);
  await writeEvent(supabase, normalized, "contact", "not_asked", "not_asked", "preference_page", "withdrew electronic tax delivery consent");
  return { ok: true, at: now };
}

export function preferenceUrls(origin: string, value: string): { unsubscribe: string; preferences: string; oneClick: string } {
  const base = origin.replace(/\/+$/, "");
  const tokenValue = encodeURIComponent(value);
  return {
    unsubscribe: `${base}/email/unsubscribe?t=${tokenValue}`,
    preferences: `${base}/email/preferences?t=${tokenValue}`,
    oneClick: `${base}/api/email/unsubscribe?t=${tokenValue}`,
  };
}

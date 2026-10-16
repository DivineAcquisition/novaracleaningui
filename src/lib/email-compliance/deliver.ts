// Send one email through the type rules, then store it exactly as sent.

import {
  evaluateEmail,
  mergeBusinessIdentity,
  normalizeEmail,
  toDeliveryRecord,
  type PrepareInput,
} from "./engine";
import {
  ensureToken,
  isSuppressed,
  loadClaims,
  loadConsent,
  loadIdentity,
  loadTaxConsent,
  preferenceUrls,
  recordDelivery,
  rememberFooter,
} from "./store";

type SB = { from: (table: string) => any; functions?: { invoke: (name: string, args: { body: unknown }) => Promise<{ data: unknown; error: { message?: string } | null }> } };

export interface DeliverInput extends Omit<PrepareInput, "identity" | "claims" | "consent" | "suppressed" | "unsubscribeUrl" | "preferencesUrl" | "oneClickUrl" | "taxElectronicConsentAt"> {
  to: string;
  cc?: string[];
  attachments?: Array<{ filename: string; content: string }>;
  idempotencyKey?: string;
  bookingId?: string | null;
  apiKey?: string | null;
}

export interface DeliverOutcome {
  ok: boolean;
  blocked: boolean;
  id: string;
  error: string;
  decision: "send" | "block";
  blockReasons: string[];
  warnings: string[];
  type: string;
}

async function resendSend(apiKey: string, body: Record<string, unknown>, idempotencyKey: string): Promise<{ ok: boolean; id: string; error: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, id: "", error: text.slice(0, 300) };
  try {
    return { ok: true, id: String(JSON.parse(text)?.id || ""), error: "" };
  } catch {
    return { ok: true, id: "", error: "" };
  }
}

export async function deliverCompliantEmail(supabase: SB, input: DeliverInput): Promise<DeliverOutcome> {
  const to = normalizeEmail(input.to);
  const identity = await loadIdentity(supabase);
  const claims = await loadClaims(supabase);
  const consent = await loadConsent(supabase, to);
  const suppressed = await isSuppressed(supabase, to);
  const tax = input.declaredType === "contractor_tax" || input.templateKey === "contractor_tax"
    ? await loadTaxConsent(supabase, to)
    : { consentedAt: null as string | null };
  const token = await ensureToken(supabase, to);
  const urls = preferenceUrls(identity.publicOrigin, token);
  const result = evaluateEmail({
    ...input,
    identity,
    claims,
    consent,
    suppressed: suppressed.suppressed,
    suppressionReason: suppressed.reason,
    unsubscribeUrl: urls.unsubscribe,
    preferencesUrl: urls.preferences,
    oneClickUrl: urls.oneClick,
    taxElectronicConsentAt: tax.consentedAt,
  });
  const record = toDeliveryRecord(result, {
    to,
    templateKey: input.templateKey,
    testSend: input.testSend,
  });

  if (result.decision === "block") {
    await recordDelivery(supabase, record, { status: "blocked", blockReasons: result.blockReasons, bookingId: input.bookingId });
    return {
      ok: false,
      blocked: true,
      id: "",
      error: result.blockReasons[0] || "This email cannot be sent.",
      decision: "block",
      blockReasons: result.blockReasons,
      warnings: result.warnings,
      type: result.type,
    };
  }

  try {
    await rememberFooter(supabase, result, mergeBusinessIdentity(identity));
  } catch {
    /* A missing footer-version table must not stop a message that already passed the checks. */
  }
  const apiKey = input.apiKey || process.env.RESEND_API_KEY || "";
  if (!apiKey) {
    return { ok: false, blocked: false, id: "", error: "RESEND_API_KEY not configured", decision: "send", blockReasons: [], warnings: result.warnings, type: result.type };
  }
  const sent = await resendSend(apiKey, {
    from: result.from,
    to: [to],
    subject: result.subject,
    html: result.html,
    text: result.text,
    reply_to: result.replyTo,
    headers: result.headers,
    tags: [{ name: "stream", value: result.stream }, { name: "email_type", value: result.type }],
    ...(input.cc?.length ? { cc: input.cc } : {}),
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
  }, input.idempotencyKey || "");
  if (!sent.ok) {
    await recordDelivery(supabase, record, { status: "failed", blockReasons: [sent.error], bookingId: input.bookingId });
    return { ok: false, blocked: false, id: "", error: sent.error, decision: "send", blockReasons: [], warnings: result.warnings, type: result.type };
  }
  await recordDelivery(supabase, record, { providerId: sent.id, bookingId: input.bookingId, status: input.testSend ? "test" : "sent" });
  return { ok: true, blocked: false, id: sent.id, error: "", decision: "send", blockReasons: [], warnings: result.warnings, type: result.type };
}

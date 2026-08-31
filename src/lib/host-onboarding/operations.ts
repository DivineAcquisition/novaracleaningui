// ─── Host onboarding operations ────────────────────────────────────────────
//
// The acts that move a host through the tokenized session: sign the
// partnership agreement, confirm or flag a proposed property, request an
// additional property, save a payment method, provision the portal.
//
// Step order is enforced here. Pages 2 and 3 refuse unless Page 1 is signed.

import { resolveAppSecret, stripeCall, createCardPreAuth, readPaymentIntent } from "@/lib/stripe-rest";
import { MIN_PASSWORD_LENGTH } from "./types";
import type { PaymentOptionKey } from "./agreement";
import { parseSnapshot, portalUrl } from "./session";
import { sendPartnershipMessage } from "@/lib/partnership-comms/server";
import {
  sendAgreement,
  buildHostValues,
  buildHostPropertyFields,
  downloadCompletedAgreementPdf,
} from "@/lib/docuseal";
import { buildHostAgreementBase64 } from "@/lib/host-onboarding/agreement-pdf";

// eslint-disable-next-line
type Admin = any;
type Row = Record<string, unknown>;

export const AGREEMENT_BUCKET = "host-agreements";

export const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

export function requestContext(req: Request): RequestContext {
  return {
    ip:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null,
    userAgent: req.headers.get("user-agent")?.slice(0, 400) || null,
  };
}

export function validateSignature(input: {
  signerName: string;
  agreedToTerms: unknown;
  acknowledgedNonCircumvention: unknown;
  acknowledgedChargebacks: unknown;
  acknowledgedArbitration: unknown;
  signatureDataUrl: string;
  pdfBase64?: string;
}): string | null {
  if (input.signerName.length < 2) return "Please enter your full legal name to sign.";
  if (input.agreedToTerms !== true) return "Please confirm you've read and agree to the agreement.";
  if (input.acknowledgedNonCircumvention !== true) {
    return "Please acknowledge the non-circumvention provision.";
  }
  if (input.acknowledgedChargebacks !== true) {
    return "Please acknowledge the chargeback terms.";
  }
  if (input.acknowledgedArbitration !== true) {
    return "Please acknowledge the arbitration provision.";
  }
  if (!/^data:image\/png;base64,/.test(input.signatureDataUrl)) {
    return "Please draw your signature in the box above.";
  }
  return null;
}

export function requireSigned(session: Row): string | null {
  if (session.signed_at || session.agreement_id) return null;
  return "Sign the Host Partnership Agreement first — Pages 2 and 3 open after that.";
}

export async function signHostAgreement(
  supabase: Admin,
  input: {
    session: Row;
    host: Row;
    signerName: string;
    signerEmail: string;
    entityType?: string | null;
    entityName?: string | null;
    signatureDataUrl: string;
    pdfBase64?: string;
    ctx: RequestContext;
  },
): Promise<{ ok: boolean; status: number; message: string; alreadySigned?: boolean; agreementId?: string }> {
  const session = input.session;
  if (session.signed_at || session.agreement_id) {
    return {
      ok: true,
      status: 200,
      alreadySigned: true,
      message: "This agreement is already signed — continue to your rate schedule.",
      agreementId: (session.agreement_id as string) || undefined,
    };
  }

  const now = new Date().toISOString();
  const stamp = Date.now();
  const base = `${session.host_id}/${session.id}-${stamp}`;
  const pdfPath = `${base}.pdf`;
  const sigPath = `${base}-signature.png`;
  const properties = parseSnapshot(session.property_snapshot);
  const entityName = input.entityName || (input.host.entity_name as string) || null;
  const hostName = input.signerName;
  const hostEmail = input.signerEmail;

  let pdfBase64 = input.pdfBase64 && input.pdfBase64.length >= 500 ? input.pdfBase64 : "";
  try {
    const res = await sendAgreement({
      audience: "str_host",
      email: hostEmail,
      name: hostName,
      sendEmail: true,
      signatureImage: input.signatureDataUrl,
      hostEmail,
      values: buildHostValues({
        name: hostName,
        company: entityName || hostName,
        email: hostEmail,
        entityType: input.entityType,
      }),
      fields: buildHostPropertyFields(
        properties.map((p) => ({
          nickname: p.nickname,
          address: p.address,
          bedrooms: p.bedrooms,
          bathrooms: p.bathrooms,
          rate: p.turnover_price,
          linen: p.linen,
          restock: p.restock,
          notes: p.special_notes,
        })),
      ),
      metadata: { host_id: session.host_id, session_id: session.id, kind: "str_host" },
    });
    if (res.submissionId) {
      const fromDocuseal = await downloadCompletedAgreementPdf(res.submissionId);
      if (fromDocuseal && fromDocuseal.length >= 500) pdfBase64 = fromDocuseal;
    }
  } catch (err) {
    console.error("[host-onboarding] docuseal complete failed", (err as Error).message);
  }

  if (pdfBase64.length < 500) {
    pdfBase64 = await buildHostAgreementBase64({
      signerName: hostName,
      signerEmail: hostEmail,
      entityType: input.entityType,
      entityName,
      properties,
      signatureDataUrl: input.signatureDataUrl,
    });
  }

  if (pdfBase64.length < 500) {
    return { ok: false, status: 502, message: "The signed document didn't generate correctly. Please reload and try again." };
  }

  const { error: pdfErr } = await supabase.storage
    .from(AGREEMENT_BUCKET)
    .upload(pdfPath, Buffer.from(pdfBase64, "base64"), {
      contentType: "application/pdf",
      upsert: true,
    });
  if (pdfErr) {
    return { ok: false, status: 502, message: `Could not store the signed agreement: ${pdfErr.message}` };
  }
  await supabase.storage
    .from(AGREEMENT_BUCKET)
    .upload(sigPath, Buffer.from(input.signatureDataUrl.split(",")[1] || "", "base64"), {
      contentType: "image/png",
      upsert: true,
    });

  const { data: agreement, error: agrErr } = await supabase
    .from("host_partnership_agreements")
    .insert({
      host_id: session.host_id,
      session_id: session.id,
      submission_id: session.submission_id || null,
      signer_name: input.signerName,
      signer_email: input.signerEmail,
      entity_type: input.entityType || null,
      entity_name: input.entityName || null,
      signed_at: now,
      signature_path: sigPath,
      document_path: pdfPath,
      acknowledged_non_circumvention: true,
      acknowledged_chargebacks: true,
      acknowledged_arbitration: true,
      ip: input.ctx.ip,
      user_agent: input.ctx.userAgent,
    })
    .select("id")
    .single();
  if (agrErr) {
    return { ok: false, status: 400, message: agrErr.message };
  }

  await supabase
    .from("host_onboarding_sessions")
    .update({
      agreement_id: agreement.id,
      signed_at: now,
      signer_name: input.signerName,
      last_completed_step: "legal",
      last_activity_at: now,
      updated_at: now,
    })
    .eq("id", session.id as string);

  if (session.submission_id) {
    await supabase
      .from("host_onboarding_submissions")
      .update({ status: "signed", agreement_signed_at: now })
      .eq("id", session.submission_id as string);
  }

  await supabase.from("events").insert({
    event_type: "host.onboarding.signed",
    source: "host-onboarding",
    summary: `${input.signerName} signed the Host Partnership Agreement.`,
    data: { host_id: session.host_id, session_id: session.id, agreement_id: agreement.id },
  });

  return {
    ok: true,
    status: 200,
    agreementId: String(agreement.id),
    message: "Signed. Next: confirm each property and its Company-set rate.",
  };
}

export async function decideProperty(
  supabase: Admin,
  input: {
    session: Row;
    host: Row;
    propertyId: string;
    decision: "confirmed" | "flagged";
    note?: string;
    byName: string;
  },
): Promise<{ ok: boolean; status: number; message: string }> {
  const gate = requireSigned(input.session);
  if (gate) return { ok: false, status: 409, message: gate };

  const snapshot = parseSnapshot(input.session.property_snapshot);
  const prop = snapshot.find((p) => p.property_id === input.propertyId);
  if (!prop) return { ok: false, status: 404, message: "That property isn't on this proposal." };

  if (input.decision === "flagged") {
    const note = clip(input.note, 1000);
    if (note.length < 3) {
      return { ok: false, status: 400, message: "Add a short note so we know what's wrong." };
    }
  }

  const now = new Date().toISOString();
  await supabase
    .from("host_onboarding_session_items")
    .delete()
    .eq("session_id", input.session.id as string)
    .eq("property_id", input.propertyId)
    .eq("kind", "property_decision");
  const { error: insErr } = await supabase.from("host_onboarding_session_items").insert({
    session_id: input.session.id,
    host_id: input.session.host_id,
    kind: "property_decision",
    property_id: input.propertyId,
    decision: input.decision,
    note: input.decision === "flagged" ? clip(input.note, 1000) : null,
    submitted_by_name: input.byName,
    status: input.decision === "flagged" ? "pending" : "actioned",
  });
  if (insErr) return { ok: false, status: 400, message: insErr.message };

  if (input.decision === "flagged") {
    await notifyAdmin(supabase, {
      subject: `Property flagged — ${String(input.host.name || input.host.email || "host")}`,
      html: [
        `<p><strong>${input.byName}</strong> flagged a property during host onboarding.</p>`,
        `<p><strong>${prop.nickname || "Property"}</strong><br/>${(prop.address || "").replace(/</g, "&lt;")}</p>`,
        `<p>Listed rate (admin-set, not editable by the host): <strong>$${Number(prop.turnover_price).toFixed(0)}</strong>/turnover</p>`,
        `<p style="border-left:3px solid #7c3aed;padding-left:12px;white-space:pre-wrap">${clip(input.note, 1000).replace(/</g, "&lt;")}</p>`,
        `<p>This does not block the rest of their session. Review it in Partnerships → STR.</p>`,
      ].join(""),
      eventType: "host.onboarding.property_flagged",
      summary: `${input.byName} flagged ${prop.nickname || "a property"}: ${clip(input.note, 180)}`,
      data: { host_id: input.session.host_id, session_id: input.session.id, property_id: input.propertyId },
    });
  }

  const items = await supabase
    .from("host_onboarding_session_items")
    .select("property_id, decision")
    .eq("session_id", input.session.id as string)
    .eq("kind", "property_decision");
  const decided = new Set(
    ((items.data || []) as Array<{ property_id: string; decision: string }>)
      .filter((i) => i.decision === "confirmed" || i.decision === "flagged")
      .map((i) => i.property_id),
  );
  if (snapshot.every((p) => decided.has(p.property_id))) {
    await supabase
      .from("host_onboarding_sessions")
      .update({ rates_confirmed_at: now, last_completed_step: "rates", updated_at: now })
      .eq("id", input.session.id as string);
  }

  return {
    ok: true,
    status: 200,
    message:
      input.decision === "flagged"
        ? "Noted — that's with our team. You can keep going; this doesn't block payment setup."
        : "Confirmed.",
  };
}

export async function requestAdditionalProperty(
  supabase: Admin,
  input: {
    session: Row;
    host: Row;
    nickname?: string;
    address: string;
    bedrooms?: number;
    bathrooms?: number;
    notes?: string;
    byName: string;
  },
): Promise<{ ok: boolean; status: number; message: string }> {
  const gate = requireSigned(input.session);
  if (gate) return { ok: false, status: 409, message: gate };

  const address = clip(input.address, 300);
  if (address.length < 5) {
    return { ok: false, status: 400, message: "Add the address of the property you'd like us to price." };
  }

  const { error } = await supabase.from("host_onboarding_session_items").insert({
    session_id: input.session.id,
    host_id: input.session.host_id,
    kind: "additional_property",
    requested_nickname: clip(input.nickname, 120) || null,
    requested_address: address,
    requested_bedrooms: Number.isFinite(input.bedrooms) ? input.bedrooms : null,
    requested_bathrooms: Number.isFinite(input.bathrooms) ? input.bathrooms : null,
    requested_notes: clip(input.notes, 2000) || null,
    submitted_by_name: input.byName,
    status: "pending",
  });
  if (error) return { ok: false, status: 400, message: error.message };

  await notifyAdmin(supabase, {
    subject: `Additional property requested — ${String(input.host.name || input.host.email || "host")}`,
    html: [
      `<p><strong>${input.byName}</strong> requested an additional property during host onboarding.</p>`,
      `<p>This has <strong>not</strong> been priced or added — it needs Company pricing under Section 5.</p>`,
      `<p><strong>${clip(input.nickname, 120) || "Property"}</strong><br/>${address.replace(/</g, "&lt;")}</p>`,
      input.notes
        ? `<p style="border-left:3px solid #7c3aed;padding-left:12px;white-space:pre-wrap">${clip(input.notes, 2000).replace(/</g, "&lt;")}</p>`
        : "",
    ].join(""),
    eventType: "host.onboarding.additional_property",
    summary: `${input.byName} requested an additional property: ${address.slice(0, 160)}`,
    data: { host_id: input.session.host_id, session_id: input.session.id, address },
  });

  return {
    ok: true,
    status: 200,
    message:
      "Thanks — that's with our team to price. It won't appear on your schedule until we set a rate.",
  };
}

export async function ensureHostCustomer(
  stripeKey: string,
  args: { hostId: string; email: string; name: string; existingId?: string | null },
): Promise<string> {
  if (args.existingId) return args.existingId;
  const found = await stripeCall(stripeKey, "GET", "customers", { email: args.email, limit: "1" });
  const existing = found?.data?.[0]?.id as string | undefined;
  if (existing) return existing;
  const created = await stripeCall(stripeKey, "POST", "customers", {
    email: args.email,
    name: args.name,
    "metadata[host_id]": args.hostId,
    "metadata[kind]": "host",
  });
  return String(created.id);
}

export async function openPaymentSetup(
  supabase: Admin,
  input: {
    session: Row;
    host: Row;
    paymentOption: PaymentOptionKey;
    returnUrl: string;
  },
): Promise<{
  ok: boolean;
  status: number;
  message?: string;
  clientSecret?: string;
  amountCents?: number;
  alreadyHeld?: boolean;
}> {
  const gate = requireSigned(input.session);
  if (gate) return { ok: false, status: 409, message: gate };

  const payAfterEnabled = !!(input.host.pay_after_enabled ?? input.session.pay_after_enabled);
  if (input.paymentOption === "pay_after" && !payAfterEnabled) {
    return {
      ok: false,
      status: 409,
      message: "Pay After isn't available for this account. Choose Pay in Full or Split Payment.",
    };
  }

  const stripeKey = await resolveAppSecret("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    return {
      ok: false,
      status: 503,
      message: "Card setup is temporarily unavailable. Reply to the email and we'll help.",
    };
  }

  const email = String(input.host.email || input.session.recipient_email || "");
  if (!email) return { ok: false, status: 400, message: "No email on file to attach a payment method to." };

  try {
    const customerId = await ensureHostCustomer(stripeKey, {
      hostId: String(input.host.id),
      email,
      name: String(input.host.name || input.session.recipient_name || ""),
      existingId: (input.host.stripe_customer_id as string) || null,
    });
    await supabase.from("hosts").update({ stripe_customer_id: customerId }).eq("id", input.host.id as string);

    const existingId = String(input.session.stripe_setup_session_id || "");
    if (existingId.startsWith("pi_")) {
      const existing = await readPaymentIntent(stripeKey, existingId);
      if (existing.held && existing.paymentMethodId) {
        await applyHostHold(supabase, {
          session: input.session,
          host: input.host,
          customerId: existing.customerId || customerId,
          paymentMethodId: existing.paymentMethodId,
          intentId: existing.id,
          paymentOption: input.paymentOption,
        });
        return { ok: true, status: 200, alreadyHeld: true, amountCents: existing.amountCents };
      }
      if (existing.needsCard && existing.clientSecret) {
        await supabase
          .from("host_onboarding_sessions")
          .update({
            payment_option: input.paymentOption,
            stripe_setup_session_id: existing.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", input.session.id as string);
        return {
          ok: true,
          status: 200,
          clientSecret: existing.clientSecret,
          amountCents: existing.amountCents,
        };
      }
    }

    const snapshot = parseSnapshot(input.session.property_snapshot);
    const amountCents = Math.round(Number(snapshot[0]?.turnover_price || 0) * 100);
    const hold = await createCardPreAuth(stripeKey, {
      customerId,
      amountCents,
      description: `Novara host pre-auth hold — ${String(input.host.name || "host")}`,
      metadata: {
        host_id: String(input.host.id),
        session_id: String(input.session.id),
        kind: "host_onboarding_preauth",
        payment_option: input.paymentOption,
      },
    });

    await supabase
      .from("host_onboarding_sessions")
      .update({
        payment_option: input.paymentOption,
        stripe_setup_session_id: hold.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.session.id as string);

    await supabase
      .from("hosts")
      .update({ preferred_payment_option: input.paymentOption })
      .eq("id", input.host.id as string);

    return { ok: true, status: 200, clientSecret: hold.clientSecret, amountCents: hold.amountCents };
  } catch (err) {
    return { ok: false, status: 502, message: `Could not open card setup: ${(err as Error).message}` };
  }
}

async function applyHostHold(
  supabase: Admin,
  input: {
    session: Row;
    host: Row;
    customerId: string;
    paymentMethodId: string;
    intentId: string;
    paymentOption: PaymentOptionKey;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from("hosts")
    .update({
      stripe_customer_id: input.customerId,
      default_payment_method_id: input.paymentMethodId,
      preferred_payment_option: input.paymentOption,
    })
    .eq("id", input.host.id as string);
  await supabase
    .from("host_onboarding_sessions")
    .update({
      payment_option: input.paymentOption,
      payment_method_id: input.paymentMethodId,
      stripe_setup_session_id: input.intentId,
      payment_setup_at: now,
      updated_at: now,
    })
    .eq("id", input.session.id as string);
  const stripeKey = await resolveAppSecret("STRIPE_SECRET_KEY");
  if (stripeKey && input.customerId && input.paymentMethodId) {
    try {
      await stripeCall(stripeKey, "POST", `customers/${input.customerId}`, {
        "invoice_settings[default_payment_method]": input.paymentMethodId,
      });
    } catch {
      /* best-effort */
    }
  }
}

export async function refreshPaymentFromStripe(
  supabase: Admin,
  input: { session: Row; host: Row; paymentIntentId?: string | null },
): Promise<{ ok: boolean; paymentMethodId: string | null }> {
  const stripeKey = await resolveAppSecret("STRIPE_SECRET_KEY");
  if (!stripeKey) return { ok: false, paymentMethodId: null };

  let customerId = (input.host.stripe_customer_id as string) || null;
  let methodId: string | null = (input.host.default_payment_method_id as string) || null;

  const setupId = String(input.paymentIntentId || input.session.stripe_setup_session_id || "");
  if (setupId.startsWith("pi_")) {
    try {
      const intent = await readPaymentIntent(stripeKey, setupId);
      if (intent.customerId) customerId = intent.customerId;
      if (intent.held && intent.paymentMethodId) methodId = intent.paymentMethodId;
    } catch {
      /* fall through */
    }
  } else if (setupId.startsWith("cs_")) {
    try {
      const checkout = await stripeCall(stripeKey, "GET", `checkout/sessions/${setupId}`);
      const setupIntentId = checkout.setup_intent as string | undefined;
      if (checkout.customer) customerId = String(checkout.customer);
      if (setupIntentId) {
        const intent = await stripeCall(stripeKey, "GET", `setup_intents/${setupIntentId}`);
        if (intent.payment_method) methodId = String(intent.payment_method);
      }
    } catch {
      /* fall through to customer default */
    }
  }

  if (!methodId && customerId) {
    try {
      const list = await stripeCall(stripeKey, "GET", "payment_methods", {
        customer: customerId,
        type: "card",
        limit: "1",
      });
      methodId = (list?.data?.[0]?.id as string) || null;
    } catch {
      methodId = null;
    }
  }

  if (methodId) {
    const now = new Date().toISOString();
    await supabase
      .from("hosts")
      .update({
        stripe_customer_id: customerId,
        default_payment_method_id: methodId,
      })
      .eq("id", input.host.id as string);
    await supabase
      .from("host_onboarding_sessions")
      .update({
        payment_method_id: methodId,
        payment_setup_at: now,
        updated_at: now,
      })
      .eq("id", input.session.id as string);
  }

  return { ok: !!methodId, paymentMethodId: methodId };
}

export function validatePortalPassword(password: string, minLength = MIN_PASSWORD_LENGTH): string | null {
  if (!password || password.length < minLength) {
    return `Choose a password of at least ${minLength} characters.`;
  }
  return null;
}

function isDuplicate(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("already been registered") || m.includes("already registered") || m.includes("duplicate");
}

async function findUserIdByEmail(admin: Admin, email: string): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const hit = data.users.find(
      (u: { email?: string | null; id: string }) => String(u.email || "").toLowerCase() === target,
    );
    if (hit) return hit.id as string;
    if (data.users.length < 200) return null;
  }
  return null;
}

export async function provisionHostPortal(
  supabase: Admin,
  input: {
    session: Row;
    host: Row;
    email: string;
    password?: string;
    fullName?: string;
  },
): Promise<{ ok: boolean; created: boolean; linkedExisting: boolean; userId: string | null; error?: string; portalUrl: string; handoffUrl?: string }> {
  const { provisionHostPortalAccess } = await import("@/lib/partner-portal/handoff");
  const email = String(input.email || input.session.recipient_email || input.host.email || "").trim().toLowerCase();
  const access = await provisionHostPortalAccess({
    email,
    hostId: String(input.host.id),
    displayName: input.fullName || (input.host.name as string) || null,
    phone: (input.host.phone as string) || null,
    sessionId: String(input.session.id),
  });
  const portal = access.handoffUrl || portalUrl();
  if (!access.ok) {
    return {
      ok: false,
      created: false,
      linkedExisting: false,
      userId: null,
      error: access.error,
      portalUrl: portalUrl(),
    };
  }
  if (input.host.user_id || input.session.portal_user_id) {
    return {
      ok: true,
      created: false,
      linkedExisting: true,
      userId: String(input.host.user_id || input.session.portal_user_id),
      portalUrl: portal,
      handoffUrl: access.handoffUrl,
    };
  }

  // Passwordless identity + handoff is enough. Linking an auth.users row is
  // best-effort for older host.user_id joins — we never set or store a password.
  let userId: string | null = null;
  let linkedExisting = false;
  try {
    const created = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        is_partner_host: true,
        full_name: input.fullName || input.host.name || null,
        phone: input.host.phone || null,
      },
    });
    if (created.error) {
      if (isDuplicate(created.error.message)) {
        linkedExisting = true;
        userId = await findUserIdByEmail(supabase, email);
      }
    } else {
      userId = created.data?.user?.id || null;
    }
    if (userId) {
      await supabase.from("hosts").update({ user_id: userId }).eq("id", input.host.id as string).is("user_id", null);
    }
  } catch {
    /* identity handoff already succeeded */
  }

  const now = new Date().toISOString();
  await supabase
    .from("host_onboarding_sessions")
    .update({
      portal_user_id: userId,
      portal_provisioned_at: now,
      last_completed_step: "payment",
      last_activity_at: now,
      updated_at: now,
    })
    .eq("id", input.session.id as string);

  return {
    ok: true,
    created: !linkedExisting,
    linkedExisting,
    userId,
    portalUrl: portal,
    handoffUrl: access.handoffUrl,
  };
}

export async function markPortalAlreadyLinked(supabase: Admin, session: Row, host: Row): Promise<void> {
  const userId = (host.user_id as string) || (session.portal_user_id as string) || null;
  if (!userId) return;
  await supabase
    .from("host_onboarding_sessions")
    .update({
      portal_user_id: userId,
      portal_provisioned_at: session.portal_provisioned_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id as string);
}

async function notifyAdmin(
  supabase: Admin,
  input: {
    subject: string;
    html: string;
    eventType: string;
    summary: string;
    data: Record<string, unknown>;
  },
): Promise<void> {
  await supabase.from("events").insert({
    event_type: input.eventType,
    source: "host-onboarding",
    summary: input.summary,
    data: input.data,
  });

  const { data: setting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "host_onboarding_settings")
    .maybeSingle();
  const notify =
    (setting?.value as { notify_email?: string } | null)?.notify_email ||
    process.env.HOST_ONBOARDING_NOTIFY_EMAIL ||
    null;
  if (!notify) return;
  await sendPartnershipMessage(supabase, {
    templateKey: "admin_internal_notice",
    trigger: input.eventType,
    role: "admin",
    email: notify,
    subject: input.subject,
    html: input.html,
    vars: {
      subject_line: input.subject,
      body_html: input.html,
    },
  }).catch(() => null);
}

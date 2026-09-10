// ─── Property-manager onboarding operations ────────────────────────────────
//
// The acts that move a manager through the tokenized session: sign the
// services agreement, confirm or flag a registered unit, add a unit, choose
// billing, and open the portal.
//
// Step order is enforced here, not in the UI. Pages 2 and 3 refuse unless
// Page 1 is signed, so a crafted request cannot skip the signature that makes
// the rate schedule binding.

import { resolveAppSecret, stripeCall } from "@/lib/stripe-rest";
import { registerUnit } from "../registry";
import { PM_SERVICE_LABELS, PM_SERVICE_TYPES, formatRate } from "../pricing";
import { sendPartnershipMessage } from "@/lib/partnership-comms/server";
import { PM_BILLING_OPTIONS, type PmBillingMethod } from "./agreement";
import { buildPmAgreementBase64 } from "./agreement-pdf";
import { parseSnapshot, portalUrl } from "./session";

// eslint-disable-next-line
type Admin = any;
type Row = Record<string, unknown>;

export const PM_AGREEMENT_BUCKET = "pm-agreements";

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
}): string | null {
  if (input.signerName.length < 2) return "Please enter your full legal name to sign.";
  if (input.agreedToTerms !== true) return "Please confirm you've read and agree to the agreement.";
  if (input.acknowledgedNonCircumvention !== true) {
    return "Please acknowledge the non-circumvention provision.";
  }
  if (input.acknowledgedChargebacks !== true) return "Please acknowledge the chargeback terms.";
  if (input.acknowledgedArbitration !== true) return "Please acknowledge the arbitration provision.";
  if (!/^data:image\/png;base64,/.test(input.signatureDataUrl)) {
    return "Please draw your signature in the box above.";
  }
  return null;
}

export function requireSigned(session: Row): string | null {
  if (session.signed_at || session.agreement_id) return null;
  return "Sign the Property Management Services Agreement first — Pages 2 and 3 open after that.";
}

// ─── Page 1: sign ──────────────────────────────────────────────────────────

export async function signPmAgreement(
  supabase: Admin,
  input: {
    session: Row;
    account: Row;
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
      message: "This agreement is already signed — continue to your unit registry.",
      agreementId: (session.agreement_id as string) || undefined,
    };
  }

  const now = new Date().toISOString();
  const base = `${session.pm_account_id}/${session.id}-${Date.now()}`;
  const pdfPath = `${base}.pdf`;
  const sigPath = `${base}-signature.png`;
  const units = parseSnapshot(session.unit_snapshot);

  // The browser builds the executed copy so the signature image renders in
  // the same place the signer saw it; the server rebuilds only if that fails.
  let pdfBase64 = input.pdfBase64 && input.pdfBase64.length >= 500 ? input.pdfBase64 : "";
  if (pdfBase64.length < 500) {
    pdfBase64 = await buildPmAgreementBase64({
      signerName: input.signerName,
      signerEmail: input.signerEmail,
      entityType: input.entityType,
      entityName: input.entityName,
      companyName: (input.account.company_name as string) || null,
      units,
      billingMethod: (session.billing_method as PmBillingMethod) || "invoiced",
      volumeDiscountPercent: Number(input.account.volume_discount_percent || 0),
      signatureDataUrl: input.signatureDataUrl,
    }).catch(() => "");
  }
  if (pdfBase64.length < 500) {
    return {
      ok: false,
      status: 502,
      message: "The signed document didn't generate correctly. Please reload and try again.",
    };
  }

  const { error: pdfErr } = await supabase.storage
    .from(PM_AGREEMENT_BUCKET)
    .upload(pdfPath, Buffer.from(pdfBase64, "base64"), {
      contentType: "application/pdf",
      upsert: true,
    });
  if (pdfErr) {
    return { ok: false, status: 502, message: `Could not store the signed agreement: ${pdfErr.message}` };
  }
  await supabase.storage
    .from(PM_AGREEMENT_BUCKET)
    .upload(sigPath, Buffer.from(input.signatureDataUrl.split(",")[1] || "", "base64"), {
      contentType: "image/png",
      upsert: true,
    });

  const { data: agreement, error: agrErr } = await supabase
    .from("property_manager_agreements")
    .insert({
      pm_account_id: session.pm_account_id,
      session_id: session.id,
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
  if (agrErr) return { ok: false, status: 400, message: agrErr.message };

  await supabase
    .from("property_manager_onboarding_sessions")
    .update({
      agreement_id: agreement.id,
      signed_at: now,
      signer_name: input.signerName,
      last_completed_step: "legal",
      last_activity_at: now,
      updated_at: now,
    })
    .eq("id", session.id as string);

  await supabase.from("events").insert({
    event_type: "property_manager.onboarding.signed",
    source: "property-manager-onboarding",
    summary: `${input.signerName} signed the Property Management Services Agreement.`,
    data: {
      pm_account_id: session.pm_account_id,
      session_id: session.id,
      agreement_id: agreement.id,
      unit_count: units.length,
    },
  });

  return {
    ok: true,
    status: 200,
    agreementId: String(agreement.id),
    message: "Signed. Next: confirm each unit and its standing rates.",
  };
}

// ─── Page 2: confirm or flag a unit ────────────────────────────────────────

/**
 * Confirming is the normal path and takes one click. Flagging raises the unit
 * with our team and is recorded as a decision, so it does not hold the
 * manager on Page 2 — the rest of the portfolio is fine and the session
 * should finish.
 */
export async function decideUnit(
  supabase: Admin,
  input: {
    session: Row;
    account: Row;
    unitId: string;
    decision: "confirmed" | "flagged";
    note?: string;
    byName: string;
  },
): Promise<{ ok: boolean; status: number; message: string }> {
  const gate = requireSigned(input.session);
  if (gate) return { ok: false, status: 409, message: gate };

  const snapshot = parseSnapshot(input.session.unit_snapshot);
  const unit = snapshot.find((u) => u.unit_id === input.unitId);
  if (!unit) return { ok: false, status: 404, message: "That unit isn't on this registry." };

  if (input.decision === "flagged" && clip(input.note, 1000).length < 3) {
    return { ok: false, status: 400, message: "Add a short note so we know what's wrong." };
  }

  const now = new Date().toISOString();
  await supabase
    .from("property_manager_onboarding_session_items")
    .delete()
    .eq("session_id", input.session.id as string)
    .eq("unit_id", input.unitId)
    .eq("kind", "unit_decision");

  const { error: insErr } = await supabase
    .from("property_manager_onboarding_session_items")
    .insert({
      session_id: input.session.id,
      pm_account_id: input.session.pm_account_id,
      kind: "unit_decision",
      unit_id: input.unitId,
      decision: input.decision,
      note: input.decision === "flagged" ? clip(input.note, 1000) : null,
      submitted_by_name: input.byName,
      status: input.decision === "flagged" ? "pending" : "actioned",
    });
  if (insErr) return { ok: false, status: 400, message: insErr.message };

  if (input.decision === "flagged") {
    await notifyAdmin(supabase, {
      subject: `Unit flagged — ${String(input.account.company_name || "property manager")}`,
      html: [
        `<p><strong>${escapeHtml(input.byName)}</strong> flagged a unit during onboarding.</p>`,
        `<p><strong>${escapeHtml(unit.unit_label || "Unit")}</strong><br/>${escapeHtml(unit.address || "")}</p>`,
        `<p>Standing rates (Company-set, not editable by the manager): ${escapeHtml(
          PM_SERVICE_TYPES.map((s) => `${PM_SERVICE_LABELS[s]} ${formatRate(unit.rates[s])}`).join(" · "),
        )}</p>`,
        `<p style="border-left:3px solid #7c3aed;padding-left:12px;white-space:pre-wrap">${escapeHtml(
          clip(input.note, 1000),
        )}</p>`,
        `<p>This does not block the rest of their session. Review it in Partnerships → Property Managers.</p>`,
      ].join(""),
      eventType: "property_manager.onboarding.unit_flagged",
      summary: `${input.byName} flagged ${unit.unit_label || "a unit"}: ${clip(input.note, 180)}`,
      data: {
        pm_account_id: input.session.pm_account_id,
        session_id: input.session.id,
        unit_id: input.unitId,
      },
    });
  }

  const items = await supabase
    .from("property_manager_onboarding_session_items")
    .select("unit_id, decision")
    .eq("session_id", input.session.id as string)
    .eq("kind", "unit_decision");
  const decided = new Set(
    ((items.data || []) as Array<{ unit_id: string; decision: string }>)
      .filter((i) => i.decision === "confirmed" || i.decision === "flagged")
      .map((i) => i.unit_id),
  );
  if (snapshot.every((u) => decided.has(u.unit_id))) {
    await supabase
      .from("property_manager_onboarding_sessions")
      .update({ registry_confirmed_at: now, last_completed_step: "registry", updated_at: now })
      .eq("id", input.session.id as string);
  }

  return {
    ok: true,
    status: 200,
    message:
      input.decision === "flagged"
        ? "Noted — that's with our team. It doesn't change the rate or hold up the rest of your registry."
        : "Confirmed.",
  };
}

// ─── Page 2: add a unit mid-session ────────────────────────────────────────

/**
 * "Add Unit" during onboarding routes exactly as it does from the portal: a
 * typical unit prices itself immediately and joins the registry; only the
 * genuinely unusual one goes to a person. Either way the session continues.
 */
export async function addUnitDuringOnboarding(
  supabase: Admin,
  input: {
    session: Row;
    account: Row;
    unitLabel?: string;
    address: string;
    city?: string;
    state?: string;
    zipCode?: string;
    sqft?: number;
    bedrooms?: number;
    bathrooms?: number;
    notes?: string;
    flagNonStandard?: boolean;
    byName: string;
  },
): Promise<{ ok: boolean; status: number; message: string; autoPriced?: boolean; unitId?: string }> {
  const gate = requireSigned(input.session);
  if (gate) return { ok: false, status: 409, message: gate };

  const address = clip(input.address, 300);
  if (address.length < 5) {
    return { ok: false, status: 400, message: "Add the unit's street address." };
  }

  const registered = await registerUnit(supabase, {
    pmAccountId: String(input.session.pm_account_id),
    unitLabel: input.unitLabel,
    address,
    city: input.city,
    state: input.state,
    zipCode: input.zipCode,
    sqft: input.sqft,
    bedrooms: input.bedrooms,
    bathrooms: input.bathrooms,
    notes: input.notes,
    flaggedNonStandard: !!input.flagNonStandard,
    source: "onboarding",
    actorName: input.byName,
  });
  if (!registered.ok) return { ok: false, status: registered.status, message: registered.message };

  await supabase.from("property_manager_onboarding_session_items").insert({
    session_id: input.session.id,
    pm_account_id: input.session.pm_account_id,
    kind: "additional_unit",
    unit_id: registered.unitId || null,
    requested_label: clip(input.unitLabel, 120) || null,
    requested_address: address,
    requested_sqft: input.sqft ?? null,
    requested_bedrooms: input.bedrooms ?? null,
    requested_bathrooms: input.bathrooms ?? null,
    requested_notes: clip(input.notes, 2000) || null,
    auto_priced: !!registered.autoPriced,
    submitted_by_name: input.byName,
    status: registered.autoPriced ? "actioned" : "pending",
  });

  // An added unit joins the registry after the snapshot was frozen. It is
  // deliberately NOT added to the snapshot: Page 2 is the schedule attached
  // to the signature, and a unit added afterwards belongs to the live
  // registry the portal shows, not to the signed exhibit.
  await supabase
    .from("property_manager_onboarding_sessions")
    .update({ last_activity_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", input.session.id as string);

  return {
    ok: true,
    status: 200,
    unitId: registered.unitId,
    autoPriced: !!registered.autoPriced,
    message: registered.message,
  };
}

// ─── Page 3: billing ───────────────────────────────────────────────────────

/**
 * Record the billing choice. Invoiced needs nothing but the choice — that is
 * why it is the default for this type. Auto-Pay hands back a Stripe
 * client secret so the card is captured in the same page.
 */
export async function configureBilling(
  supabase: Admin,
  input: {
    session: Row;
    account: Row;
    billingMethod: PmBillingMethod;
    billingEmail?: string;
  },
): Promise<{
  ok: boolean;
  status: number;
  message: string;
  needsCard?: boolean;
  clientSecret?: string;
}> {
  const gate = requireSigned(input.session);
  if (gate) return { ok: false, status: 409, message: gate };
  if (!PM_BILLING_OPTIONS[input.billingMethod]) {
    return { ok: false, status: 400, message: "Choose Invoiced or Auto-Pay." };
  }

  const now = new Date().toISOString();
  const email =
    clip(input.billingEmail, 200) ||
    clip(input.account.email, 200) ||
    clip(input.session.recipient_email, 200);
  if (!email) {
    return { ok: false, status: 400, message: "Add a billing email so we know where invoices go." };
  }

  await supabase
    .from("property_manager_accounts")
    .update({ billing_method: input.billingMethod, email })
    .eq("id", input.session.pm_account_id as string);

  if (input.billingMethod === "invoiced") {
    await supabase
      .from("property_manager_onboarding_sessions")
      .update({
        billing_method: "invoiced",
        billing_configured_at: now,
        last_completed_step: "billing",
        last_activity_at: now,
        updated_at: now,
      })
      .eq("id", input.session.id as string);
    return {
      ok: true,
      status: 200,
      needsCard: false,
      message: "Set. You'll get one consolidated invoice per period, itemized by unit.",
    };
  }

  const stripeKey = await resolveAppSecret("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    return {
      ok: false,
      status: 503,
      message: "Card setup is temporarily unavailable. Choose Invoiced, or reply to the email and we'll help.",
    };
  }

  try {
    const customerId = await ensurePmCustomer(stripeKey, {
      pmAccountId: String(input.session.pm_account_id),
      email,
      companyName: clip(input.account.company_name, 200) || "Property manager",
      existingId: (input.account.stripe_customer_id as string) || null,
    });
    await supabase
      .from("property_manager_accounts")
      .update({ stripe_customer_id: customerId })
      .eq("id", input.session.pm_account_id as string);

    const intent = await stripeCall(stripeKey, "POST", "setup_intents", {
      customer: customerId,
      usage: "off_session",
      "payment_method_types[0]": "card",
      "metadata[pm_account_id]": String(input.session.pm_account_id),
      "metadata[session_id]": String(input.session.id),
    });

    await supabase
      .from("property_manager_onboarding_sessions")
      .update({
        billing_method: "auto_pay",
        stripe_setup_session_id: String(intent.id),
        last_activity_at: now,
        updated_at: now,
      })
      .eq("id", input.session.id as string);

    return {
      ok: true,
      status: 200,
      needsCard: true,
      clientSecret: String(intent.client_secret || ""),
      message: "Add the card you'd like us to charge each period.",
    };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      message: err instanceof Error ? err.message : "Stripe couldn't start card setup.",
    };
  }
}

/** Confirm the Auto-Pay card landed, and mark billing configured. */
export async function confirmBillingCard(
  supabase: Admin,
  input: { session: Row; account: Row },
): Promise<{ ok: boolean; status: number; message: string; cardOnFile?: boolean }> {
  const gate = requireSigned(input.session);
  if (gate) return { ok: false, status: 409, message: gate };

  const intentId = String(input.session.stripe_setup_session_id || "");
  if (!intentId.startsWith("seti_")) {
    return { ok: false, status: 409, message: "Start card setup first." };
  }
  const stripeKey = await resolveAppSecret("STRIPE_SECRET_KEY");
  if (!stripeKey) return { ok: false, status: 503, message: "Card setup is temporarily unavailable." };

  try {
    const intent = await stripeCall(stripeKey, "GET", `setup_intents/${intentId}`);
    const paymentMethodId = intent?.payment_method ? String(intent.payment_method) : null;
    if (String(intent?.status) !== "succeeded" || !paymentMethodId) {
      return { ok: false, status: 409, cardOnFile: false, message: "We haven't seen the card yet." };
    }

    const customerId = String(intent.customer || input.account.stripe_customer_id || "");
    if (customerId) {
      await stripeCall(stripeKey, "POST", `customers/${customerId}`, {
        "invoice_settings[default_payment_method]": paymentMethodId,
      }).catch(() => null);
    }

    const now = new Date().toISOString();
    await supabase
      .from("property_manager_accounts")
      .update({ default_payment_method_id: paymentMethodId, stripe_customer_id: customerId || null })
      .eq("id", input.session.pm_account_id as string);
    await supabase
      .from("property_manager_onboarding_sessions")
      .update({
        payment_method_id: paymentMethodId,
        billing_configured_at: now,
        last_completed_step: "billing",
        last_activity_at: now,
        updated_at: now,
      })
      .eq("id", input.session.id as string);

    return { ok: true, status: 200, cardOnFile: true, message: "Card on file." };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      message: err instanceof Error ? err.message : "Stripe couldn't confirm the card.",
    };
  }
}

async function ensurePmCustomer(
  stripeKey: string,
  args: { pmAccountId: string; email: string; companyName: string; existingId?: string | null },
): Promise<string> {
  if (args.existingId) return args.existingId;
  const found = await stripeCall(stripeKey, "GET", "customers", { email: args.email, limit: "1" });
  const existing = found?.data?.[0]?.id as string | undefined;
  if (existing) return existing;
  const created = await stripeCall(stripeKey, "POST", "customers", {
    email: args.email,
    name: args.companyName,
    "metadata[pm_account_id]": args.pmAccountId,
    "metadata[kind]": "property_manager",
  });
  return String(created.id);
}

// ─── Page 3: portal ────────────────────────────────────────────────────────

/**
 * Provision portal access in the same page billing was configured on, so the
 * session ends on a confirmation with a working link rather than a promise
 * that an invitation is coming.
 */
export async function provisionPmPortal(
  supabase: Admin,
  input: { session: Row; account: Row; email?: string; fullName?: string },
): Promise<{ ok: boolean; status: number; message: string; portalUrl: string; handoffUrl?: string }> {
  const gate = requireSigned(input.session);
  if (gate) return { ok: false, status: 409, message: gate, portalUrl: portalUrl() };

  if (!input.session.billing_configured_at) {
    return {
      ok: false,
      status: 409,
      message: "Set your billing preference first.",
      portalUrl: portalUrl(),
    };
  }

  const { provisionPropertyManagerPortalAccess } = await import("@/lib/partner-portal/handoff");
  const email = String(
    input.email || input.account.email || input.session.recipient_email || "",
  )
    .trim()
    .toLowerCase();
  if (!email) {
    return { ok: false, status: 400, message: "No email to open the portal with.", portalUrl: portalUrl() };
  }

  const access = await provisionPropertyManagerPortalAccess({
    email,
    pmAccountId: String(input.session.pm_account_id),
    displayName: input.fullName || (input.account.contact_name as string) || null,
    phone: (input.account.phone as string) || null,
    sessionId: String(input.session.id),
  });
  if (!access.ok) {
    return {
      ok: false,
      status: 502,
      message: access.error || "Could not open portal access.",
      portalUrl: portalUrl(),
    };
  }

  await supabase.from("events").insert({
    event_type: "property_manager.onboarding.portal_provisioned",
    source: "property-manager-onboarding",
    summary: `Portal access opened for ${String(input.account.company_name || email)}.`,
    data: { pm_account_id: input.session.pm_account_id, session_id: input.session.id },
  });

  return {
    ok: true,
    status: 200,
    message: "You're set up. Your portfolio is waiting in the portal.",
    portalUrl: access.handoffUrl || portalUrl(),
    handoffUrl: access.handoffUrl,
  };
}

// ─── Shared ────────────────────────────────────────────────────────────────

export function escapeHtml(value: string): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
    source: "property-manager-onboarding",
    summary: input.summary,
    data: input.data,
  });

  const { data: setting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "property_manager_settings")
    .maybeSingle();
  const notify =
    (setting?.value as { notify_email?: string } | null)?.notify_email ||
    process.env.PROPERTY_MANAGER_NOTIFY_EMAIL ||
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
    vars: { subject_line: input.subject, body_html: input.html },
  }).catch(() => null);
}

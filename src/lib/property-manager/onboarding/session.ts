// ─── Tokenized property-manager onboarding session ─────────────────────────
//
// One link, one continuous visit: Legal → Unit Registry & Rates → Billing &
// Portal. Resolution, derived progress, and the payload the page renders live
// here.
//
// Same discipline as the Host session: this row is a delivery wrapper, not a
// second source of truth. Rates come from the frozen registry snapshot, the
// signature lives on `property_manager_agreements`, portal access lives on
// the identity tables, and the step is derived rather than stored — a session
// cannot claim Page 2 is open when Page 1 was never signed.

import { PARTNER_ORIGIN, portalHomeUrl } from "@/lib/partner-portal/origins";
import { PM_SERVICE_LABELS, PM_SERVICE_TYPES, type PmServiceType } from "../pricing";
import { PM_BILLING_OPTIONS, type PmBillingMethod } from "./agreement";
import { derivePmOnboardingProgress, type PmOnboardingProgress, type UnitDecision } from "./progress";

// eslint-disable-next-line
type Admin = any;
type Row = Record<string, unknown>;

export const PM_ONBOARDING_PATH = "/partner/property-manager-onboarding";

export function onboardingUrl(token: string): string {
  return `${PARTNER_ORIGIN}${PM_ONBOARDING_PATH}/${token}`;
}

export function portalUrl(): string {
  return portalHomeUrl();
}

export const SESSION_COLS = `
  id, pm_account_id, agreement_id, unit_snapshot, token, expires_at, status,
  recipient_name, recipient_email, recipient_phone,
  billing_method, billing_configured_at, stripe_setup_session_id, payment_method_id,
  portal_user_id, portal_provisioned_at,
  signed_at, signer_name, registry_confirmed_at,
  sent_at, send_count, first_viewed_at, last_viewed_at, view_count,
  last_activity_at, last_completed_step, completed_at, created_by_name, created_at
`;

export interface Resolved {
  ok: boolean;
  status: number;
  reason: string;
  message: string;
  session: Row | null;
}

function refuse(status: number, reason: string, message: string): Resolved {
  return { ok: false, status, reason, message, session: null };
}

export async function resolveSession(supabase: Admin, token: string): Promise<Resolved> {
  if (!token || token.length < 24) {
    return refuse(404, "invalid", "This onboarding link isn't valid.");
  }

  const { data } = await supabase
    .from("property_manager_onboarding_sessions")
    .select(SESSION_COLS)
    .eq("token", token)
    .maybeSingle();
  const session = (data || null) as Row | null;

  if (!session) {
    return refuse(
      404,
      "invalid",
      "This onboarding link is no longer valid. If you've already finished, you're all set — " +
        "nothing else is needed.",
    );
  }

  const status = String(session.status || "");
  if (status === "superseded") {
    return refuse(
      410,
      "superseded",
      "A newer version of this onboarding has been sent. Please use the most recent email or text.",
    );
  }
  if (status === "cancelled") {
    return refuse(410, "cancelled", "This onboarding was cancelled. Reply to us if that's a surprise.");
  }

  const expires = session.expires_at ? new Date(String(session.expires_at)).getTime() : 0;
  if (status === "active" && expires && expires < Date.now()) {
    return refuse(
      410,
      "expired",
      "This onboarding link has expired. Reply to the email and we'll send a fresh one.",
    );
  }

  return { ok: true, status: 200, reason: "ok", message: "", session };
}

// ─── The frozen registry snapshot ──────────────────────────────────────────

export interface SnapshotUnit {
  unit_id: string;
  unit_label: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  sqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  zone_code: string | null;
  /** Standing (what they pay) rate per service, in cents. */
  rates: Record<PmServiceType, number>;
  discount_percent: number;
  special_notes: string | null;
}

/**
 * A snapshot row only counts if it carries a rate for every service. The
 * whole promise of Page 2 is that the manager reads finished numbers, so a
 * half-priced unit does not belong on it.
 */
export function parseSnapshot(raw: unknown): SnapshotUnit[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const r = (row || {}) as Row;
      const id = String(r.unit_id || r.id || "");
      const rawRates = (r.rates || {}) as Record<string, unknown>;
      const rates = {} as Record<PmServiceType, number>;
      let complete = true;
      for (const service of PM_SERVICE_TYPES) {
        const cents = Number(rawRates[service]);
        if (!Number.isFinite(cents) || cents <= 0) complete = false;
        rates[service] = Number.isFinite(cents) ? Math.round(cents) : 0;
      }
      if (!id || !complete) return null;
      return {
        unit_id: id,
        unit_label: (r.unit_label as string) || null,
        address: (r.address as string) || null,
        city: (r.city as string) || null,
        state: (r.state as string) || null,
        zip_code: (r.zip_code as string) || null,
        sqft: r.sqft == null ? null : Number(r.sqft),
        bedrooms: r.bedrooms == null ? null : Number(r.bedrooms),
        bathrooms: r.bathrooms == null ? null : Number(r.bathrooms),
        zone_code: (r.zone_code as string) || null,
        rates,
        discount_percent: Number(r.discount_percent || 0),
        special_notes: (r.special_notes as string) || null,
      } satisfies SnapshotUnit;
    })
    .filter((u): u is SnapshotUnit => !!u);
}

export async function loadItems(supabase: Admin, sessionId: string): Promise<Row[]> {
  const { data } = await supabase
    .from("property_manager_onboarding_session_items")
    .select(
      "id, kind, unit_id, decision, note, requested_label, requested_address, requested_sqft, " +
        "requested_bedrooms, requested_bathrooms, requested_notes, auto_priced, status, created_at",
    )
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  return (data || []) as Row[];
}

export function decisionsFromItems(items: Row[]): UnitDecision[] {
  return items
    .filter((i) => i.kind === "unit_decision" && i.unit_id && i.decision)
    .map((i) => ({
      unitId: String(i.unit_id),
      decision: i.decision === "flagged" ? "flagged" : "confirmed",
    }));
}

export async function loadProgress(
  supabase: Admin,
  session: Row,
  account?: Row | null,
): Promise<PmOnboardingProgress> {
  const items = await loadItems(supabase, String(session.id));
  const snapshot = parseSnapshot(session.unit_snapshot);
  const acct = account || null;
  return derivePmOnboardingProgress({
    signed: !!(session.signed_at || session.agreement_id),
    snapshotUnitIds: snapshot.map((u) => u.unit_id),
    decisions: decisionsFromItems(items),
    billingMethod: (session.billing_method as PmBillingMethod) || null,
    billingConfirmed: !!session.billing_configured_at,
    paymentMethodOnFile: !!(session.payment_method_id || acct?.default_payment_method_id),
    portalReady: !!(session.portal_user_id || session.portal_provisioned_at || acct?.portal_provisioned_at),
  });
}

export async function touchActivity(supabase: Admin, sessionId: string, step?: string): Promise<void> {
  await supabase
    .from("property_manager_onboarding_sessions")
    .update({
      last_activity_at: new Date().toISOString(),
      ...(step ? { last_completed_step: step } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);
}

export async function closeIfComplete(
  supabase: Admin,
  session: Row,
  progress: PmOnboardingProgress,
): Promise<boolean> {
  if (!progress.complete || session.status !== "active") return false;
  const now = new Date().toISOString();
  await supabase
    .from("property_manager_onboarding_sessions")
    .update({ status: "completed", completed_at: now, updated_at: now })
    .eq("id", session.id as string);

  await supabase
    .from("property_manager_accounts")
    .update({ status: "active" })
    .eq("id", session.pm_account_id as string);

  await supabase.from("events").insert({
    event_type: "property_manager.onboarding.completed",
    source: "property-manager-onboarding",
    summary: `Property manager onboarding completed for ${String(session.recipient_email || session.pm_account_id)}.`,
    data: {
      pm_account_id: session.pm_account_id,
      session_id: session.id,
      billing_method: session.billing_method,
    },
  });
  return true;
}

// ─── Payload the page renders ──────────────────────────────────────────────

export interface PmSessionPayload {
  session: {
    id: string;
    status: string;
    recipientName: string | null;
    expiresAt: string | null;
    completedAt: string | null;
    billingMethod: string | null;
  };
  progress: PmOnboardingProgress;
  account: {
    id: string;
    companyName: string | null;
    contactName: string | null;
    email: string | null;
    hasPortal: boolean;
    cardOnFile: boolean;
    invoiceCycle: string | null;
    netTerms: string | null;
    volumeDiscountPercent: number;
    volumeDiscountLabel: string | null;
  };
  units: Array<
    SnapshotUnit & {
      decision: "confirmed" | "flagged" | null;
      flagNote: string | null;
      rateLines: Array<{ service: PmServiceType; label: string; cents: number }>;
      rateEditable: false;
    }
  >;
  addedUnits: Row[];
  billingOptions: Array<(typeof PM_BILLING_OPTIONS)[PmBillingMethod]>;
  portalUrl: string;
  agreementSignedAt: string | null;
  signerName: string | null;
}

export async function sessionPayload(supabase: Admin, session: Row): Promise<PmSessionPayload> {
  const pmAccountId = String(session.pm_account_id);
  const [{ data: account }, items] = await Promise.all([
    supabase
      .from("property_manager_accounts")
      .select(
        "id, company_name, contact_name, email, phone, user_id, portal_provisioned_at, default_payment_method_id, stripe_customer_id, invoice_cycle, net_terms, volume_discount_percent, volume_discount_label",
      )
      .eq("id", pmAccountId)
      .maybeSingle(),
    loadItems(supabase, String(session.id)),
  ]);

  const acct = (account || {}) as Row;
  const progress = await loadProgress(supabase, session, acct);
  const snapshot = parseSnapshot(session.unit_snapshot);
  const decisionByUnit = new Map(
    items.filter((i) => i.kind === "unit_decision").map((i) => [String(i.unit_id), i]),
  );

  return {
    session: {
      id: String(session.id),
      status: String(session.status),
      recipientName: (session.recipient_name as string) || (acct.contact_name as string) || null,
      expiresAt: (session.expires_at as string) || null,
      completedAt: (session.completed_at as string) || null,
      billingMethod: (session.billing_method as string) || "invoiced",
    },
    progress,
    account: {
      id: pmAccountId,
      companyName: (acct.company_name as string) || null,
      contactName: (acct.contact_name as string) || (session.recipient_name as string) || null,
      email: (acct.email as string) || (session.recipient_email as string) || null,
      hasPortal: !!(session.portal_user_id || session.portal_provisioned_at || acct.portal_provisioned_at),
      cardOnFile: !!(session.payment_method_id || acct.default_payment_method_id),
      invoiceCycle: (acct.invoice_cycle as string) || "monthly",
      netTerms: (acct.net_terms as string) || null,
      volumeDiscountPercent: Number(acct.volume_discount_percent || 0),
      volumeDiscountLabel: (acct.volume_discount_label as string) || null,
    },
    units: snapshot.map((u) => {
      const d = decisionByUnit.get(u.unit_id);
      return {
        ...u,
        decision:
          d?.decision === "flagged" ? "flagged" : d?.decision === "confirmed" ? "confirmed" : null,
        flagNote: (d?.note as string) || null,
        rateLines: PM_SERVICE_TYPES.map((service) => ({
          service,
          label: PM_SERVICE_LABELS[service],
          cents: u.rates[service],
        })),
        rateEditable: false as const,
      };
    }),
    addedUnits: items.filter((i) => i.kind === "additional_unit"),
    billingOptions: Object.values(PM_BILLING_OPTIONS),
    portalUrl: portalUrl(),
    agreementSignedAt: (session.signed_at as string) || null,
    signerName: (session.signer_name as string) || null,
  };
}

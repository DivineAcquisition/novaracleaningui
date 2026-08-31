// ─── Tokenized host onboarding session ─────────────────────────────────────
//
// One token, one continuous visit: Legal → Rates → Payment. Resolution,
// derived progress, and the payload the host page renders all live here.
//
// The session is a delivery wrapper. Rates come from the frozen proposal
// snapshot. Signature lives on host_partnership_agreements. Payment method
// lives on hosts. The step is derived — a session cannot claim Page 2 is
// open when Page 1 was never signed.

import { PAYMENT_OPTIONS, type PaymentOptionKey } from "./agreement";
import {
  deriveHostOnboardingProgress,
  type HostOnboardingProgress,
  type PropertyDecision,
} from "./progress";

// eslint-disable-next-line
type Admin = any;
type Row = Record<string, unknown>;

const PARTNER_ORIGIN =
  process.env.NEXT_PUBLIC_PARTNER_ORIGIN ||
  process.env.PARTNER_ORIGIN ||
  "https://partner.novaracleaning.com";

const PARTNERS_ORIGIN = "https://partners.novaracleaning.com";

export const HOST_ONBOARDING_PATH = "/partner/host-onboarding";

export function onboardingUrl(token: string): string {
  return `${PARTNER_ORIGIN.replace(/\/+$/, "")}${HOST_ONBOARDING_PATH}/${token}`;
}

/** Confirmation link into the host portal (partners.* is the alias the brief uses). */
export function portalUrl(): string {
  return `${PARTNERS_ORIGIN.replace(/\/+$/, "")}/partner`;
}

export const SESSION_COLS = `
  id, host_id, submission_id, agreement_id, property_snapshot, token, expires_at,
  status, recipient_name, recipient_email, recipient_phone, pay_after_enabled,
  payment_option, stripe_setup_session_id, payment_method_id, payment_setup_at,
  portal_user_id, portal_provisioned_at, signed_at, signer_name, rates_confirmed_at,
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
    .from("host_onboarding_sessions")
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

export interface SnapshotProperty {
  property_id: string;
  nickname: string | null;
  address: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  turnover_price: number;
  linen: boolean;
  restock: boolean;
  special_notes: string | null;
}

export function parseSnapshot(raw: unknown): SnapshotProperty[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const r = (row || {}) as Row;
      const id = String(r.property_id || r.id || "");
      const price = Number(r.turnover_price);
      if (!id || !Number.isFinite(price) || price <= 0) return null;
      return {
        property_id: id,
        nickname: (r.nickname as string) || null,
        address: (r.address as string) || null,
        bedrooms: r.bedrooms == null ? null : Number(r.bedrooms),
        bathrooms: r.bathrooms == null ? null : Number(r.bathrooms),
        sqft: r.sqft == null ? null : Number(r.sqft),
        turnover_price: price,
        linen: !!(r.linen ?? r.laundry_included),
        restock: !!(r.restock ?? r.restock_included),
        special_notes: (r.special_notes as string) || null,
      } satisfies SnapshotProperty;
    })
    .filter((p): p is SnapshotProperty => !!p);
}

export async function loadItems(supabase: Admin, sessionId: string): Promise<Row[]> {
  const { data } = await supabase
    .from("host_onboarding_session_items")
    .select(
      "id, kind, property_id, decision, note, requested_nickname, requested_address, " +
        "requested_bedrooms, requested_bathrooms, requested_notes, status, created_at",
    )
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  return (data || []) as Row[];
}

export function decisionsFromItems(items: Row[]): PropertyDecision[] {
  return items
    .filter((i) => i.kind === "property_decision" && i.property_id && i.decision)
    .map((i) => ({
      propertyId: String(i.property_id),
      decision: i.decision === "flagged" ? "flagged" : "confirmed",
    }));
}

export async function loadProgress(supabase: Admin, session: Row, host?: Row | null): Promise<HostOnboardingProgress> {
  const items = await loadItems(supabase, String(session.id));
  const snapshot = parseSnapshot(session.property_snapshot);
  const hostRow = host || null;
  const paymentOnFile = !!(
    session.payment_method_id ||
    session.payment_setup_at ||
    hostRow?.default_payment_method_id
  );
  return deriveHostOnboardingProgress({
    signed: !!(session.signed_at || session.agreement_id),
    snapshotPropertyIds: snapshot.map((p) => p.property_id),
    decisions: decisionsFromItems(items),
    paymentOption: (session.payment_option as PaymentOptionKey) || null,
    paymentMethodOnFile: paymentOnFile,
    portalReady: !!(session.portal_user_id || hostRow?.user_id),
    payAfterEnabled: !!(hostRow?.pay_after_enabled ?? session.pay_after_enabled),
  });
}

export async function touchActivity(
  supabase: Admin,
  sessionId: string,
  step?: string,
): Promise<void> {
  await supabase
    .from("host_onboarding_sessions")
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
  progress: HostOnboardingProgress,
): Promise<boolean> {
  if (!progress.complete || session.status !== "active") return false;
  await supabase
    .from("host_onboarding_sessions")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id as string);

  await supabase.from("events").insert({
    event_type: "host.onboarding.completed",
    source: "host-onboarding",
    summary: `Host onboarding completed for ${String(session.recipient_email || session.host_id)}.`,
    data: {
      host_id: session.host_id,
      session_id: session.id,
      payment_option: session.payment_option,
    },
  });
  return true;
}

export interface SessionPayload {
  session: {
    id: string;
    status: string;
    recipientName: string | null;
    expiresAt: string | null;
    completedAt: string | null;
    paymentOption: string | null;
    payAfterEnabled: boolean;
  };
  progress: HostOnboardingProgress;
  host: {
    id: string;
    name: string | null;
    email: string | null;
    entityType: string | null;
    entityName: string | null;
    hasPortal: boolean;
    cardOnFile: boolean;
  };
  properties: Array<
    SnapshotProperty & {
      decision: "confirmed" | "flagged" | null;
      flagNote: string | null;
      rateEditable: false;
    }
  >;
  additionalRequests: Row[];
  paymentOptions: Array<(typeof PAYMENT_OPTIONS)[PaymentOptionKey]>;
  portalUrl: string;
  agreementSignedAt: string | null;
  signerName: string | null;
}

export async function sessionPayload(supabase: Admin, session: Row): Promise<SessionPayload> {
  const hostId = String(session.host_id);
  const [{ data: host }, items, { data: submission }] = await Promise.all([
    supabase
      .from("hosts")
      .select("id, name, email, phone, user_id, default_payment_method_id, pay_after_enabled, stripe_customer_id")
      .eq("id", hostId)
      .maybeSingle(),
    loadItems(supabase, String(session.id)),
    session.submission_id
      ? supabase
          .from("host_onboarding_submissions")
          .select("entity_type, entity_name, full_name")
          .eq("id", session.submission_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const hostRow = (host || {}) as Row;
  const progress = await loadProgress(supabase, session, hostRow);
  const snapshot = parseSnapshot(session.property_snapshot);
  const decisionById = new Map(
    items
      .filter((i) => i.kind === "property_decision")
      .map((i) => [String(i.property_id), i]),
  );

  const payAfter = !!(hostRow.pay_after_enabled ?? session.pay_after_enabled);
  const options = (Object.values(PAYMENT_OPTIONS) as Array<(typeof PAYMENT_OPTIONS)[PaymentOptionKey]>).filter(
    (o) => o.key !== "pay_after" || payAfter,
  );

  return {
    session: {
      id: String(session.id),
      status: String(session.status),
      recipientName: (session.recipient_name as string) || (hostRow.name as string) || null,
      expiresAt: (session.expires_at as string) || null,
      completedAt: (session.completed_at as string) || null,
      paymentOption: (session.payment_option as string) || null,
      payAfterEnabled: payAfter,
    },
    progress,
    host: {
      id: hostId,
      name: (hostRow.name as string) || ((submission as Row | null)?.full_name as string) || null,
      email: (hostRow.email as string) || (session.recipient_email as string) || null,
      entityType: ((submission as Row | null)?.entity_type as string) || "individual",
      entityName: ((submission as Row | null)?.entity_name as string) || null,
      hasPortal: !!(session.portal_user_id || hostRow.user_id),
      cardOnFile: !!(session.payment_method_id || hostRow.default_payment_method_id),
    },
    properties: snapshot.map((p) => {
      const d = decisionById.get(p.property_id);
      return {
        ...p,
        decision: d?.decision === "flagged" ? "flagged" : d?.decision === "confirmed" ? "confirmed" : null,
        flagNote: (d?.note as string) || null,
        rateEditable: false as const,
      };
    }),
    additionalRequests: items.filter((i) => i.kind === "additional_property"),
    paymentOptions: options,
    portalUrl: portalUrl(),
    agreementSignedAt: (session.signed_at as string) || null,
    signerName: (session.signer_name as string) || null,
  };
}

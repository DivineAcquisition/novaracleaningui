// Localhost-only payloads so the three PM onboarding pages can be opened
// without a live session. Production tokens never hit this. Mirrors the
// host onboarding preview: `?step=` jumps, then the first POST strips it.

import { LANDING_UNIT_TAG } from "../landing";
import { estimateFromPricingSnapshot } from "../landing-server";
import {
  PM_SERVICE_LABELS,
  PM_SERVICE_TYPES,
  reviewDecisionForUnit,
  significantUnitCountChange,
  type PmServiceType,
} from "../pricing";
import { PM_BILLING_OPTIONS, type PmBillingMethod } from "./agreement";
import { derivePmOnboardingProgress } from "./progress";
import type { SnapshotUnit } from "./session";

export const PM_ONBOARDING_PREVIEW_TOKEN = "preview-property-manager";

export function isPmOnboardingPreviewToken(token: string): boolean {
  return token === PM_ONBOARDING_PREVIEW_TOKEN;
}

export function isLocalPreviewRequest(req: Request): boolean {
  const host = (req.headers.get("host") || "").toLowerCase();
  return (
    host.includes("localhost") ||
    host.startsWith("127.0.0.1") ||
    process.env.NODE_ENV === "development"
  );
}

type PreviewUnit = SnapshotUnit & {
  decision: "confirmed" | "flagged" | null;
  flagNote: string | null;
};

type AddedUnit = {
  id: string;
  kind: "additional_unit";
  requested_label: string;
  requested_address: string;
  auto_priced: boolean;
  count_review: boolean;
};

type PreviewMem = {
  signed: boolean;
  units: PreviewUnit[];
  added: AddedUnit[];
  billingMethod: PmBillingMethod;
  billingConfirmed: boolean;
  card: boolean;
  portal: boolean;
  invoiceCycle: string;
  netTerms: string;
  billingContactName: string;
  billingContactEmail: string;
  billingContactPhone: string;
};

function ratesFor(sqft: number, bedrooms: number, bathrooms: number, unitCount: number): Record<PmServiceType, number> {
  const estimate = estimateFromPricingSnapshot({
    mode: "mixed",
    portfolioZip: "21230",
    units: Array.from({ length: Math.max(1, unitCount) }, (_, i) => ({
      label: `Unit ${i + 1}`,
      sqft: i === 0 ? sqft : 980,
      bedrooms: i === 0 ? bedrooms : 2,
      bathrooms: i === 0 ? bathrooms : 1,
      zipCode: "21230",
    })),
  });
  const row = estimate?.unitEstimates[0];
  if (row && row.range.move_out.minCents > 0) {
    return {
      move_out: row.range.move_out.minCents,
      move_in: row.range.move_in.minCents,
      standard: row.range.standard.minCents,
    };
  }
  const base = Math.round(Math.max(700, sqft) * 28);
  return { move_out: base, move_in: base, standard: Math.round(base * 0.57) };
}

function seedUnit(
  id: string,
  label: string,
  address: string,
  sqft: number,
  bedrooms: number,
  bathrooms: number,
  unitCount: number,
): PreviewUnit {
  return {
    unit_id: id,
    unit_label: label,
    address,
    city: "Baltimore",
    state: "MD",
    zip_code: "21230",
    sqft,
    bedrooms,
    bathrooms,
    zone_code: "B",
    rates: ratesFor(sqft, bedrooms, bathrooms, unitCount),
    discount_percent: 0,
    special_notes: LANDING_UNIT_TAG,
    decision: null,
    flagNote: null,
  };
}

function seedUnits(): PreviewUnit[] {
  return [
    seedUnit("preview-pm-u1", "Adams St 2B", "118 Adams St", 980, 2, 1, 2),
    seedUnit("preview-pm-u2", "Adams St 3A", "118 Adams St", 1240, 3, 2, 2),
  ];
}

const previewMem: PreviewMem = {
  signed: false,
  units: seedUnits(),
  added: [],
  billingMethod: "invoiced",
  billingConfirmed: false,
  card: false,
  portal: false,
  invoiceCycle: "monthly",
  netTerms: "net_15",
  billingContactName: "Jordan Hale",
  billingContactEmail: "jordan@example.com",
  billingContactPhone: "",
};

export function resetPmOnboardingPreview(): void {
  previewMem.signed = false;
  previewMem.units = seedUnits();
  previewMem.added = [];
  previewMem.billingMethod = "invoiced";
  previewMem.billingConfirmed = false;
  previewMem.card = false;
  previewMem.portal = false;
  previewMem.invoiceCycle = "monthly";
  previewMem.netTerms = "net_15";
  previewMem.billingContactName = "Jordan Hale";
  previewMem.billingContactEmail = "jordan@example.com";
  previewMem.billingContactPhone = "";
}

export function applyPmOnboardingPreviewAction(
  action: string,
  body: Record<string, unknown>,
): {
  ok: boolean;
  status: number;
  message?: string;
  outcome?: string;
  autoPriced?: boolean;
  countReview?: boolean;
  unitId?: string;
  rates?: Record<string, number>;
  handoffUrl?: string;
  portalUrl?: string;
} {
  if (action === "sign") {
    previewMem.signed = true;
    return {
      ok: true,
      status: 200,
      outcome: "signed",
      message: "Signed. Next: confirm each unit and its Company-set Standing Rates.",
    };
  }
  if (
    !previewMem.signed &&
    ["decide_unit", "add_unit", "update_unit", "configure_billing", "confirm_billing", "create_portal"].includes(
      action,
    )
  ) {
    return {
      ok: false,
      status: 409,
      message: "Sign the Property Management Services Agreement first — Pages 2 and 3 open after that.",
    };
  }
  if (action === "decide_unit") {
    const id = String(body.unitId || "");
    const decision = body.decision === "flagged" ? "flagged" : "confirmed";
    const unit = previewMem.units.find((u) => u.unit_id === id);
    if (!unit) return { ok: false, status: 404, message: "That unit isn't on this registry." };
    unit.decision = decision;
    unit.flagNote = decision === "flagged" ? String(body.note || "") : null;
    return {
      ok: true,
      status: 200,
      outcome: decision,
      message: decision === "flagged" ? "Noted — that's with our team." : "Confirmed.",
    };
  }
  if (action === "update_unit") {
    const id = String(body.unitId || "");
    const unit = previewMem.units.find((u) => u.unit_id === id);
    if (!unit) return { ok: false, status: 404, message: "That unit isn't on this registry." };
    const sqft = Number(body.sqft);
    if (!(sqft > 0)) {
      return { ok: false, status: 400, message: "Add the unit's approximate square footage." };
    }
    unit.sqft = sqft;
    unit.bedrooms = body.bedrooms == null || body.bedrooms === "" ? unit.bedrooms : Number(body.bedrooms);
    unit.bathrooms = body.bathrooms == null || body.bathrooms === "" ? unit.bathrooms : Number(body.bathrooms);
    unit.rates = ratesFor(sqft, Number(unit.bedrooms || 0), Number(unit.bathrooms || 0), previewMem.units.length);
    unit.decision = null;
    unit.flagNote = null;
    return {
      ok: true,
      status: 200,
      outcome: "unit_updated",
      rates: unit.rates,
      message: "Standing Rates updated from the corrected size.",
    };
  }
  if (action === "add_unit") {
    const address = String(body.address || "").trim();
    if (address.length < 5) {
      return { ok: false, status: 400, message: "Add the unit's street address." };
    }
    const represented = seedUnits().length;
    const prospective = represented + previewMem.added.length + 1;
    const countChange = significantUnitCountChange(represented, prospective);
    const sqft = Number(body.sqft) || 0;
    const bedrooms = Number(body.bedrooms) || 0;
    const review = reviewDecisionForUnit({
      sqft: sqft || null,
      bedrooms: bedrooms || null,
      flaggedNonStandard: body.flagNonStandard === true,
    });
    const autoPriced = !review.needsReview;
    const id = `preview-pm-extra-${previewMem.added.length + 1}`;
    previewMem.added.push({
      id,
      kind: "additional_unit",
      requested_label: String(body.unitLabel || "").trim() || `Added unit ${previewMem.added.length + 1}`,
      requested_address: address,
      auto_priced: autoPriced,
      count_review: countChange.significant,
    });
    return {
      ok: true,
      status: 200,
      outcome: autoPriced ? "unit_added" : "unit_routed",
      unitId: id,
      autoPriced,
      countReview: countChange.significant,
      message: countChange.significant
        ? "Added. This add changes the represented unit count, so our team will review portfolio pricing (Section 5.2). You can keep going."
        : autoPriced
          ? "Unit added and priced. Confirm it when you're ready — it doesn't block Billing."
          : "That's with our team to price. You can keep going to Billing.",
    };
  }
  if (action === "configure_billing") {
    const method = String(body.billingMethod || "invoiced");
    if (method !== "invoiced" && method !== "auto_pay") {
      return { ok: false, status: 400, message: "Choose Invoiced or Auto-Pay." };
    }
    previewMem.billingMethod = method;
    previewMem.invoiceCycle = String(body.invoiceCycle || previewMem.invoiceCycle);
    previewMem.netTerms = String(body.netTerms || previewMem.netTerms);
    previewMem.billingContactName = String(body.billingContactName || previewMem.billingContactName);
    previewMem.billingContactEmail = String(body.billingEmail || previewMem.billingContactEmail);
    previewMem.billingContactPhone = String(body.billingContactPhone || previewMem.billingContactPhone);
    if (method === "auto_pay") {
      previewMem.card = true;
      previewMem.billingConfirmed = true;
      previewMem.portal = true;
      return {
        ok: true,
        status: 200,
        outcome: "billing_ready",
        message: "Auto-Pay is on file (preview). Your portfolio is waiting.",
        handoffUrl: "/partner?preview=property_manager",
        portalUrl: "/partner?preview=property_manager",
      };
    }
    previewMem.billingConfirmed = true;
    previewMem.portal = true;
    return {
      ok: true,
      status: 200,
      outcome: "billing_ready",
      message: "Invoiced billing confirmed. Your portfolio is waiting.",
      handoffUrl: "/partner?preview=property_manager",
      portalUrl: "/partner?preview=property_manager",
    };
  }
  if (action === "confirm_billing" || action === "billing_status") {
    previewMem.card = true;
    previewMem.billingConfirmed = true;
    previewMem.portal = true;
    return { ok: true, status: 200, outcome: "billing_ready", message: "Billing is set." };
  }
  if (action === "create_portal") {
    previewMem.portal = true;
    return {
      ok: true,
      status: 200,
      outcome: "portal_created",
      message: "Your portal is ready — no password needed.",
      handoffUrl: "/partner?preview=property_manager",
      portalUrl: "/partner?preview=property_manager",
    };
  }
  return { ok: false, status: 400, message: `Unknown action "${action}".` };
}

export function pmOnboardingPreviewPayload(step?: string) {
  if (step === "legal") resetPmOnboardingPreview();
  if (step === "registry") {
    previewMem.signed = true;
    previewMem.units = seedUnits();
    previewMem.added = [];
    previewMem.billingConfirmed = false;
    previewMem.card = false;
    previewMem.portal = false;
    previewMem.billingMethod = "invoiced";
  }
  if (step === "billing") {
    previewMem.signed = true;
    previewMem.units = seedUnits().map((u) => ({ ...u, decision: "confirmed" as const }));
    previewMem.added = [];
    previewMem.billingConfirmed = false;
    previewMem.card = false;
    previewMem.portal = false;
    previewMem.billingMethod = "invoiced";
  }
  if (step === "done") {
    previewMem.signed = true;
    previewMem.units = seedUnits().map((u) => ({ ...u, decision: "confirmed" as const }));
    previewMem.billingConfirmed = true;
    previewMem.card = false;
    previewMem.portal = true;
    previewMem.billingMethod = "invoiced";
  }

  const progress = derivePmOnboardingProgress({
    signed: previewMem.signed,
    snapshotUnitIds: previewMem.units.map((u) => u.unit_id),
    decisions: previewMem.units
      .filter((u) => u.decision)
      .map((u) => ({ unitId: u.unit_id, decision: u.decision as "confirmed" | "flagged" })),
    billingMethod: previewMem.billingMethod,
    billingConfirmed: previewMem.billingConfirmed,
    paymentMethodOnFile: previewMem.card,
    portalReady: previewMem.portal,
  });

  return {
    ok: true,
    session: {
      id: "preview-pm-session",
      status: progress.complete ? "completed" : "active",
      recipientName: "Jordan Hale",
      expiresAt: new Date(Date.now() + 14 * 86400_000).toISOString(),
      completedAt: progress.complete ? new Date().toISOString() : null,
      billingMethod: previewMem.billingMethod,
    },
    progress,
    account: {
      id: "preview-pm-1",
      companyName: "Keystone Residential Management",
      contactName: "Jordan Hale",
      email: "jordan@example.com",
      hasPortal: previewMem.portal,
      cardOnFile: previewMem.card,
      invoiceCycle: previewMem.invoiceCycle,
      netTerms: previewMem.netTerms,
      billingContactName: previewMem.billingContactName,
      billingContactEmail: previewMem.billingContactEmail,
      billingContactPhone: previewMem.billingContactPhone,
      volumeDiscountPercent: 0,
      volumeDiscountLabel: null,
    },
    units: previewMem.units.map((u) => ({
      ...u,
      rateLines: PM_SERVICE_TYPES.map((service) => ({
        service,
        label: PM_SERVICE_LABELS[service],
        cents: u.rates[service],
      })),
      rateEditable: false as const,
      claimedFromLanding: true,
    })),
    addedUnits: previewMem.added,
    billingOptions: Object.values(PM_BILLING_OPTIONS),
    portalUrl: "/partner?preview=property_manager",
    handoffUrl: previewMem.portal ? "/partner?preview=property_manager" : undefined,
    agreementSignedAt: previewMem.signed ? new Date().toISOString() : null,
    signerName: previewMem.signed ? "Jordan Hale" : null,
  };
}

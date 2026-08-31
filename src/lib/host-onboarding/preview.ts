// Localhost-only payloads so the three host-onboarding pages can be opened
// without a live session. Production tokens never hit this.

import { PAYMENT_OPTIONS } from "./agreement";
import { deriveHostOnboardingProgress } from "./progress";
import { portalUrl } from "./session";

export const HOST_ONBOARDING_PREVIEW_TOKEN = "preview-host";

export function isHostOnboardingPreviewToken(token: string): boolean {
  return token === HOST_ONBOARDING_PREVIEW_TOKEN;
}

export function isLocalHostRequest(req: Request): boolean {
  const host = (req.headers.get("host") || "").toLowerCase();
  return (
    host.includes("localhost") ||
    host.startsWith("127.0.0.1") ||
    process.env.NODE_ENV === "development"
  );
}

type PreviewMem = {
  signed: boolean;
  decisions: Array<{ propertyId: string; decision: "confirmed" | "flagged"; note?: string }>;
  extra: number;
  paymentOption: string | null;
  card: boolean;
  portal: boolean;
};

const previewMem: PreviewMem = {
  signed: false,
  decisions: [],
  extra: 0,
  paymentOption: null,
  card: false,
  portal: false,
};

export function resetHostOnboardingPreview(): void {
  previewMem.signed = false;
  previewMem.decisions = [];
  previewMem.extra = 0;
  previewMem.paymentOption = null;
  previewMem.card = false;
  previewMem.portal = false;
}

export function applyHostOnboardingPreviewAction(action: string, body: Record<string, unknown>): {
  ok: boolean;
  status: number;
  message?: string;
  outcome?: string;
  url?: string;
  handoffUrl?: string;
  portalUrl?: string;
} {
  if (action === "sign") {
    previewMem.signed = true;
    return { ok: true, status: 200, outcome: "signed", message: "Signed. Next: confirm each property and its Company-set rate." };
  }
  if (!previewMem.signed && ["decide_property", "request_property", "setup_payment", "payment_status", "create_portal"].includes(action)) {
    return { ok: false, status: 409, message: "Sign the Host Partnership Agreement first — Pages 2 and 3 open after that." };
  }
  if (action === "decide_property") {
    const id = String(body.propertyId || "");
    const decision = body.decision === "flagged" ? "flagged" : "confirmed";
    previewMem.decisions = previewMem.decisions.filter((d) => d.propertyId !== id);
    previewMem.decisions.push({ propertyId: id, decision, note: String(body.note || "") });
    return { ok: true, status: 200, outcome: decision, message: decision === "flagged" ? "Noted — that's with our team." : "Confirmed." };
  }
  if (action === "request_property") {
    if (String(body.address || "").trim().length < 5) {
      return { ok: false, status: 400, message: "Add the address of the property you'd like us to price." };
    }
    previewMem.extra += 1;
    return { ok: true, status: 200, outcome: "property_requested", message: "Thanks — that's with our team to price." };
  }
  if (action === "setup_payment") {
    const option = String(body.paymentOption || "");
    if (!["full", "split", "pay_after"].includes(option)) {
      return { ok: false, status: 400, message: "Choose a payment option." };
    }
    previewMem.paymentOption = option;
    previewMem.card = true;
    return { ok: true, status: 200, outcome: "payment_ready", message: "Payment method on file (preview)." };
  }
  if (action === "payment_status") {
    return { ok: true, status: 200, outcome: previewMem.card ? "payment_ready" : "payment_pending" };
  }
  if (action === "create_portal") {
    previewMem.portal = true;
    const handoffUrl = "/partner/enter/preview-host";
    return {
      ok: true,
      status: 200,
      outcome: "portal_created",
      message: "Your portal is ready — no password needed.",
      handoffUrl,
      portalUrl: handoffUrl,
    };
  }
  return { ok: false, status: 400, message: `Unknown action "${action}".` };
}

export function hostOnboardingPreviewPayload(step?: string) {
  if (step === "legal") resetHostOnboardingPreview();
  // `step` is a jump, not persistent state. The page strips it after the first
  // POST so a reload does not undo sign / rate decisions.
  if (step === "rates") {
    previewMem.signed = true;
    previewMem.decisions = [];
    previewMem.card = false;
    previewMem.portal = false;
  }
  if (step === "payment") {
    previewMem.signed = true;
    previewMem.decisions = [
      { propertyId: "preview-1", decision: "confirmed" },
      { propertyId: "preview-2", decision: "flagged", note: "Bathroom count looks high" },
    ];
    previewMem.card = false;
    previewMem.portal = false;
  }
  if (step === "done") {
    previewMem.signed = true;
    previewMem.decisions = [
      { propertyId: "preview-1", decision: "confirmed" },
      { propertyId: "preview-2", decision: "confirmed" },
    ];
    previewMem.paymentOption = "split";
    previewMem.card = true;
    previewMem.portal = true;
  }

  const payAfter = step !== "no-pay-after";
  const d1 = previewMem.decisions.find((d) => d.propertyId === "preview-1");
  const d2 = previewMem.decisions.find((d) => d.propertyId === "preview-2");
  const properties = [
    {
      property_id: "preview-1",
      nickname: "Harbor Loft",
      address: "1200 Light Street, Baltimore, MD 21230",
      bedrooms: 2,
      bathrooms: 2,
      sqft: 1100,
      turnover_price: 185,
      linen: true,
      restock: true,
      special_notes: null,
      decision: d1?.decision || null,
      flagNote: d1?.note || null,
      rateEditable: false as const,
    },
    {
      property_id: "preview-2",
      nickname: "Fells Point Row",
      address: "812 S Broadway, Baltimore, MD 21231",
      bedrooms: 3,
      bathrooms: 2.5,
      sqft: 1600,
      turnover_price: 225,
      linen: true,
      restock: false,
      special_notes: null,
      decision: d2?.decision || null,
      flagNote: d2?.note || null,
      rateEditable: false as const,
    },
  ];

  const progress = deriveHostOnboardingProgress({
    signed: previewMem.signed,
    snapshotPropertyIds: properties.map((p) => p.property_id),
    decisions: previewMem.decisions,
    paymentOption: previewMem.paymentOption,
    paymentMethodOnFile: previewMem.card,
    portalReady: previewMem.portal,
    payAfterEnabled: payAfter,
  });

  return {
    ok: true,
    session: {
      id: "preview-session",
      status: progress.complete ? "completed" : "active",
      recipientName: "Jordan Hale",
      expiresAt: new Date(Date.now() + 14 * 86400_000).toISOString(),
      completedAt: progress.complete ? new Date().toISOString() : null,
      paymentOption: previewMem.paymentOption,
      payAfterEnabled: payAfter,
    },
    progress,
    host: {
      id: "preview-host",
      name: "Jordan Hale",
      email: "jordan@example.com",
      entityType: "individual",
      entityName: null,
      hasPortal: previewMem.portal,
      cardOnFile: previewMem.card,
    },
    properties,
    additionalRequests: Array.from({ length: previewMem.extra }, (_, i) => ({
      id: `preview-extra-${i}`,
      kind: "additional_property",
      requested_nickname: "Requested property",
      requested_address: "400 E Pratt Street, Baltimore, MD",
    })),
    paymentOptions: Object.values(PAYMENT_OPTIONS).filter((o) => o.key !== "pay_after" || payAfter),
    portalUrl: previewMem.portal ? "/partner/enter/preview-host" : portalUrl(),
    handoffUrl: previewMem.portal ? "/partner/enter/preview-host" : undefined,
    agreementSignedAt: previewMem.signed ? new Date().toISOString() : null,
    signerName: previewMem.signed ? "Jordan Hale" : null,
  };
}

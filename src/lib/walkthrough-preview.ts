// Localhost-only fixture for the tokenized walkthrough page.
//
// Production walkthroughs resolve a commercial_walkthroughs.assignment_token.
// That table is not always on a given environment, and this VM has no
// service-role key, so the contractor UI cannot be exercised against a live
// row here. These tokens (`preview-str`, `preview-office`, `preview-commercial`)
// return the same payload shape as GET /api/walkthrough/[token] using the
// published site-findings catalog (no crew scope list).
//
// Host must be localhost / 127.0.0.1. Never served on contractor.novaracleaning.com.

import {
  DEFAULT_CHECKLISTS,
  propertyTypeByKey,
  walkthroughChecklistFor,
} from "@/lib/proposal-request";

export const WALKTHROUGH_PREVIEW_TOKENS = {
  "preview-str": "str",
  "preview-office": "office",
  "preview-commercial": "warehouse",
} as const;

export type WalkthroughPreviewToken = keyof typeof WALKTHROUGH_PREVIEW_TOKENS;

export function walkthroughPreviewTypeKey(token: string): string | null {
  return WALKTHROUGH_PREVIEW_TOKENS[token as WalkthroughPreviewToken] ?? null;
}

export function isLocalWalkthroughPreview(req: Request, token: string): boolean {
  if (!walkthroughPreviewTypeKey(token)) return false;
  const host = (req.headers.get("host") || "").toLowerCase();
  const hostname = host.split(":")[0];
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function walkthroughPreviewPayload(token: string) {
  const typeKey = walkthroughPreviewTypeKey(token);
  if (!typeKey) return null;
  const type = propertyTypeByKey(DEFAULT_CHECKLISTS, typeKey)
    || propertyTypeByKey(DEFAULT_CHECKLISTS, "other")!;
  const checklist = walkthroughChecklistFor(DEFAULT_CHECKLISTS, type.key);
  const sites: Record<string, { nickname: string; address: string; sqft: number }> = {
    str: {
      nickname: "Harbor Loft — preview",
      address: "418 E Pratt St, Baltimore, MD 21202",
      sqft: 980,
    },
    office: {
      nickname: "Suite 400 — preview",
      address: "100 Light St, Baltimore, MD 21202",
      sqft: 4200,
    },
    warehouse: {
      nickname: "Dock 2 — preview",
      address: "7200 Holabird Ave, Baltimore, MD 21222",
      sqft: 18000,
    },
  };
  const site = sites[typeKey] || sites.warehouse;
  return {
    ok: true,
    preview: true,
    expired: false,
    staffAccess: false,
    submitted: false,
    editable: true,
    status: "scheduled",
    walkthroughId: `preview-${type.key}`,
    propertyType: type,
    checklist,
    answers: {},
    photos: [],
    scheduledAt: new Date().toISOString(),
    site: {
      nickname: site.nickname,
      address: site.address,
      clientStatedSqft: site.sqft,
    },
    access: { name: "Site contact (preview)", phone: "410-555-0199" },
    account: { name: "Walkthrough QA", contact: "Preview" },
    cleaner: { name: "Preview agent" },
    exclusionCodes: {
      mold_over_threshold: "Mold past the threshold we service",
      active_infestation: "Active infestation",
      biohazard: "Biohazard",
      structural_hazard: "Structural hazard",
      other: "Other excluded condition",
    },
  };
}

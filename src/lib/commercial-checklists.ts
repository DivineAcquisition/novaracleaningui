// ─── Commercial / office customer checklists ─────────────────────────────
//
// Presentation layer over the addressable catalog in checklist-catalog.ts.
// Content is Edition 1.0 of docs/standard-cleaning-checklists.md; the catalog
// owns the wording and the stable item IDs, this file owns how a scope level
// is assembled and labeled for a customer or an admin.
//
// Cumulative by construction: Light ⊂ Standard ⊂ Detailed. Because membership
// lives on the item, a Detailed checklist renders the Light items themselves
// rather than a copy of them, so a signal against `commercial.light.restrooms`
// is one item's signal no matter which scope the job was priced at.
//
// Zone-specific photo sections are job-sized at dispatch (a 30,000 sqft site
// documents zone by zone) and are deliberately not part of the published
// template.

import {
  catalogSectionsFor,
  catalogItemsFor,
  type CatalogItem,
  type CatalogSection,
  type ChecklistCatalogKey,
} from "@/lib/checklist-catalog";

export type CommercialScopeKey = "light" | "standard" | "detailed";

export type CommercialChecklistKind = CommercialScopeKey | "office";

export interface CommercialChecklistSection {
  title: string;
  items: string[];
  /** Stable catalog IDs, index-aligned with `items`. */
  itemIds: string[];
}

export const COMMERCIAL_SCOPE_LABEL: Record<CommercialScopeKey, string> = {
  light: "Light",
  standard: "Standard",
  detailed: "Detailed",
};

const SCOPE_CATALOG_KEY: Record<CommercialScopeKey, ChecklistCatalogKey> = {
  light: "commercial_light",
  standard: "commercial_standard",
  detailed: "commercial_detailed",
};

export function catalogKeyForKind(kind: CommercialChecklistKind): ChecklistCatalogKey {
  return kind === "office" ? "office" : SCOPE_CATALOG_KEY[kind];
}

function toSection(section: CatalogSection): CommercialChecklistSection {
  return {
    title: section.title,
    items: section.items.map((i) => i.text),
    itemIds: section.items.map((i) => i.id),
  };
}

export const COMMERCIAL_ADD_ONS = [
  "Catering / event cleanup",
  "Deep bathroom detail (per restroom)",
  "Interior window wash beyond entry glass",
  "After-hours or weekend premium window",
  "Carpet extraction / floor machine pass",
];

/** Items a Light visit does not include — the Standard upgrade prompt. */
export const COMMERCIAL_STANDARD_EXTRAS: string[] = catalogItemsFor("commercial_standard")
  .filter((i) => !i.checklists.includes("commercial_light"))
  .map((i) => i.text);

/** Items a Standard visit does not include — the Detailed upgrade prompt. */
export const COMMERCIAL_DETAILED_EXTRAS: string[] = catalogItemsFor("commercial_detailed")
  .filter((i) => !i.checklists.includes("commercial_standard"))
  .map((i) => i.text);

export function parseCommercialScope(
  raw: string | null | undefined,
): CommercialScopeKey {
  const key = String(raw || "").toLowerCase().trim();
  if (key === "light" || key === "detailed" || key === "standard") return key;
  return "standard";
}

export function isCommercialChecklistKind(
  raw: string | null | undefined,
): raw is CommercialChecklistKind {
  const key = String(raw || "").toLowerCase().trim();
  return key === "light" || key === "standard" || key === "detailed" || key === "office";
}

/**
 * The list for one visit: the scope depth, or the office frequency checklist
 * when the job is office work. Mirrors what the crew works on site.
 */
export function commercialChecklistSectionsForJob(
  scope: CommercialScopeKey,
  office = false,
): CommercialChecklistSection[] {
  if (office) {
    // An office site is contracted by frequency, and its scope depth still
    // decides how deep each visit goes — so office jobs carry both.
    return [
      ...catalogSectionsFor("office").map(toSection),
      ...catalogSectionsFor(SCOPE_CATALOG_KEY[scope])
        .filter((s) => s.area !== "Universal rules")
        .map((s) => toSection({
          ...s,
          title: `${COMMERCIAL_SCOPE_LABEL[scope]} scope — depth for this site`,
        })),
      ...catalogSectionsFor(SCOPE_CATALOG_KEY[scope])
        .filter((s) => s.area === "Universal rules")
        .map(toSection),
    ];
  }
  return catalogSectionsFor(SCOPE_CATALOG_KEY[scope]).map(toSection);
}

/** Published template pages. */
export function commercialChecklistSections(
  kind: CommercialChecklistKind,
): CommercialChecklistSection[] {
  if (kind === "office") return catalogSectionsFor("office").map(toSection);
  return catalogSectionsFor(SCOPE_CATALOG_KEY[kind]).map(toSection);
}

export function commercialChecklistItems(kind: CommercialChecklistKind): CatalogItem[] {
  return catalogItemsFor(catalogKeyForKind(kind));
}

export function normalizeCommercialScopeKey(
  value: string | null | undefined,
): CommercialScopeKey | null {
  const key = String(value || "").toLowerCase().replace(/[\s-]/g, "_");
  if (key === "light" || key === "commercial_light") return "light";
  if (key === "detailed" || key === "commercial_detailed") return "detailed";
  if (
    key === "standard" ||
    key === "commercial" ||
    key === "commercial_standard" ||
    key === "office"
  ) {
    return "standard";
  }
  return null;
}

/** Public /checklist slug for a commercial or office booking. */
export function commercialChecklistSlug(
  serviceType?: string | null,
  scopeLevel?: string | null,
):
  | "commercial-light"
  | "commercial-standard"
  | "commercial-detailed"
  | "office" {
  const service = String(serviceType || "").toLowerCase().replace(/[\s-]/g, "_");
  if (service === "office") return "office";
  const scope = parseCommercialScope(scopeLevel || service.replace(/^commercial_?/, ""));
  return `commercial-${scope}`;
}

export function commercialChecklistPath(
  serviceType?: string | null,
  scopeLevel?: string | null,
): string {
  return `/checklist/${commercialChecklistSlug(serviceType, scopeLevel)}`;
}

export const TRY_CHECKLIST_ORIGIN = "https://try.novaracleaning.com";

export function commercialChecklistUrl(
  serviceType?: string | null,
  scopeLevel?: string | null,
): string {
  return `${TRY_CHECKLIST_ORIGIN}${commercialChecklistPath(serviceType, scopeLevel)}`;
}

/** Side-by-side Light / Standard / Detailed, built from catalog membership. */
export type CommercialComparisonRow = {
  itemId: string;
  label: string;
  light: boolean;
  standard: boolean;
  detailed: boolean;
};

export type CommercialComparisonGroup = {
  title: string;
  rows: CommercialComparisonRow[];
};

function comparisonRows(area: string): CommercialComparisonRow[] {
  return catalogItemsFor("commercial_detailed")
    .filter((i) => i.area === area)
    .map((i) => ({
      itemId: i.id,
      label: i.text,
      light: i.checklists.includes("commercial_light"),
      standard: i.checklists.includes("commercial_standard"),
      detailed: i.checklists.includes("commercial_detailed"),
    }));
}

export const COMMERCIAL_COMPARISON: CommercialComparisonGroup[] = [
  { title: "Every visit", rows: comparisonRows("Light scope") },
  { title: "Standard adds", rows: comparisonRows("Standard scope") },
  { title: "Detailed adds", rows: comparisonRows("Detailed scope") },
  { title: "Universal rules", rows: comparisonRows("Universal rules") },
];

/** Distinct scope levels on a proposal/agreement, Light → Detailed order. */
export function uniqueScopeKeysFromSites(
  sites: Array<{ scope_level?: string | null }>,
): CommercialScopeKey[] {
  const seen = new Set<CommercialScopeKey>();
  for (const site of sites) {
    seen.add(parseCommercialScope(site.scope_level));
  }
  if (seen.size === 0) seen.add("standard");
  return (["light", "standard", "detailed"] as const).filter((k) => seen.has(k));
}

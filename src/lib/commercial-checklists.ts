// ─── Commercial / office customer checklists ─────────────────────────────
//
// Customer-facing Light / Standard / Detailed (+ office extras). Item lists
// stay in lock-step with supabase/functions/_shared/contractor-checklists.ts
// so the public promise, the admin preview, and the crew list describe the
// same job. Zone-specific photo sections are job-sized at dispatch and are
// not part of these published templates.
//
// Each scope is the one before it PLUS more — same rule the price uses.

export type CommercialScopeKey = "light" | "standard" | "detailed";

export type CommercialChecklistKind = CommercialScopeKey | "office";

export interface CommercialChecklistSection {
  title: string;
  items: string[];
}

export const COMMERCIAL_ARRIVAL: CommercialChecklistSection = {
  title: "Arrival & setup",
  items: [
    "Check in per site access instructions (badge / code / contact)",
    "Notify the required contact on arrival (if specified)",
    "Confirm the alarm is disarmed per the security notes before starting",
    "Walk the site and note anything already damaged or blocked",
  ],
};

export const COMMERCIAL_LIGHT_ITEMS = [
  "Sweep and vacuum all floors in scope",
  "Empty all trash and recycling; replace liners; take to designated disposal",
  "Restrooms: disinfect toilets, sinks, counters, mirrors; restock supplies",
  "Spot-clean visible spills and marks",
];

export const COMMERCIAL_STANDARD_EXTRAS = [
  "Mop all hard floors",
  "Break room / kitchenette: counters, sink, appliance exteriors, tables",
  "Individual offices and rooms: surfaces wiped, trash pulled, floors done",
  "Wipe and disinfect touch points (handles, switches, rails)",
];

export const COMMERCIAL_DETAILED_EXTRAS = [
  "Scrub floors — grout lines, edges, and corners, not just the open middle",
  "High-touch sanitization pass: shared equipment, phones, rails, dispensers",
  "Detail dusting: ledges, sills, vents, fixtures, tops of partitions",
  "Interior glass and entry doors, streak-free",
];

export const COMMERCIAL_DOCUMENTATION: CommercialChecklistSection = {
  title: "Documentation",
  items: [
    "Take BEFORE photos of all areas in scope",
    "Take AFTER photos of every area cleaned",
  ],
};

export const COMMERCIAL_CLOSEOUT: CommercialChecklistSection = {
  title: "Close-out",
  items: [
    "Complete any deep tasks scheduled for this visit (per scope)",
    "Return all furniture and equipment to where you found it",
    "Secure the site per lock-up procedure (doors, alarm, lights)",
    "Notify the required contact on departure (if specified)",
  ],
};

export const OFFICE_RULES: CommercialChecklistSection = {
  title: "Office rules",
  items: [
    "Respect the desk policy — do NOT move or touch papers/electronics unless scope says otherwise",
    "Clean around workstations: wipe desks per policy, sanitize phones/shared equipment only if in scope",
    "Conference rooms: tables, chairs, glass, whiteboard trays (do not erase boards)",
    "Handle sensitive areas exactly per instructions (server rooms, exec offices)",
  ],
};

export const OFFICE_AFTER_HOURS: CommercialChecklistSection = {
  title: "After-hours close-out",
  items: [
    "Turn off lights per building instructions",
    "Set the alarm and lock up exactly per the security notes",
    "Badge out / check out with security if required",
  ],
};

export const COMMERCIAL_SCOPE_ITEMS: Record<CommercialScopeKey, string[]> = {
  light: COMMERCIAL_LIGHT_ITEMS,
  standard: [...COMMERCIAL_LIGHT_ITEMS, ...COMMERCIAL_STANDARD_EXTRAS],
  detailed: [...COMMERCIAL_LIGHT_ITEMS, ...COMMERCIAL_STANDARD_EXTRAS, ...COMMERCIAL_DETAILED_EXTRAS],
};

export const COMMERCIAL_SCOPE_LABEL: Record<CommercialScopeKey, string> = {
  light: "Light",
  standard: "Standard",
  detailed: "Detailed",
};

export const COMMERCIAL_ADD_ONS = [
  "Catering / event cleanup",
  "Deep bathroom detail (per restroom)",
  "Interior window wash beyond entry glass",
  "After-hours or weekend premium window",
  "Floor machine / scrubber pass",
];

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
 * Customer / admin layout for one visit: a scope depth, plus office extras
 * when the job is after-hours office work. Mirrors the crew builder.
 */
export function commercialChecklistSectionsForJob(
  scope: CommercialScopeKey,
  office = false,
): CommercialChecklistSection[] {
  const label = COMMERCIAL_SCOPE_LABEL[scope];
  const sections: CommercialChecklistSection[] = [
    COMMERCIAL_ARRIVAL,
    { title: `${label} scope — every area in this job`, items: [...COMMERCIAL_SCOPE_ITEMS[scope]] },
  ];
  if (office) sections.push(OFFICE_RULES);
  sections.push(COMMERCIAL_DOCUMENTATION);
  sections.push(COMMERCIAL_CLOSEOUT);
  if (office) sections.push(OFFICE_AFTER_HOURS);
  return sections;
}

/**
 * Published template pages. Office is Standard depth plus the office-only
 * rules; Light / Detailed office jobs still use those scope pages plus
 * the office extras at dispatch.
 */
export function commercialChecklistSections(
  kind: CommercialChecklistKind,
): CommercialChecklistSection[] {
  const office = kind === "office";
  const scope: CommercialScopeKey = office ? "standard" : kind;
  return commercialChecklistSectionsForJob(scope, office);
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

/** Side-by-side Light / Standard / Detailed — same idea as the home comparison. */
export type CommercialComparisonRow = {
  label: string;
  light: boolean;
  standard: boolean;
  detailed: boolean;
};

export type CommercialComparisonGroup = {
  title: string;
  rows: CommercialComparisonRow[];
};

export const COMMERCIAL_COMPARISON: CommercialComparisonGroup[] = [
  {
    title: "Every visit",
    rows: [
      { label: "Check-in, contact notify, alarm confirm, site walk", light: true, standard: true, detailed: true },
      { label: "Sweep and vacuum floors in scope", light: true, standard: true, detailed: true },
      { label: "Trash and recycling pulled; liners replaced", light: true, standard: true, detailed: true },
      { label: "Restrooms disinfected and restocked", light: true, standard: true, detailed: true },
      { label: "Spot-clean visible spills and marks", light: true, standard: true, detailed: true },
      { label: "Before and after photos of areas in scope", light: true, standard: true, detailed: true },
      { label: "Lock-up, lights, and departure notify", light: true, standard: true, detailed: true },
    ],
  },
  {
    title: "Standard adds",
    rows: [
      { label: "Mop all hard floors", light: false, standard: true, detailed: true },
      { label: "Break room / kitchenette (counters, sink, appliance exteriors)", light: false, standard: true, detailed: true },
      { label: "Individual offices and rooms wiped and floored", light: false, standard: true, detailed: true },
      { label: "Touch-point disinfection (handles, switches, rails)", light: false, standard: true, detailed: true },
    ],
  },
  {
    title: "Detailed adds",
    rows: [
      { label: "Floor scrub — grout, edges, and corners", light: false, standard: false, detailed: true },
      { label: "High-touch sanitization of shared equipment", light: false, standard: false, detailed: true },
      { label: "Detail dusting: ledges, sills, vents, partition tops", light: false, standard: false, detailed: true },
      { label: "Interior glass and entry doors, streak-free", light: false, standard: false, detailed: true },
    ],
  },
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

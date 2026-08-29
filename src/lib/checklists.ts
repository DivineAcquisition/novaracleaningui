// ─── Cleaning service checklists ──────────────────────────────────────
//
// Source of truth for the /checklist/* pages. Each residential entry
// mirrors the official PDF the customer receives after booking. Commercial
// Light / Standard / Detailed (+ office) live in commercial-checklists.ts
// and stay in lock-step with the crew list in contractor-checklists.ts.
//
// Edits here flow to:
//   • /checklist/[slug] pages
//   • Booking flow upsells (Offer.tsx links into these)
//   • Commercial hub / proposal / agreement previews
//   • Cleaner training material (Training.tsx pulls from this map)
//
// If a checklist line changes, update both the SOP doc and this file.

import {
  COMMERCIAL_ADD_ONS,
  COMMERCIAL_DETAILED_EXTRAS,
  COMMERCIAL_STANDARD_EXTRAS,
  commercialChecklistPath,
  commercialChecklistSections,
  commercialChecklistSlug,
} from "@/lib/commercial-checklists";

export type ChecklistFamily = "residential" | "commercial";

export type ChecklistSlug =
  | "standard-clean"
  | "deep-clean"
  | "move-in-out"
  | "recurring"
  | "commercial-light"
  | "commercial-standard"
  | "commercial-detailed"
  | "office";

export interface ChecklistSection {
  /** Heading shown on the card. */
  title: string;
  /** Each line item — a single short sentence, no leading bullet. */
  items: string[];
}

export interface Checklist {
  slug: ChecklistSlug;
  family: ChecklistFamily;
  name: string;
  /** Short subtitle right under the H1. */
  tagline: string;
  /** Full pitch paragraph at the top of the page. */
  description: string;
  /** Color accent for the page (Tailwind palette segment). */
  accent: "emerald" | "blue" | "purple" | "amber" | "slate" | "teal";
  /** Three header pills. */
  meta: {
    estimatedTime: string;
    bestFor: string;
    frequency: string;
  };
  /** Service-type ID this checklist maps to in the booking flow. */
  bookingServiceType: "standard" | "deep" | "moveInOut" | "membership" | "commercial" | "office";
  /** Optional ?serviceType= override when linking into /book/offer. */
  bookingHref: string;
  /** Kitchen / Bathrooms / All Rooms / etc. */
  sections: ChecklistSection[];
  /** "Not included" upgrade prompts. */
  notIncluded: string[];
  /** Heading shown above notIncluded list. */
  notIncludedHeading: string;
  /** Paid add-ons. */
  addOns: string[];
  /** What other checklist slug to recommend as a complementary service. */
  recommendedNextSlug?: ChecklistSlug;
  recommendedNextLabel?: string;
}

export const CHECKLISTS: Record<ChecklistSlug, Checklist> = {
  "standard-clean": {
    slug: "standard-clean",
    family: "residential",
    name: "Standard Clean",
    tagline: "Regular upkeep — keep your home looking its best",
    description:
      "Our Standard Clean is designed for homes that are already in good condition and just need a thorough refresh. It's the perfect choice for a one-time clean when your home is already well-maintained. If your home hasn't been professionally cleaned recently, we'd recommend starting with a Deep Clean.",
    accent: "emerald",
    meta: {
      estimatedTime: "2–3 hours for a typical home",
      bestFor: "Already-maintained homes needing a thorough refresh",
      frequency: "One-time service",
    },
    bookingServiceType: "standard",
    bookingHref: "/book/offer?serviceType=standard",
    sections: [
      {
        title: "Kitchen",
        items: [
          "Dust and spot-clean cabinet fronts",
          "Clean countertops",
          "Clean sink and polish faucet",
          "Dust small appliances and items on countertops",
          "Clean microwave (inside and out)",
          "Clean and polish oven and refrigerator exterior",
          "Clean and polish stove top and vent hood",
          "Vacuum and mop kitchen floor",
          "Remove trash, replace bag, wipe exterior",
        ],
      },
      {
        title: "Bathrooms",
        items: [
          "Clean mirrors (streak-free)",
          "Dust light fixtures",
          "Spot-clean cabinet fronts",
          "Scrub shower and tub",
          "Clean counters, sinks, and polish fixtures",
          "Disinfect toilet and surrounding area",
          "Vacuum bathroom rugs",
          "Remove trash, replace bag, wipe exterior",
          "Clean and disinfect bathroom floor",
        ],
      },
      {
        title: "All rooms",
        items: [
          "Remove cobwebs and dust ceiling fans",
          "Dust reachable light fixtures",
          "Dust wall art and A/C vents",
          "Disinfect light switches and door knobs",
          "Dust and spot-clean doors and door frames",
          "Dust window sills and ledges",
          "Dust baseboards and blinds",
          "Dust TVs, electronics, knick-knacks, picture frames, lamps",
          "Dust all furniture (polish as needed)",
          "Dust banisters and handrails",
          "Vacuum all floors and stairs; mop hard surfaces",
          "Vacuum upholstered furniture (where possible)",
          "Change linens and/or make beds",
          "Clean front and back door glass",
        ],
      },
    ],
    notIncludedHeading: "Not included — upgrade to Deep Clean for:",
    notIncluded: [
      "Hand-wiping baseboards, door frames, and blinds (Standard includes dusting only)",
      "Detail cleaning under stove burners",
      "Hand-polishing wood furniture",
      "Vacuuming underneath furniture",
      "Hand-wiping window sills (Standard includes dusting only)",
      "Inside cabinets, drawers, or appliances",
    ],
    addOns: [
      "Hand wash baseboards",
      "Clean oven interior",
      "Clean refrigerator and freezer interior",
      "Wash interior windows (reachable with 2-step stool)",
      "Hand wash wood blinds or shutters",
      "Interior cabinet and drawer cleaning",
    ],
    recommendedNextSlug: "deep-clean",
    recommendedNextLabel: "Step up to a Deep Clean",
  },

  "deep-clean": {
    slug: "deep-clean",
    family: "residential",
    name: "Deep Clean",
    tagline: "The reset your home needs — recommended for first cleans",
    description:
      "Our Deep Clean is the thorough reset your home deserves. It's the perfect first clean before starting recurring service, or a seasonal refresh for homes that haven't had a professional deep clean in a while. We hand-wipe the details a Standard Clean only dusts.",
    accent: "blue",
    meta: {
      estimatedTime: "4–6 hours for a typical home",
      bestFor: "First-time service, seasonal reset, or pre-recurring baseline",
      frequency: "One-time, or recommended 1–2x per year",
    },
    bookingServiceType: "deep",
    bookingHref: "/book/offer?serviceType=deep",
    sections: [
      {
        title: "Kitchen",
        items: [
          "Hand-wipe all cabinet exteriors",
          "Clean countertops",
          "Wipe backsplash",
          "Clean sink and polish faucets",
          "Hand-wipe small appliances and items on countertops",
          "Clean microwave (inside and out)",
          "Clean and polish oven and refrigerator exterior",
          "Clean and polish stove top and vent hood",
          "Detail-clean under electric range burners",
          "Vacuum and mop kitchen floor",
          "Remove trash, replace bag, wipe exterior",
        ],
      },
      {
        title: "Bathrooms",
        items: [
          "Clean mirrors (streak-free)",
          "Wipe all reachable light fixtures",
          "Wipe cabinet fronts",
          "Scrub shower and tub",
          "Clean counters, sinks, and polish fixtures",
          "Disinfect toilet and surrounding area",
          "Vacuum bathroom rugs",
          "Remove trash, replace bags, wipe exterior",
          "Clean and disinfect bathroom floor",
        ],
      },
      {
        title: "All rooms",
        items: [
          "Remove cobwebs",
          "Wipe all reachable light fixtures and ceiling fan blades",
          "Dust wall art and A/C vents",
          "Disinfect light switches and door knobs",
          "Hand-wipe door frames and doors",
          "Hand-wipe window sills and window ledges",
          "Dust baseboards and blinds",
          "Dust TVs, electronics, book tops, knick-knacks, lamps",
          "Hand-polish all wood furniture",
          "Dust banisters and handrails",
          "Vacuum floors and mop hard surface floors",
          "Vacuum under all furniture (where possible)",
          "Vacuum carpet edges with attachment",
          "Vacuum upholstered furniture and crevices",
          "Change linens and/or make beds",
          "Clean front and back door glass",
        ],
      },
    ],
    notIncludedHeading: "Not included — upgrade to Move In/Out for:",
    notIncluded: [
      "Inside cabinets and drawers",
      "Inside pantry",
      "Inside built-in cabinets or bookcases",
      "Inside oven, refrigerator, or freezer (available as add-on)",
    ],
    addOns: [
      "Hand wash baseboards (included in Deluxe)",
      "Clean oven interior",
      "Clean refrigerator and freezer interior",
      "Wash interior windows (reachable with 2-step stool)",
      "Hand wash wood blinds or shutters (included in Deluxe)",
    ],
    recommendedNextSlug: "recurring",
    recommendedNextLabel: "Lock in recurring after your Deep Clean",
  },

  "move-in-out": {
    slug: "move-in-out",
    family: "residential",
    name: "Move In / Move Out Clean",
    tagline: "Empty home service — ready for the next chapter",
    description:
      "Our Move In/Out Clean is designed for empty homes — whether you're preparing a new place to move into or finalizing your move out. Because the home is empty, we can reach every cabinet, drawer, and pantry that a regular clean can't. This service includes everything in a Deep Clean plus the interior of all cabinets, drawers, and built-ins.",
    accent: "purple",
    meta: {
      estimatedTime: "5–7 hours for a typical home",
      bestFor: "Moving in, moving out, end-of-lease, or pre-sale prep",
      frequency: "One-time service",
    },
    bookingServiceType: "moveInOut",
    bookingHref: "/book/offer?serviceType=moveInOut",
    sections: [
      {
        title: "Kitchen",
        items: [
          "Hand-wipe all cabinet exteriors",
          "Clean and wipe down pantry",
          "Vacuum out and wipe inside all cabinets and drawers",
          "Clean countertops",
          "Wipe backsplash",
          "Clean sink and polish faucets",
          "Clean microwave (inside and out)",
          "Clean and polish oven and refrigerator exterior",
          "Clean and polish stove top and vent hood",
          "Detail-clean under electric range burners",
          "Vacuum and mop kitchen floor",
        ],
      },
      {
        title: "Bathrooms",
        items: [
          "Clean mirrors (streak-free)",
          "Wipe all reachable light fixtures",
          "Wipe cabinet fronts",
          "Wipe out inside cabinets and drawers",
          "Scrub shower and tub",
          "Clean counters, sinks, and polish fixtures",
          "Disinfect toilet and surrounding area",
          "Clean and disinfect bathroom floor",
        ],
      },
      {
        title: "All rooms",
        items: [
          "Remove cobwebs",
          "Wipe all reachable light fixtures and ceiling fan blades",
          "Dust A/C vents",
          "Wipe inside and out of any built-in cabinets or bookcases",
          "Disinfect light switches and door knobs",
          "Hand-wipe door frames and doors",
          "Hand-wipe window sills and ledges",
          "Dust baseboards and blinds",
          "Dust banisters and handrails",
          "Vacuum floors and mop hard surface floors",
          "Vacuum carpet edges with attachment",
          "Clean front and back door glass",
        ],
      },
    ],
    notIncludedHeading: "Not included — available as add-ons:",
    notIncluded: [
      "Inside oven, refrigerator, or freezer (available as add-on)",
      "Exterior windows",
      "Wall washing (spot cleaning only)",
      "Carpet shampooing or steam cleaning",
      "Garage, attic, or basement deep cleaning",
    ],
    addOns: [
      "Hand wash baseboards",
      "Clean oven interior",
      "Clean refrigerator and freezer interior",
      "Wash interior windows (reachable with 2-step stool)",
      "Hand wash wood blinds or shutters",
    ],
  },

  "recurring": {
    slug: "recurring",
    family: "residential",
    name: "Recurring Clean",
    tagline: "Weekly • Biweekly • Monthly — consistent care for your home",
    description:
      "Our Recurring Clean keeps your home consistently fresh between visits. We recommend starting with a Deep Clean to set the baseline, then maintaining with weekly, biweekly, or monthly visits. Recurring clients also receive priority scheduling and preferred pricing.",
    accent: "amber",
    meta: {
      estimatedTime: "1.5–2.5 hours per visit (after initial Deep Clean)",
      bestFor: "Anyone who wants a consistently clean home without the hassle",
      frequency: "Weekly, biweekly, or monthly",
    },
    bookingServiceType: "membership",
    bookingHref: "/membership",
    sections: [
      {
        title: "Kitchen",
        items: [
          "Dust and spot-clean cabinet fronts",
          "Clean countertops",
          "Clean sink and polish faucet",
          "Dust small appliances and items on countertops",
          "Clean microwave (inside and out)",
          "Clean and polish oven and refrigerator exterior",
          "Clean and polish stove top and vent hood",
          "Vacuum and mop kitchen floor",
          "Remove trash, replace bag, wipe exterior",
        ],
      },
      {
        title: "Bathrooms",
        items: [
          "Clean mirrors (streak-free)",
          "Dust light fixtures",
          "Spot-clean cabinet fronts",
          "Scrub shower and tub",
          "Clean counters, sinks, and polish fixtures",
          "Disinfect toilet and surrounding area",
          "Vacuum bathroom rugs",
          "Remove trash, replace bag, wipe exterior",
          "Clean and disinfect bathroom floor",
        ],
      },
      {
        title: "All rooms",
        items: [
          "Remove cobwebs and dust ceiling fans",
          "Dust reachable light fixtures",
          "Dust wall art and A/C vents",
          "Disinfect light switches and door knobs",
          "Dust and spot-clean doors and door frames",
          "Dust window sills and ledges",
          "Dust baseboards and blinds",
          "Dust TVs, electronics, knick-knacks, picture frames, lamps",
          "Dust all furniture (polish as needed)",
          "Dust banisters and handrails",
          "Vacuum all floors and stairs; mop hard surfaces",
          "Vacuum upholstered furniture (where possible)",
          "Change linens and/or make beds",
          "Clean front and back door glass",
        ],
      },
    ],
    notIncludedHeading: "Not included — recommended upgrades:",
    notIncluded: [
      "Hand-wiping baseboards, door frames, and blinds (Recurring includes dusting only)",
      "Detail cleaning under stove burners",
      "Hand-polishing wood furniture",
      "Vacuuming underneath furniture",
      "Inside cabinets, drawers, or appliances",
      "Recommended: schedule a Deep Clean 1–2x per year to maintain best results",
    ],
    addOns: [
      "Hand wash baseboards",
      "Clean oven interior",
      "Clean refrigerator and freezer interior",
      "Wash interior windows (reachable with 2-step stool)",
      "Hand wash wood blinds or shutters",
      "Add a Deep Clean rotation (e.g., quarterly)",
    ],
    recommendedNextSlug: "deep-clean",
    recommendedNextLabel: "Schedule your baseline Deep Clean",
  },

  "commercial-light": {
    slug: "commercial-light",
    family: "commercial",
    name: "Commercial Light",
    tagline: "Trash, floors, restrooms — the nightly refresh",
    description:
      "Our Light commercial visit keeps a maintained facility presentable between deeper service. Crews sweep and vacuum, pull trash, reset restrooms, and spot-clean what is visible. If the site needs mopping, break-room work, or individual rooms wiped, step up to Standard.",
    accent: "slate",
    meta: {
      estimatedTime: "Sized to your square footage and window",
      bestFor: "Maintained offices, retail floors, and common areas",
      frequency: "Nightly or several times a week",
    },
    bookingServiceType: "commercial",
    bookingHref: "/commercial",
    sections: commercialChecklistSections("light"),
    notIncludedHeading: "Not included — upgrade to Standard for:",
    notIncluded: [...COMMERCIAL_STANDARD_EXTRAS],
    addOns: COMMERCIAL_ADD_ONS,
    recommendedNextSlug: "commercial-standard",
    recommendedNextLabel: "See Standard commercial scope",
  },

  "commercial-standard": {
    slug: "commercial-standard",
    family: "commercial",
    name: "Commercial Standard",
    tagline: "Light plus mopping, rooms, and touch-point disinfection",
    description:
      "Standard is the default commercial visit. It includes everything in Light, then mops hard floors, resets the break room, wipes individual offices and rooms, and disinfects handles, switches, and rails. Detailed adds scrubbing, high-touch sanitization, and glass.",
    accent: "teal",
    meta: {
      estimatedTime: "Sized to your square footage and window",
      bestFor: "Offices, medical waiting rooms, gyms, and most contracted sites",
      frequency: "Weekly, several times a week, or nightly",
    },
    bookingServiceType: "commercial",
    bookingHref: "/commercial",
    sections: commercialChecklistSections("standard"),
    notIncludedHeading: "Not included — upgrade to Detailed for:",
    notIncluded: [...COMMERCIAL_DETAILED_EXTRAS],
    addOns: COMMERCIAL_ADD_ONS,
    recommendedNextSlug: "commercial-detailed",
    recommendedNextLabel: "See Detailed commercial scope",
  },

  "commercial-detailed": {
    slug: "commercial-detailed",
    family: "commercial",
    name: "Commercial Detailed",
    tagline: "Standard plus scrubbing, sanitization, dusting, and glass",
    description:
      "Detailed is the reset pass: everything in Standard, then floor edges and grout, a high-touch sanitization of shared equipment, detail dusting of ledges and vents, and streak-free interior glass. Large sites are documented zone by zone so one photo pair never stands in for the whole building.",
    accent: "purple",
    meta: {
      estimatedTime: "Longer window or a larger crew than Standard",
      bestFor: "First visits, seasonal resets, medical, and high-touch facilities",
      frequency: "Periodic rotation, or standing scope on high-spec sites",
    },
    bookingServiceType: "commercial",
    bookingHref: "/commercial",
    sections: commercialChecklistSections("detailed"),
    notIncludedHeading: "Not included — available as add-ons:",
    notIncluded: [
      "Exterior windows",
      "Carpet extraction or floor refinishing",
      "Kitchen hood / grease-trap work",
      "Moving inventory or warehouse racking",
    ],
    addOns: COMMERCIAL_ADD_ONS,
    recommendedNextSlug: "office",
    recommendedNextLabel: "See the office after-hours list",
  },

  "office": {
    slug: "office",
    family: "commercial",
    name: "Office Clean (After-Hours)",
    tagline: "Standard commercial scope plus desk, conference, and lock-up rules",
    description:
      "Office visits run the Commercial Standard list, then add the rules that keep a workspace usable the next morning: papers and electronics stay put, conference rooms are reset without erasing boards, and lights, alarm, and badge-out follow the building's after-hours procedure. Light or Detailed depth can still be priced on the same site.",
    accent: "amber",
    meta: {
      estimatedTime: "Sized to your square footage and after-hours window",
      bestFor: "Offices and workspaces cleaned around the team's hours",
      frequency: "Nightly, several times a week, or weekly",
    },
    bookingServiceType: "office",
    bookingHref: "/commercial",
    sections: commercialChecklistSections("office"),
    notIncludedHeading: "Not included — upgrade to Detailed for:",
    notIncluded: [...COMMERCIAL_DETAILED_EXTRAS],
    addOns: COMMERCIAL_ADD_ONS,
    recommendedNextSlug: "commercial-standard",
    recommendedNextLabel: "Compare Standard commercial scope",
  },
};

export const RESIDENTIAL_CHECKLIST_SLUGS: ChecklistSlug[] = [
  "standard-clean",
  "deep-clean",
  "move-in-out",
  "recurring",
];

export const COMMERCIAL_CHECKLIST_SLUGS: ChecklistSlug[] = [
  "commercial-light",
  "commercial-standard",
  "commercial-detailed",
  "office",
];

export const CHECKLIST_SLUGS: ChecklistSlug[] = [
  ...RESIDENTIAL_CHECKLIST_SLUGS,
  ...COMMERCIAL_CHECKLIST_SLUGS,
];

export function getChecklist(slug: string): Checklist | undefined {
  return (CHECKLISTS as Record<string, Checklist>)[slug];
}

export function slugsForFamily(family: ChecklistFamily): ChecklistSlug[] {
  return CHECKLIST_SLUGS.filter((slug) => CHECKLISTS[slug].family === family);
}

/**
 * Public /checklist path for a booking service type (and commercial scope).
 * Unknown residential types fall back to Standard Clean.
 */
export function checklistPathForServiceType(
  serviceType?: string | null,
  scopeLevel?: string | null,
): string {
  const t = String(serviceType || "").toLowerCase().replace(/[\s-]/g, "_");
  if (t === "office") return "/checklist/office";
  if (
    t === "commercial" ||
    t === "commercial_light" ||
    t === "commercial_standard" ||
    t === "commercial_detailed" ||
    t === "light" ||
    t === "detailed"
  ) {
    return commercialChecklistPath(serviceType, scopeLevel);
  }
  if (t === "deep" || t === "combo") return "/checklist/deep-clean";
  if (t === "moveinout" || t === "move_in_out") return "/checklist/move-in-out";
  if (
    t === "membership" ||
    t === "weekly" ||
    t === "biweekly" ||
    t === "monthly" ||
    t === "recurring"
  ) {
    return "/checklist/recurring";
  }
  if (t === "turnover" || t === "str_turnover" || t === "str") {
    return "/checklist";
  }
  return "/checklist/standard-clean";
}

export const TRY_CHECKLIST_ORIGIN = "https://try.novaracleaning.com";

export function publicChecklistUrl(
  serviceType?: string | null,
  scopeLevel?: string | null,
): string {
  return `${TRY_CHECKLIST_ORIGIN}${checklistPathForServiceType(serviceType, scopeLevel)}`;
}

export { commercialChecklistSlug, commercialChecklistPath };


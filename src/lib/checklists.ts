// ─── Cleaning service checklists ──────────────────────────────────────
//
// Source of truth for the four /checklist/* pages. Each entry mirrors
// the official PDF checklist the customer would receive after booking,
// so what's published online and what cleaners actually execute match
// to the line item.
//
// Edits here flow to:
//   • /checklist/[slug] pages
//   • Booking flow upsells (Offer.tsx links into these)
//   • Cleaner training material (Training.tsx pulls from this map)
//
// If a checklist line changes, update both the SOP doc and this file.

export type ChecklistSlug =
  | "standard-clean"
  | "deep-clean"
  | "move-in-out"
  | "recurring";

export interface ChecklistSection {
  /** Heading shown on the card. */
  title: string;
  /** Each line item — a single short sentence, no leading bullet. */
  items: string[];
}

export interface Checklist {
  slug: ChecklistSlug;
  name: string;
  /** Short subtitle right under the H1. */
  tagline: string;
  /** Full pitch paragraph at the top of the page. */
  description: string;
  /** Color accent for the page (Tailwind palette segment). */
  accent: "emerald" | "blue" | "purple" | "amber";
  /** Three header pills. */
  meta: {
    estimatedTime: string;
    bestFor: string;
    frequency: string;
  };
  /** Service-type ID this checklist maps to in the booking flow. */
  bookingServiceType: "standard" | "deep" | "moveInOut" | "membership";
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
};

export const CHECKLIST_SLUGS: ChecklistSlug[] = [
  "standard-clean",
  "deep-clean",
  "move-in-out",
  "recurring",
];

export function getChecklist(slug: string): Checklist | undefined {
  return (CHECKLISTS as Record<string, Checklist>)[slug];
}

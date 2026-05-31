// Plain-text service checklists for GHL contact tasks (matches public /checklist pages).

type Section = { title: string; items: string[] };

interface ChecklistTemplate {
  name: string;
  tagline: string;
  meta: { estimatedTime: string; frequency: string };
  sections: Section[];
  notIncludedHeading: string;
  notIncluded: string[];
}

const TEMPLATES: Record<string, ChecklistTemplate> = {
  standard: {
    name: "Standard Clean",
    tagline: "Regular Upkeep — keep your home looking its best",
    meta: {
      estimatedTime: "2–3 hours for a typical home",
      frequency: "One-time service",
    },
    sections: [
      {
        title: "KITCHEN",
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
        title: "BATHROOMS",
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
        title: "ALL ROOMS",
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
    notIncludedHeading: "Not Included — Upgrade to Deep Clean for:",
    notIncluded: [
      "Hand-wiping baseboards, door frames, and blinds (Standard includes dusting only)",
      "Detail cleaning under stove burners",
      "Hand-polishing wood furniture",
      "Vacuuming underneath furniture",
      "Hand-wiping window sills (Standard includes dusting only)",
      "Inside cabinets, drawers, or appliances",
    ],
  },
  deep: {
    name: "Deep Clean",
    tagline: "The reset your home needs — recommended for first cleans",
    meta: {
      estimatedTime: "4–6 hours for a typical home",
      frequency: "One-time, or recommended 1–2x per year",
    },
    sections: [
      {
        title: "KITCHEN",
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
        title: "BATHROOMS",
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
        title: "ALL ROOMS",
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
    notIncludedHeading: "Not Included — upgrade to Move In/Out for:",
    notIncluded: [
      "Inside cabinets and drawers",
      "Inside pantry",
      "Inside built-in cabinets or bookcases",
      "Inside oven, refrigerator, or freezer (available as add-on)",
    ],
  },
  move_in_out: {
    name: "Move In / Move Out Clean",
    tagline: "Empty home service — ready for the next chapter",
    meta: {
      estimatedTime: "5–7 hours for a typical home",
      frequency: "One-time service",
    },
    sections: [
      {
        title: "KITCHEN",
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
        title: "BATHROOMS",
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
        title: "ALL ROOMS",
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
  },
};

TEMPLATES.recurring = {
  name: "Recurring Clean",
  tagline: "Weekly • Biweekly • Monthly — consistent care for your home",
  meta: {
    estimatedTime: "1.5–2.5 hours per visit (after initial Deep Clean)",
    frequency: "Weekly, biweekly, or monthly",
  },
  sections: TEMPLATES.standard.sections,
  notIncludedHeading: "Not included — recommended upgrades:",
  notIncluded: [
    "Hand-wiping baseboards, door frames, and blinds (Recurring includes dusting only)",
    "Detail cleaning under stove burners",
    "Hand-polishing wood furniture",
    "Vacuuming underneath furniture",
    "Inside cabinets, drawers, or appliances",
    "Recommended: schedule a Deep Clean 1–2x per year to maintain best results",
  ],
};

function normalizeServiceType(serviceType: string | null | undefined): string {
  const s = String(serviceType || "standard").toLowerCase().replace(/-/g, "_");
  if (s === "moveinout" || s === "move_in_out" || s === "move-in-out") return "move_in_out";
  if (s === "recurring" || s === "membership") return "recurring";
  if (s === "deep") return "deep";
  if (s === "combo") return "deep";
  return "standard";
}

function formatSection(section: Section): string {
  const lines = section.items.map((item) => `✓ ${item}`);
  return `${section.title}\n\n${lines.join("\n")}`;
}

/**
 * Build the full checklist body for a GHL task (matches customer-facing copy).
 */
export function buildGhlTaskChecklistBody(
  serviceType: string | null | undefined,
  extras?: { bookingLine?: string; roleLine?: string },
): string {
  const key = normalizeServiceType(serviceType);
  const t = TEMPLATES[key] || TEMPLATES.standard;
  const parts: string[] = [];

  if (extras?.bookingLine) parts.push(extras.bookingLine);
  if (extras?.roleLine) parts.push(extras.roleLine);
  if (parts.length) parts.push("");

  parts.push(
    t.name,
    "",
    t.tagline,
    "",
    "ESTIMATED TIME",
    "",
    t.meta.estimatedTime,
    "",
    "FREQUENCY",
    "",
    t.meta.frequency,
    "",
  );

  for (const section of t.sections) {
    parts.push(formatSection(section), "");
  }

  parts.push(t.notIncludedHeading, "");
  for (const line of t.notIncluded) {
    parts.push(`— ${line}`, "");
  }

  return parts.join("\n").trimEnd();
}

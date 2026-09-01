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
          "Wipe out inside cabinets and drawers",
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
          "Wipe inside and out of any built-in cabinets or bookcases",
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
  name: "Maintenance Clean",
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

const COMMERCIAL_ARRIVAL = {
  title: "ARRIVAL & SETUP",
  items: [
    "Check in per site access instructions (badge / code / contact)",
    "Notify the required contact on arrival (if specified)",
    "Confirm the alarm is disarmed per the security notes before starting",
    "Walk the site and note anything already damaged or blocked",
  ],
};
const COMMERCIAL_DOCS = {
  title: "DOCUMENTATION",
  items: [
    "Take BEFORE photos of all areas in scope",
    "Take AFTER photos of every area cleaned",
  ],
};
const COMMERCIAL_CLOSE = {
  title: "CLOSE-OUT",
  items: [
    "Complete any deep tasks scheduled for this visit (per scope)",
    "Return all furniture and equipment to where you found it",
    "Secure the site per lock-up procedure (doors, alarm, lights)",
    "Notify the required contact on departure (if specified)",
  ],
};

TEMPLATES.commercial_light = {
  name: "Commercial Light",
  tagline: "Trash, floors, restrooms — the nightly refresh",
  meta: { estimatedTime: "Sized to square footage and window", frequency: "Nightly or several times a week" },
  sections: [
    COMMERCIAL_ARRIVAL,
    {
      title: "LIGHT SCOPE",
      items: [
        "Sweep and vacuum all floors in scope",
        "Empty all trash and recycling; replace liners; take to designated disposal",
        "Restrooms: disinfect toilets, sinks, counters, mirrors; restock supplies",
        "Spot-clean visible spills and marks",
      ],
    },
    COMMERCIAL_DOCS,
    COMMERCIAL_CLOSE,
  ],
  notIncludedHeading: "Not included — upgrade to Standard for:",
  notIncluded: [
    "Mop all hard floors",
    "Break room / kitchenette: counters, sink, appliance exteriors, tables",
    "Individual offices and rooms: surfaces wiped, trash pulled, floors done",
    "Wipe and disinfect touch points (handles, switches, rails)",
  ],
};

TEMPLATES.commercial_standard = {
  name: "Commercial Standard",
  tagline: "Light plus mopping, rooms, and touch-point disinfection",
  meta: { estimatedTime: "Sized to square footage and window", frequency: "Weekly, several times a week, or nightly" },
  sections: [
    COMMERCIAL_ARRIVAL,
    {
      title: "STANDARD SCOPE",
      items: [
        "Sweep and vacuum all floors in scope",
        "Empty all trash and recycling; replace liners; take to designated disposal",
        "Restrooms: disinfect toilets, sinks, counters, mirrors; restock supplies",
        "Spot-clean visible spills and marks",
        "Mop all hard floors",
        "Break room / kitchenette: counters, sink, appliance exteriors, tables",
        "Individual offices and rooms: surfaces wiped, trash pulled, floors done",
        "Wipe and disinfect touch points (handles, switches, rails)",
      ],
    },
    COMMERCIAL_DOCS,
    COMMERCIAL_CLOSE,
  ],
  notIncludedHeading: "Not included — upgrade to Detailed for:",
  notIncluded: [
    "Scrub floors — grout lines, edges, and corners, not just the open middle",
    "High-touch sanitization pass: shared equipment, phones, rails, dispensers",
    "Detail dusting: ledges, sills, vents, fixtures, tops of partitions",
    "Interior glass and entry doors, streak-free",
  ],
};

TEMPLATES.commercial = TEMPLATES.commercial_standard;

TEMPLATES.commercial_detailed = {
  name: "Commercial Detailed",
  tagline: "Standard plus scrubbing, sanitization, dusting, and glass",
  meta: { estimatedTime: "Longer window or a larger crew than Standard", frequency: "Periodic rotation or standing high-spec scope" },
  sections: [
    COMMERCIAL_ARRIVAL,
    {
      title: "DETAILED SCOPE",
      items: [
        ...TEMPLATES.commercial_standard.sections[1].items,
        "Scrub floors — grout lines, edges, and corners, not just the open middle",
        "High-touch sanitization pass: shared equipment, phones, rails, dispensers",
        "Detail dusting: ledges, sills, vents, fixtures, tops of partitions",
        "Interior glass and entry doors, streak-free",
      ],
    },
    COMMERCIAL_DOCS,
    COMMERCIAL_CLOSE,
  ],
  notIncludedHeading: "Not included — available as add-ons:",
  notIncluded: [
    "Exterior windows",
    "Carpet extraction or floor refinishing",
    "Kitchen hood / grease-trap work",
    "Moving inventory or warehouse racking",
  ],
};

TEMPLATES.office = {
  name: "Office Clean (After-Hours)",
  tagline: "Standard commercial scope plus desk, conference, and lock-up rules",
  meta: { estimatedTime: "Sized to square footage and after-hours window", frequency: "Nightly, several times a week, or weekly" },
  sections: [
    ...TEMPLATES.commercial_standard.sections.slice(0, 2),
    {
      title: "OFFICE RULES",
      items: [
        "Respect the desk policy — do NOT move or touch papers/electronics unless scope says otherwise",
        "Clean around workstations: wipe desks per policy, sanitize phones/shared equipment only if in scope",
        "Conference rooms: tables, chairs, glass, whiteboard trays (do not erase boards)",
        "Handle sensitive areas exactly per instructions (server rooms, exec offices)",
      ],
    },
    COMMERCIAL_DOCS,
    COMMERCIAL_CLOSE,
    {
      title: "AFTER-HOURS CLOSE-OUT",
      items: [
        "Turn off lights per building instructions",
        "Set the alarm and lock up exactly per the security notes",
        "Badge out / check out with security if required",
      ],
    },
  ],
  notIncludedHeading: TEMPLATES.commercial_standard.notIncludedHeading,
  notIncluded: TEMPLATES.commercial_standard.notIncluded,
};

function normalizeServiceType(serviceType: string | null | undefined): string {
  const s = String(serviceType || "standard")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .replace(/_clean(ing)?$/, "")
    .replace(/_service$/, "");
  if (s === "moveinout" || s === "move_in_out" || s.includes("move_in") || s.includes("move_out")) return "move_in_out";
  if (s === "recurring" || s === "membership") return "recurring";
  if (s === "deep") return "deep";
  if (s === "combo") return "deep";
  if (s === "office") return "office";
  if (s === "commercial_light" || s === "light") return "commercial_light";
  if (s === "commercial_detailed" || s === "detailed") return "commercial_detailed";
  if (
    s === "commercial" ||
    s === "commercial_standard" ||
    s === "retail" ||
    s === "warehouse" ||
    s === "restaurant" ||
    s === "gym" ||
    s === "medical" ||
    s === "business"
  ) {
    return "commercial_standard";
  }
  if (s === "turnover" || s === "str_turnover" || s === "str") return "standard";
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

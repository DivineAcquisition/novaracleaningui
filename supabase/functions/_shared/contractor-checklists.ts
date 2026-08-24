// ─── Contractor execution checklists (Deno mirror) ─────────────────────
//
// The contractor-dedicated per-job checklist content, keyed by booking
// service_type. This mirrors the customer-facing spec in
// src/lib/checklists.ts but is phrased as the execution list the crew
// works through on-site. Item keys ("<sectionIdx>:<itemIdx>") are stable
// ids used for the progress map stored on job_checklists.items.
//
// If a checklist line changes, update BOTH this file and
// src/lib/checklists.ts so the customer promise and the crew execution
// list stay in lock-step.

import {
  focusedChecklistSections,
  FOCUSED_SAME_DAY_DEFAULTS,
  type FocusedAreaSelection,
  type FocusedSameDaySettings,
} from "./focused-same-day.ts";

export interface ContractorChecklistSection {
  title: string;
  items: string[];
  /** Focused cleans only — area type id for photo / conditions tying. */
  areaId?: string;
  instance?: number;
  /**
   * Before AND after photos are required for this section before the
   * checklist can be completed. Focused areas set it; so does every zone of a
   * large commercial site, because one photo pair proves nothing about
   * 30,000 square feet.
   */
  photoRequired?: boolean;
  /** Human label for the documentation zone this section covers. */
  zoneName?: string;
}

export interface ContractorChecklist {
  key: string;
  name: string;
  sections: ContractorChecklistSection[];
}

const STANDARD_SECTIONS: ContractorChecklistSection[] = [
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
];

const DEEP_SECTIONS: ContractorChecklistSection[] = [
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
];

const MOVE_IN_OUT_SECTIONS: ContractorChecklistSection[] = [
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
];

// ─── Partner job checklists (Commercial · Office · STR turnover) ─────────
// Every job type documents into the same QC hub, so every type carries a
// type-appropriate execution checklist. These are the crew lists for the
// three partner lines of business.

const TURNOVER_SECTIONS: ContractorChecklistSection[] = [
  {
    title: "Guest-ready reset",
    items: [
      "Walk the unit — note any damage or missing items BEFORE cleaning (report in app)",
      "Strip all beds and gather used linens/towels",
      "Start laundry per linen instructions (host-provided / on-site / brought)",
      "Remove all trash and recycling; replace liners",
      "Wash, dry, and put away any dishes; empty dishwasher",
    ],
  },
  {
    title: "Clean",
    items: [
      "Kitchen: counters, sink, stove top, microwave, appliance exteriors, floor",
      "Bathrooms: shower/tub, toilet, sink, mirrors, floor — hotel standard",
      "All rooms: dust surfaces, disinfect touch points, vacuum and mop floors",
      "Spot-check walls, switches, and doors for marks",
      "Check under beds and sofas for guest items",
    ],
  },
  {
    title: "Stage & restock",
    items: [
      "Make all beds with fresh linens (per staging guide)",
      "Fold and stage towels per host's staging notes",
      "Restock consumables per restock list (TP, paper towels, soap, coffee…)",
      "Stage welcome setup exactly as the host specified",
      "Set thermostat / lights / blinds per instructions",
      "Final walkthrough — take AFTER photos of every room",
      "Lock up per access instructions and confirm secure",
    ],
  },
];

// ─── Commercial scope levels ────────────────────────────────────────────
// Light / Standard / Detailed, the same three tiers the pricing model uses.
// Each level is the one before it PLUS more, so the crew list and the price
// describe the same job — a Standard-priced visit cannot show a crew a
// Detailed checklist, and a Detailed one cannot quietly drop the scrubbing
// the client paid for.

const COMMERCIAL_ARRIVAL: ContractorChecklistSection = {
  title: "Arrival & setup",
  items: [
    "Check in per site access instructions (badge / code / contact)",
    "Notify the required contact on arrival (if specified)",
    "Confirm the alarm is disarmed per the security notes before starting",
    "Walk the site and note anything already damaged or blocked",
  ],
};

const COMMERCIAL_LIGHT_ITEMS = [
  "Sweep and vacuum all floors in scope",
  "Empty all trash and recycling; replace liners; take to designated disposal",
  "Restrooms: disinfect toilets, sinks, counters, mirrors; restock supplies",
  "Spot-clean visible spills and marks",
];

const COMMERCIAL_STANDARD_ITEMS = [
  ...COMMERCIAL_LIGHT_ITEMS,
  "Mop all hard floors",
  "Break room / kitchenette: counters, sink, appliance exteriors, tables",
  "Individual offices and rooms: surfaces wiped, trash pulled, floors done",
  "Wipe and disinfect touch points (handles, switches, rails)",
];

const COMMERCIAL_DETAILED_ITEMS = [
  ...COMMERCIAL_STANDARD_ITEMS,
  "Scrub floors — grout lines, edges, and corners, not just the open middle",
  "High-touch sanitization pass: shared equipment, phones, rails, dispensers",
  "Detail dusting: ledges, sills, vents, fixtures, tops of partitions",
  "Interior glass and entry doors, streak-free",
];

const COMMERCIAL_CLOSEOUT: ContractorChecklistSection = {
  title: "Close-out",
  items: [
    "Complete any deep tasks scheduled for this visit (per scope)",
    "Return all furniture and equipment to where you found it",
    "Secure the site per lock-up procedure (doors, alarm, lights)",
    "Notify the required contact on departure (if specified)",
  ],
};

const COMMERCIAL_SCOPE_ITEMS: Record<string, string[]> = {
  light: COMMERCIAL_LIGHT_ITEMS,
  standard: COMMERCIAL_STANDARD_ITEMS,
  detailed: COMMERCIAL_DETAILED_ITEMS,
};

const COMMERCIAL_SCOPE_LABEL: Record<string, string> = {
  light: "Light",
  standard: "Standard",
  detailed: "Detailed",
};

const COMMERCIAL_SECTIONS: ContractorChecklistSection[] = [
  COMMERCIAL_ARRIVAL,
  {
    title: "Service areas",
    items: [
      "Clean all areas listed in the job scope",
      ...COMMERCIAL_STANDARD_ITEMS,
      "Dust surfaces, ledges, and reachable vents",
      "Interior glass at entrances (streak-free)",
    ],
  },
  {
    title: "Documentation",
    items: [
      "Take BEFORE photos of all areas in scope",
      "Take AFTER photos of every area cleaned",
    ],
  },
  COMMERCIAL_CLOSEOUT,
];

/**
 * The crew list for one commercial visit.
 *
 * Zones are what make documentation scale with the building. A 1,800 sqft
 * office is one before/after pair and that is genuinely the whole site; a
 * 30,000 sqft warehouse gets a section per zone, each requiring its own pair,
 * because a single photo of a loading dock says nothing about the racking
 * aisles.
 */
export function commercialChecklistSections(
  scopeLevel: string | null | undefined,
  photoZones?: string[] | null,
  office = false,
): ContractorChecklistSection[] {
  const key = String(scopeLevel || "").toLowerCase().trim();
  const items = COMMERCIAL_SCOPE_ITEMS[key];
  if (!items) return office ? OFFICE_SECTIONS : COMMERCIAL_SECTIONS;

  const label = COMMERCIAL_SCOPE_LABEL[key] || key;
  const zones = (photoZones || []).map((z) => String(z || "").trim()).filter(Boolean);

  const sections: ContractorChecklistSection[] = [
    COMMERCIAL_ARRIVAL,
    { title: `${label} scope — every area in this job`, items: [...items] },
  ];

  if (office) sections.push(...OFFICE_ONLY_SECTIONS);

  if (zones.length > 0) {
    for (const zone of zones) {
      sections.push({
        title: `${zone} — clean & document`,
        zoneName: zone,
        photoRequired: true,
        items: [
          `Complete the ${label.toLowerCase()} scope for ${zone}`,
          `BEFORE photos of ${zone} — taken before you start on it`,
          `AFTER photos of ${zone} — same angles as the before shots`,
          "Report anything in this zone you could not complete, and why",
        ],
      });
    }
  } else {
    sections.push({
      title: "Documentation",
      items: [
        "Take BEFORE photos of all areas in scope",
        "Take AFTER photos of every area cleaned",
      ],
    });
  }

  sections.push(COMMERCIAL_CLOSEOUT);
  return sections;
}

const OFFICE_ONLY_SECTIONS: ContractorChecklistSection[] = [
  {
    title: "Office rules",
    items: [
      "Respect the desk policy — do NOT move or touch papers/electronics unless scope says otherwise",
      "Clean around workstations: wipe desks per policy, sanitize phones/shared equipment only if in scope",
      "Conference rooms: tables, chairs, glass, whiteboard trays (do not erase boards)",
      "Handle sensitive areas exactly per instructions (server rooms, exec offices)",
    ],
  },
  {
    title: "After-hours close-out",
    items: [
      "Turn off lights per building instructions",
      "Set the alarm and lock up exactly per the security notes",
      "Badge out / check out with security if required",
    ],
  },
];

const OFFICE_SECTIONS: ContractorChecklistSection[] = [
  ...COMMERCIAL_SECTIONS.slice(0, 2),
  ...OFFICE_ONLY_SECTIONS,
  {
    title: "Documentation",
    items: [
      "Take BEFORE photos of all areas in scope",
      "Take AFTER photos of every area cleaned",
    ],
  },
];

const CHECKLISTS: Record<string, ContractorChecklist> = {
  standard: { key: "standard", name: "Standard Clean", sections: STANDARD_SECTIONS },
  deep: { key: "deep", name: "Deep Clean", sections: DEEP_SECTIONS },
  combo: { key: "combo", name: "Deep + Standard Combo", sections: DEEP_SECTIONS },
  move_in_out: { key: "move_in_out", name: "Move In / Move Out Clean", sections: MOVE_IN_OUT_SECTIONS },
  recurring: { key: "recurring", name: "Maintenance Clean", sections: STANDARD_SECTIONS },
  turnover: { key: "turnover", name: "STR Turnover — Guest-Ready", sections: TURNOVER_SECTIONS },
  commercial: { key: "commercial", name: "Commercial Site Service", sections: COMMERCIAL_SECTIONS },
  office: { key: "office", name: "Office Clean (After-Hours)", sections: OFFICE_SECTIONS },
  focused: {
    key: "focused",
    name: "Focused / Single-Area Clean",
    sections: [
      {
        title: "Focused clean",
        items: [
          "Clean ONLY the areas listed on this job — do not expand to a whole-home clean",
          "Take BEFORE and AFTER photos of each selected area",
          "Report blocked access or damage before leaving",
        ],
      },
    ],
  },
};

/** Normalize a booking/job service_type to a checklist key. */
export function normalizeServiceType(serviceType: string | null | undefined): string {
  const raw = String(serviceType || "standard").toLowerCase().replace(/[\s-]/g, "_");
  if (raw === "moveinout" || raw === "move_in_out" || raw === "movein" || raw === "moveout") return "move_in_out";
  if (raw === "membership" || raw === "recurring" || raw === "maintenance") return "recurring";
  if (raw === "deep") return "deep";
  if (raw === "combo" || raw === "deep_standard" || raw === "deep_+_standard") return "combo";
  if (raw === "turnover" || raw === "str_turnover" || raw === "str") return "turnover";
  if (raw === "commercial") return "commercial";
  if (raw === "office") return "office";
  if (raw === "focused" || raw === "single_area" || raw === "singlearea") return "focused";
  return CHECKLISTS[raw] ? raw : "standard";
}

const SPECIALTY_CHECKLIST_KEYS = new Set([
  "focused",
  "move_in_out",
  "turnover",
  "commercial",
  "office",
]);

export type BookingForChecklist = {
  service_type?: string | null;
  is_recurring?: boolean | null;
  booking_channel?: string | null;
};

/**
 * Recurring / membership visits run the Standard (maintenance) list — never
 * Deep — even if the booking was cloned from a first-visit Deep or the job
 * row was left stale. Specialty visits (focused, move-out, STR, commercial)
 * keep their own lists.
 */
export function isMembershipMaintenanceVisit(booking: BookingForChecklist | null | undefined): boolean {
  if (!booking) return false;
  const key = normalizeServiceType(booking.service_type);
  if (SPECIALTY_CHECKLIST_KEYS.has(key)) return false;
  if (booking.is_recurring === true) return true;
  return String(booking.booking_channel || "").toLowerCase() === "recurring";
}

/** Contractor checklist key the crew should actually work. */
export function contractorChecklistKeyForBooking(
  booking: BookingForChecklist | null | undefined,
  fallbackServiceType?: string | null,
): string {
  if (isMembershipMaintenanceVisit(booking)) return "recurring";
  return normalizeServiceType(booking?.service_type || fallbackServiceType);
}

/** Value stored on jobs.service_type — booking vocabulary, not checklist keys. */
export function jobServiceTypeForBooking(
  booking: BookingForChecklist | null | undefined,
  fallbackServiceType?: string | null,
): string {
  if (isMembershipMaintenanceVisit(booking)) return "standard";
  return String(booking?.service_type || fallbackServiceType || "standard");
}

export interface CommercialChecklistOptions {
  /** light | standard | detailed — the scope level the job was priced at. */
  scopeLevel?: string | null;
  /** Documentation zones for a large site; empty means one site-wide pair. */
  photoZones?: string[] | null;
}

export function getContractorChecklist(
  serviceType: string | null | undefined,
  focusedAreas?: FocusedAreaSelection[] | null,
  focusedSettings: FocusedSameDaySettings = FOCUSED_SAME_DAY_DEFAULTS,
  commercial?: CommercialChecklistOptions | null,
): ContractorChecklist {
  const key = normalizeServiceType(serviceType);
  if (key === "focused") {
    const sections = focusedChecklistSections(focusedAreas || [], focusedSettings)
      .map((s) => ({ ...s, photoRequired: true }));
    return { key: "focused", name: "Focused / Single-Area Clean", sections };
  }
  if ((key === "commercial" || key === "office") && (commercial?.scopeLevel || commercial?.photoZones?.length)) {
    const sections = commercialChecklistSections(
      commercial.scopeLevel,
      commercial.photoZones,
      key === "office",
    );
    const label = COMMERCIAL_SCOPE_LABEL[String(commercial.scopeLevel || "").toLowerCase()];
    const base = key === "office" ? "Office Clean (After-Hours)" : "Commercial Site Service";
    return { key, name: label ? `${base} — ${label}` : base, sections };
  }
  return CHECKLISTS[key] || CHECKLISTS.standard;
}

/** Indices of sections whose completion requires before AND after photos. */
export function photoRequiredSectionIndexes(checklist: ContractorChecklist): number[] {
  const out: number[] = [];
  checklist.sections.forEach((s, i) => {
    if (s.photoRequired) out.push(i);
  });
  return out;
}

export function countChecklistItems(checklist: ContractorChecklist): number {
  return checklist.sections.reduce((sum, s) => sum + s.items.length, 0);
}

// Add-on catalog exposed to contractors (mirrors src/lib/pricing.ts ADD_ONS).
export const CONTRACTOR_ADDON_CATALOG: Record<string, { label: string; price: number; note: string }> = {
  fridge: { label: "Inside Fridge", price: 30, note: "Free w/ Move-In/Out" },
  oven: { label: "Inside Oven", price: 30, note: "Free w/ Move-In/Out" },
  windows: { label: "Interior Windows", price: 40, note: "Per visit" },
  laundry: { label: "Laundry — wash & fold", price: 35, note: "Per load" },
  changeLinens: { label: "Change bed linens", price: 15, note: "Linens provided by client" },
  dishes: { label: "Dishes & kitchen cleanup", price: 20, note: "Hand-wash / load dishwasher" },
  baseboards: { label: "Baseboards (hand-wiped)", price: 35, note: "Whole home" },
  blinds: { label: "Blinds & shutters", price: 30, note: "Dusted / wiped" },
  cabinets: { label: "Inside cabinets", price: 35, note: "Emptied cabinets" },
  walls: { label: "Spot wall washing", price: 40, note: "Marks & scuffs" },
  ceilingFans: { label: "Ceiling fans", price: 15, note: "Per home" },
  microwave: { label: "Inside microwave", price: 10, note: "" },
  dishwasher: { label: "Inside dishwasher", price: 15, note: "Descale / wipe" },
  garage: { label: "Garage sweep-out", price: 50, note: "Single / double" },
  basement: { label: "Basement clean", price: 75, note: "Sweep, vacuum & tidy" },
  patio: { label: "Patio / balcony", price: 35, note: "Sweep & tidy" },
  petHair: { label: "Heavy pet-hair removal", price: 35, note: "Extra vacuum pass" },
  closets: { label: "Inside closets / tidy", price: 30, note: "Organize & wipe" },
  trashHaul: { label: "Trash haul", price: 75, note: "Haul away trash / junk" },
  deepBathroomDetail: { label: "Deep bathroom detail", price: 45, note: "Per bathroom" },
  cateringEvent: { label: "Catering / event cleanup", price: 85, note: "Post-event catering mess & dish volume" },
  firstCleanDeep: { label: "First-clean deep clean", price: 75, note: "One-time Glow reset. $75 on the first visit." },
  pestLight: { label: "Pest — Light", price: 65, note: "Dead bugs, webs, minor trails. Confined surface work." },
  moldMinor: { label: "Mold — Minor (surface)", price: 65, note: "Small non-porous surface area. Confined work at the Focused Clean area rate." },
};

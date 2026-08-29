// ─── Checklist catalog — addressable items ────────────────────────────────
//
// Every checklist line is a discrete object with a STABLE ID, not a string in
// a document. That is what lets a QC case, a re-clean, a duration-variance
// record, or a review theme point at one specific item and have that signal
// survive the item later being reworded.
//
// The ID is content-independent on purpose: `commercial.light.restrooms`
// stays the same when its wording changes from "Service restrooms" to
// "Service restrooms — toilets, sinks, mirrors, restock supplies". A signal
// logged in March still lines up with the item in September.
//
// Baseline content is Edition 1.0 of docs/standard-cleaning-checklists.md
// (STR / Airbnb Turnover · Office · Commercial). This file is the seed for
// the `checklist_items` table; once an item has been edited from the review
// queue, the DB row is the live wording and this stays the origin record.
//
// Cumulative scopes are modeled by MEMBERSHIP, not duplication: one
// `commercial.light.trash` item belongs to the light, standard, and detailed
// checklists. A quality-miss on a Detailed job is a signal against that one
// item, so the count is not split three ways.

export type ChecklistCatalogKey =
  | "str_turnover"
  | "office"
  | "commercial_light"
  | "commercial_standard"
  | "commercial_detailed";

export interface CatalogItem {
  /** Stable identity. Never reused, never regenerated from text. */
  id: string;
  /** Baseline (Edition 1.0) wording. */
  text: string;
  /** Area / category — "Kitchen", "Bathroom(s)", "Daily", "Light scope". */
  area: string;
  /** Which published checklists this item appears on. */
  checklists: ChecklistCatalogKey[];
  /** Before AND after photos required for this item. */
  photoRequired?: boolean;
}

export interface CatalogSection {
  /** Section heading as rendered. */
  title: string;
  /** Area label used for grouping signals. Defaults to title. */
  area?: string;
  items: CatalogItem[];
}

const STR: ChecklistCatalogKey[] = ["str_turnover"];
const OFFICE: ChecklistCatalogKey[] = ["office"];
/** Light ⊂ Standard ⊂ Detailed — an item in Light is worked on all three. */
const COMMERCIAL_ALL: ChecklistCatalogKey[] = [
  "commercial_light",
  "commercial_standard",
  "commercial_detailed",
];
const COMMERCIAL_STANDARD_UP: ChecklistCatalogKey[] = [
  "commercial_standard",
  "commercial_detailed",
];
const COMMERCIAL_DETAILED_ONLY: ChecklistCatalogKey[] = ["commercial_detailed"];

// ─── Part A · STR / Airbnb turnover ───────────────────────────────────────

export const STR_SECTIONS: CatalogSection[] = [
  {
    title: "Before starting",
    items: [
      { id: "str.before.deadline", text: "Confirm checkout time and next check-in time — know the hard deadline", area: "Before starting", checklists: STR },
      { id: "str.before.damage_walk", text: "Quick walkthrough for damage or missing items — report immediately, don't wait", area: "Before starting", checklists: STR },
      { id: "str.before.trash_collect", text: "Collect all trash from every room, bathroom, and outdoor area; replace all liners", area: "Before starting", checklists: STR },
      { id: "str.before.strip_linens", text: "Strip all beds and collect used towels/linens — start laundry immediately if on-site, or bag for pickup", area: "Before starting", checklists: STR },
      { id: "str.before.air_out", text: "Open windows briefly to air out the space while cleaning, weather permitting", area: "Before starting", checklists: STR },
    ],
  },
  {
    title: "Kitchen",
    items: [
      { id: "str.kitchen.clear_food", text: "Clear all leftover food and guest items", area: "Kitchen", checklists: STR },
      { id: "str.kitchen.stovetop", text: "Wipe stovetop, burner grates, behind/under knobs", area: "Kitchen", checklists: STR },
      { id: "str.kitchen.microwave_interior", text: "Clean inside microwave (turntable, walls, seal)", area: "Kitchen", checklists: STR },
      { id: "str.kitchen.appliance_exteriors", text: "Wipe exterior of all appliances", area: "Kitchen", checklists: STR },
      { id: "str.kitchen.fridge_interior", text: "Clean inside fridge — remove guest food, wipe shelves", area: "Kitchen", checklists: STR },
      { id: "str.kitchen.dishes", text: "Run dishwasher or hand-wash all dishes", area: "Kitchen", checklists: STR },
      { id: "str.kitchen.dishware_check", text: "Check utensils, glasses, mugs for cleanliness", area: "Kitchen", checklists: STR },
      { id: "str.kitchen.counters", text: "Wipe counters, backsplash, cabinet fronts", area: "Kitchen", checklists: STR },
      { id: "str.kitchen.sink", text: "Clean sink and faucet", area: "Kitchen", checklists: STR },
      { id: "str.kitchen.restock", text: "Restock coffee/tea/paper goods to host spec", area: "Kitchen", checklists: STR },
      { id: "str.kitchen.trash_out", text: "Take out trash and recycling", area: "Kitchen", checklists: STR },
    ],
  },
  {
    title: "Bathroom(s)",
    items: [
      { id: "str.bath.toilet", text: "Clean toilet completely — bowl, seat both sides, base, behind", area: "Bathroom(s)", checklists: STR },
      { id: "str.bath.shower", text: "Clean shower/tub, fixtures, drain", area: "Bathroom(s)", checklists: STR },
      { id: "str.bath.sink_mirror", text: "Clean sink, faucet, counter, mirror", area: "Bathroom(s)", checklists: STR },
      { id: "str.bath.restock", text: "Restock toiletries and toilet paper to host spec", area: "Bathroom(s)", checklists: STR },
      { id: "str.bath.towels", text: "Replace all towels and bath mats", area: "Bathroom(s)", checklists: STR },
      { id: "str.bath.trash", text: "Empty trash, replace liner", area: "Bathroom(s)", checklists: STR },
      { id: "str.bath.left_items", text: "Check for guest-left items in cabinets/drawers", area: "Bathroom(s)", checklists: STR },
    ],
  },
  {
    title: "Bedroom(s)",
    items: [
      { id: "str.bed.strip", text: "Strip all bedding", area: "Bedroom(s)", checklists: STR },
      { id: "str.bed.remake", text: "Remake with fresh linens per host spec", area: "Bedroom(s)", checklists: STR },
      { id: "str.bed.dust", text: "Dust all surfaces — nightstands, dresser, headboard, lamps", area: "Bedroom(s)", checklists: STR },
      { id: "str.bed.vacuum", text: "Vacuum floor, including under bed where accessible", area: "Bedroom(s)", checklists: STR },
      { id: "str.bed.left_items", text: "Check closet and drawers for guest-left items", area: "Bedroom(s)", checklists: STR },
      { id: "str.bed.touch_points", text: "Wipe light switches and door handles", area: "Bedroom(s)", checklists: STR },
    ],
  },
  {
    title: "Living areas",
    items: [
      { id: "str.living.floors", text: "Vacuum and/or mop all floors", area: "Living areas", checklists: STR },
      { id: "str.living.dust", text: "Dust all surfaces including ceiling fans and remotes", area: "Living areas", checklists: STR },
      { id: "str.living.touch_points", text: "Wipe light switches and door handles", area: "Living areas", checklists: STR },
      { id: "str.living.staging", text: "Straighten furniture and decor to staged position", area: "Living areas", checklists: STR },
      { id: "str.living.glass", text: "Clean any glass/mirrors", area: "Living areas", checklists: STR },
    ],
  },
  {
    title: "Entry & outdoor",
    items: [
      { id: "str.entry.welcome_zone", text: "Clean entry area, door glass, and welcome zone", area: "Entry & outdoor", checklists: STR },
      { id: "str.entry.outdoor_furniture", text: "Clean outdoor furniture if present", area: "Entry & outdoor", checklists: STR },
      { id: "str.entry.ashtrays", text: "Empty ashtrays if present", area: "Entry & outdoor", checklists: STR },
      { id: "str.entry.left_items", text: "Check for guest-left items outdoors", area: "Entry & outdoor", checklists: STR },
      { id: "str.entry.trash_schedule", text: "Confirm trash/recycling schedule compliance", area: "Entry & outdoor", checklists: STR },
    ],
  },
  {
    title: "High-touch disinfection — every visit",
    area: "High-touch disinfection",
    items: [
      { id: "str.touch.door_handles", text: "Door handles (interior and exterior)", area: "High-touch disinfection", checklists: STR },
      { id: "str.touch.light_switches", text: "Light switches", area: "High-touch disinfection", checklists: STR },
      { id: "str.touch.remotes", text: "Remote controls", area: "High-touch disinfection", checklists: STR },
      { id: "str.touch.pulls", text: "Cabinet and drawer pulls", area: "High-touch disinfection", checklists: STR },
      { id: "str.touch.faucets", text: "Faucet handles", area: "High-touch disinfection", checklists: STR },
      { id: "str.touch.flush_handles", text: "Toilet flush handles", area: "High-touch disinfection", checklists: STR },
      { id: "str.touch.railings", text: "Stair railings", area: "High-touch disinfection", checklists: STR },
    ],
  },
  {
    title: "Final walkthrough & staging",
    items: [
      { id: "str.final.test_appliances", text: "Test appliances (stove, microwave, dishwasher)", area: "Final walkthrough", checklists: STR },
      { id: "str.final.wifi", text: "Confirm WiFi is working", area: "Final walkthrough", checklists: STR },
      { id: "str.final.access_codes", text: "Confirm access codes/locks function correctly for the next guest", area: "Final walkthrough", checklists: STR },
      { id: "str.final.spa_reference", text: "Stage per host's standard property appearance (SPA) reference if one exists", area: "Final walkthrough", checklists: STR },
      { id: "str.final.room_sweep", text: "Walk every room one final time, top to bottom, left to right", area: "Final walkthrough", checklists: STR },
      { id: "str.final.photos", text: "Take before/after photos — minimum 8–12 covering kitchen, each bathroom, each bedroom, living area, and any issue found", area: "Final walkthrough", checklists: STR, photoRequired: true },
    ],
  },
];

// ─── Part B · Office (organized by frequency) ─────────────────────────────

export const OFFICE_SECTIONS: CatalogSection[] = [
  {
    title: "Daily — every scheduled visit",
    area: "Daily",
    items: [
      { id: "office.daily.trash", text: "Empty all trash and recycling bins; replace liners", area: "Daily", checklists: OFFICE },
      { id: "office.daily.high_touch", text: "Disinfect high-touch surfaces: door handles, light switches, elevator buttons, shared phones/keyboards, push bars", area: "Daily", checklists: OFFICE },
      { id: "office.daily.breakroom", text: "Wipe down kitchen/breakroom counters, tables, appliance exteriors", area: "Daily", checklists: OFFICE },
      { id: "office.daily.restrooms", text: "Clean and restock restrooms — toilets, urinals, sinks, mirrors, soap, paper products", area: "Daily", checklists: OFFICE },
      { id: "office.daily.vacuum_traffic", text: "Vacuum high-traffic floor areas", area: "Daily", checklists: OFFICE },
      { id: "office.daily.entry_glass", text: "Spot-clean entry glass and reception area", area: "Daily", checklists: OFFICE },
      { id: "office.daily.common_areas", text: "Straighten common areas and conference rooms", area: "Daily", checklists: OFFICE },
    ],
  },
  {
    title: "Weekly",
    items: [
      { id: "office.weekly.floor_care", text: "Detailed floor care — full vacuum of carpeted areas, mop all hard floors", area: "Weekly", checklists: OFFICE },
      { id: "office.weekly.glass_partitions", text: "Interior glass and partition cleaning", area: "Weekly", checklists: OFFICE },
      { id: "office.weekly.baseboards_vents", text: "Dust baseboards and vents", area: "Weekly", checklists: OFFICE },
      { id: "office.weekly.appliance_interiors", text: "Clean appliance interiors", area: "Weekly", checklists: OFFICE },
      { id: "office.weekly.restroom_scrub", text: "Deeper restroom scrub, including grout and fixtures", area: "Weekly", checklists: OFFICE },
      { id: "office.weekly.workstations", text: "Dust individual workstations (per desk policy)", area: "Weekly", checklists: OFFICE },
      { id: "office.weekly.door_glass", text: "Wipe interior door glass and partitions", area: "Weekly", checklists: OFFICE },
    ],
  },
  {
    title: "Monthly",
    items: [
      { id: "office.monthly.window_detail", text: "Full interior window detail cleaning", area: "Monthly", checklists: OFFICE },
      { id: "office.monthly.carpet_extraction", text: "Carpet extraction in high-traffic zones (or coordinate with specialist vendor)", area: "Monthly", checklists: OFFICE },
      { id: "office.monthly.vents_fixtures", text: "Vent and light fixture dusting", area: "Monthly", checklists: OFFICE },
      { id: "office.monthly.supply_audit", text: "Supply closet audit — restock, check equipment condition", area: "Monthly", checklists: OFFICE },
      { id: "office.monthly.upholstery", text: "Upholstery care in common areas", area: "Monthly", checklists: OFFICE },
    ],
  },
  {
    title: "Site rules — confirm at walkthrough",
    area: "Site rules",
    items: [
      { id: "office.rules.desk_policy", text: "Follow the site's desk policy — clear-desk sites get the full desk surface; do-not-touch-papers sites get dusting around items only", area: "Site rules", checklists: OFFICE },
      { id: "office.rules.restricted_areas", text: "Confirm out-of-scope areas before starting (server/IT rooms, executive offices, secure storage) per walkthrough findings", area: "Site rules", checklists: OFFICE },
      { id: "office.rules.confidential_waste", text: "Service confidential/shredding bins separately from general trash if in scope", area: "Site rules", checklists: OFFICE },
    ],
  },
];

// ─── Part C · Commercial (by scope level) ─────────────────────────────────

export const COMMERCIAL_SECTIONS: CatalogSection[] = [
  {
    title: "Light scope",
    items: [
      { id: "commercial.light.floors", text: "Sweep/vacuum all floors", area: "Light scope", checklists: COMMERCIAL_ALL },
      { id: "commercial.light.trash", text: "Empty all trash and recycling; replace liners", area: "Light scope", checklists: COMMERCIAL_ALL },
      { id: "commercial.light.restrooms", text: "Service restrooms — toilets, sinks, mirrors, restock supplies", area: "Light scope", checklists: COMMERCIAL_ALL },
      { id: "commercial.light.entry_glass", text: "Spot-clean entry glass", area: "Light scope", checklists: COMMERCIAL_ALL },
      { id: "commercial.light.high_touch", text: "Wipe down high-touch surfaces (door handles, light switches, push bars)", area: "Light scope", checklists: COMMERCIAL_ALL },
    ],
  },
  {
    title: "Standard scope — includes Light, plus",
    area: "Standard scope",
    items: [
      { id: "commercial.standard.mop", text: "Mop all hard floors", area: "Standard scope", checklists: COMMERCIAL_STANDARD_UP },
      { id: "commercial.standard.breakroom", text: "Clean breakroom/kitchen area — counters, tables, appliance exteriors, sink", area: "Standard scope", checklists: COMMERCIAL_STANDARD_UP },
      { id: "commercial.standard.rooms", text: "Clean individual offices/rooms per the site's room count", area: "Standard scope", checklists: COMMERCIAL_STANDARD_UP },
      { id: "commercial.standard.dust_common", text: "Dust reachable surfaces in common areas", area: "Standard scope", checklists: COMMERCIAL_STANDARD_UP },
      { id: "commercial.standard.consumables", text: "Restock all consumables to par level", area: "Standard scope", checklists: COMMERCIAL_STANDARD_UP },
    ],
  },
  {
    title: "Detailed scope — includes Standard, plus",
    area: "Detailed scope",
    items: [
      { id: "commercial.detailed.grout", text: "Scrub restroom tile and grout", area: "Detailed scope", checklists: COMMERCIAL_DETAILED_ONLY },
      { id: "commercial.detailed.sanitization", text: "High-touch surface sanitization pass beyond daily wipe-down", area: "Detailed scope", checklists: COMMERCIAL_DETAILED_ONLY },
      { id: "commercial.detailed.high_dusting", text: "Dust vents, light fixtures, and high surfaces", area: "Detailed scope", checklists: COMMERCIAL_DETAILED_ONLY },
      { id: "commercial.detailed.glass_partitions", text: "Interior glass and partition cleaning", area: "Detailed scope", checklists: COMMERCIAL_DETAILED_ONLY },
      { id: "commercial.detailed.baseboards", text: "Baseboard detail cleaning", area: "Detailed scope", checklists: COMMERCIAL_DETAILED_ONLY },
      { id: "commercial.detailed.deep_floor_care", text: "Deep floor care appropriate to floor type (per walkthrough findings)", area: "Detailed scope", checklists: COMMERCIAL_DETAILED_ONLY },
    ],
  },
  {
    title: "Universal rules — every facility type, every visit",
    area: "Universal rules",
    items: [
      { id: "commercial.universal.access", text: "Follow the access/security procedure recorded at walkthrough — badge, alarm, loading dock protocol", area: "Universal rules", checklists: COMMERCIAL_ALL },
      { id: "commercial.universal.window", text: "Respect the confirmed service window — don't begin before or run past without notifying the office", area: "Universal rules", checklists: COMMERCIAL_ALL },
      { id: "commercial.universal.report_beyond_scope", text: "Report any condition beyond scope immediately (mold, pest, biohazard, structural hazard) — stop and report, don't attempt", area: "Universal rules", checklists: COMMERCIAL_ALL },
      { id: "commercial.universal.photos", text: "Before/after photos required, organized by zone/area for larger sites", area: "Universal rules", checklists: COMMERCIAL_ALL, photoRequired: true },
      { id: "commercial.universal.crew_lead_signoff", text: "Crew Lead (if crew of 2+) confirms zone-by-zone completion before the crew leaves", area: "Universal rules", checklists: COMMERCIAL_ALL },
    ],
  },
];

export const CATALOG_SECTIONS: CatalogSection[] = [
  ...STR_SECTIONS,
  ...OFFICE_SECTIONS,
  ...COMMERCIAL_SECTIONS,
];

export const CATALOG_ITEMS: CatalogItem[] = CATALOG_SECTIONS.flatMap((s) => s.items);

export const CATALOG_ITEMS_BY_ID: Record<string, CatalogItem> = Object.fromEntries(
  CATALOG_ITEMS.map((i) => [i.id, i]),
);

export const CHECKLIST_CATALOG_LABELS: Record<ChecklistCatalogKey, string> = {
  str_turnover: "STR / Airbnb Turnover",
  office: "Office",
  commercial_light: "Commercial — Light",
  commercial_standard: "Commercial — Standard",
  commercial_detailed: "Commercial — Detailed",
};

export const CHECKLIST_CATALOG_KEYS: ChecklistCatalogKey[] = [
  "str_turnover",
  "office",
  "commercial_light",
  "commercial_standard",
  "commercial_detailed",
];

/** Sections for one published checklist, with items filtered to membership. */
export function catalogSectionsFor(key: ChecklistCatalogKey): CatalogSection[] {
  const source = key === "str_turnover"
    ? STR_SECTIONS
    : key === "office"
      ? OFFICE_SECTIONS
      : COMMERCIAL_SECTIONS;
  return source
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.checklists.includes(key)),
    }))
    .filter((section) => section.items.length > 0);
}

export function catalogItemsFor(key: ChecklistCatalogKey): CatalogItem[] {
  return CATALOG_ITEMS.filter((i) => i.checklists.includes(key));
}

/** Every checklist an item is worked on — used when surfacing a signal. */
export function checklistsForItem(itemId: string): ChecklistCatalogKey[] {
  return CATALOG_ITEMS_BY_ID[itemId]?.checklists ?? [];
}

export function catalogAreas(): string[] {
  return Array.from(new Set(CATALOG_ITEMS.map((i) => i.area)));
}

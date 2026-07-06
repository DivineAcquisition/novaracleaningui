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

export interface ContractorChecklistSection {
  title: string;
  items: string[];
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

const CHECKLISTS: Record<string, ContractorChecklist> = {
  standard: { key: "standard", name: "Standard Clean", sections: STANDARD_SECTIONS },
  deep: { key: "deep", name: "Deep Clean", sections: DEEP_SECTIONS },
  combo: { key: "combo", name: "Deep + Standard Combo", sections: DEEP_SECTIONS },
  move_in_out: { key: "move_in_out", name: "Move In / Move Out Clean", sections: MOVE_IN_OUT_SECTIONS },
  recurring: { key: "recurring", name: "Recurring Clean", sections: STANDARD_SECTIONS },
};

/** Normalize a booking/job service_type to a checklist key. */
export function normalizeServiceType(serviceType: string | null | undefined): string {
  const raw = String(serviceType || "standard").toLowerCase().replace(/[\s-]/g, "_");
  if (raw === "moveinout" || raw === "move_in_out" || raw === "movein" || raw === "moveout") return "move_in_out";
  if (raw === "membership" || raw === "recurring") return "recurring";
  if (raw === "deep") return "deep";
  if (raw === "combo" || raw === "deep_standard" || raw === "deep_+_standard") return "combo";
  return CHECKLISTS[raw] ? raw : "standard";
}

export function getContractorChecklist(serviceType: string | null | undefined): ContractorChecklist {
  return CHECKLISTS[normalizeServiceType(serviceType)] || CHECKLISTS.standard;
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
  patio: { label: "Patio / balcony", price: 35, note: "Sweep & tidy" },
  petHair: { label: "Heavy pet-hair removal", price: 35, note: "Extra vacuum pass" },
  closets: { label: "Inside closets / tidy", price: 30, note: "Organize & wipe" },
  trashHaul: { label: "Trash haul", price: 75, note: "Haul away trash / junk" },
  deepBathroomDetail: { label: "Deep bathroom detail", price: 45, note: "Per bathroom" },
};

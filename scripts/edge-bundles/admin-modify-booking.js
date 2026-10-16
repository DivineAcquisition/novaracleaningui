// supabase/functions/admin-modify-booking/index.ts
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";
import Stripe from "https://esm.sh/stripe@18.5.0";

// supabase/functions/_shared/focused-same-day.ts
var FOCUSED_SAME_DAY_SETTINGS_KEY = "focused_same_day_settings";
var DEFAULT_FOCUSED_AREA_CHECKLISTS = {
  bathroom: [
    "Toilet \u2014 bowl, seat (both sides), tank, base, behind",
    "Shower/tub \u2014 walls, door or curtain rod, fixtures, drain, soap scum removed",
    "Sink, faucet, countertop, backsplash",
    "Mirror and glass",
    "Vanity exterior, cabinet fronts, handles",
    "Towel bars, paper holder, light switches, door handles",
    "Trash emptied, liner replaced",
    "Baseboards",
    "Floor vacuumed and mopped \u2014 corners and behind the toilet included"
  ],
  kitchen: [
    "Countertops cleared, wiped, items returned",
    "Backsplash",
    "Sink, faucet, drain, disposal splash guard",
    "Stovetop, grates, control knobs, hood/vent exterior",
    "Appliance exteriors \u2014 fridge, oven, dishwasher, microwave",
    "Microwave interior",
    "Cabinet fronts and handles",
    "Small appliance exteriors",
    "Table and chairs (if present)",
    "Trash emptied, liner replaced, can wiped",
    "Baseboards",
    "Floor vacuumed and mopped \u2014 including the toe-kick edge"
  ],
  bedroom: [
    "Bed made, or linens changed if provided",
    "Surfaces dusted \u2014 nightstands, dresser, headboard, shelves, lamps",
    "Mirrors and glass",
    "Under-bed floor cleaned where accessible",
    "Window sills, ledges, blinds dusted",
    "Light switches, door handles, baseboards",
    "Trash emptied",
    "Floor vacuumed; mopped if hard surface"
  ],
  living: [
    "Surfaces dusted \u2014 tables, shelves, entertainment center, decor",
    "Electronics dusted (screens with appropriate cloth)",
    "Upholstered furniture vacuumed, cushions straightened and lifted",
    "Mirrors and glass",
    "Window sills, ledges, blinds",
    "Light switches, door handles, baseboards",
    "Trash emptied",
    "Floor vacuumed and mopped, including under reachable furniture"
  ],
  other: [
    "Surfaces dusted",
    "Glass / mirrors cleaned",
    "Fixtures and light switches wiped",
    "Baseboards",
    "Trash emptied",
    "Floor vacuumed and mopped"
  ]
};
var FOCUSED_SAME_DAY_DEFAULTS = {
  areas: [
    { id: "bathroom", label: "Bathroom", price: 65, quantity: false },
    { id: "kitchen", label: "Kitchen", price: 65, quantity: false },
    { id: "living", label: "Living / common area", price: 65, quantity: false },
    { id: "other", label: "Other single area", price: 65, quantity: false },
    { id: "bedroom", label: "Bedroom", price: 50, quantity: true }
  ],
  minimum_dollars: 65,
  multi_area_bundle_discount_percent: 0,
  condition_multipliers: { light: 0.9, normal: 1, heavy: 1.25, severe: 1.5 },
  same_day_upcharge_dollars: 50,
  same_day_cutoff: "14:00",
  timezone: "America/New_York",
  sourcing_deadline_minutes: 120,
  same_day_upcharge_in_pay_basis: true,
  disclosure_title: "Same-Day Service \u2014 Please Read",
  disclosure_body: "Same-day cleans depend on cleaner availability and are **not guaranteed**. We'll do everything we can to staff your clean today. If we're unable to assign a cleaner, your booking will be canceled and you'll receive a **full refund \u2014 including the same-day fee \u2014 automatically**. Nothing is required from you.",
  checklists: { ...DEFAULT_FOCUSED_AREA_CHECKLISTS }
};
function mergeFocusedSameDaySettings(raw) {
  if (!raw || typeof raw !== "object") return FOCUSED_SAME_DAY_DEFAULTS;
  const areas = Array.isArray(raw.areas) && raw.areas.length > 0 ? raw.areas.map((a) => ({
    id: a.id,
    label: a.label || a.id,
    price: Number(a.price) || 0,
    quantity: Boolean(a.quantity)
  })) : FOCUSED_SAME_DAY_DEFAULTS.areas;
  const checklists = {
    ...DEFAULT_FOCUSED_AREA_CHECKLISTS,
    ...raw.checklists && typeof raw.checklists === "object" ? raw.checklists : {}
  };
  for (const [k, v] of Object.entries(checklists)) {
    if (!Array.isArray(v) || v.length === 0) {
      checklists[k] = DEFAULT_FOCUSED_AREA_CHECKLISTS[k] || DEFAULT_FOCUSED_AREA_CHECKLISTS.other;
    } else {
      checklists[k] = v.map((line) => String(line)).filter(Boolean);
    }
  }
  return {
    ...FOCUSED_SAME_DAY_DEFAULTS,
    ...raw,
    areas,
    checklists,
    condition_multipliers: {
      ...FOCUSED_SAME_DAY_DEFAULTS.condition_multipliers,
      ...raw.condition_multipliers || {}
    }
  };
}
function areaDef(settings, areaId) {
  return settings.areas.find((a) => a.id === areaId);
}
function focusedChecklistSections(selections, settings = FOCUSED_SAME_DAY_DEFAULTS) {
  const sections = [];
  for (const sel of selections) {
    const def = areaDef(settings, sel.areaId);
    if (!def && !settings.checklists[sel.areaId]) continue;
    const baseLabel = sel.label && String(sel.label).trim() || def?.label || String(sel.areaId);
    const qty = def?.quantity ? Math.max(1, Math.floor(Number(sel.quantity) || 1)) : Math.max(1, Math.floor(Number(sel.quantity) || 1));
    const repeat = def?.quantity === false && qty === 1 ? 1 : qty;
    const items = settings.checklists[sel.areaId] || settings.checklists.other || DEFAULT_FOCUSED_AREA_CHECKLISTS.other;
    for (let i = 1; i <= repeat; i++) {
      const title = repeat > 1 ? `${baseLabel} ${i}` : baseLabel;
      sections.push({
        title,
        items: [...items],
        areaId: String(sel.areaId),
        instance: i
      });
    }
  }
  return sections;
}

// supabase/functions/_shared/contractor-checklists.ts
var STANDARD_SECTIONS = [
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
      "Remove trash, replace bag, wipe exterior"
    ]
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
      "Clean and disinfect bathroom floor"
    ]
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
      "Clean front and back door glass"
    ]
  }
];
var DEEP_SECTIONS = [
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
      "Remove trash, replace bag, wipe exterior"
    ]
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
      "Clean and disinfect bathroom floor"
    ]
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
      "Clean front and back door glass"
    ]
  }
];
var MOVE_IN_OUT_SECTIONS = [
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
      "Hand-wipe small appliances and items on countertops (if present)",
      "Remove trash, replace bag, wipe exterior",
      "Clean inside refrigerator and freezer",
      "Clean inside oven"
    ]
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
      "Vacuum bathroom rugs (if present)",
      "Remove trash, replace bags, wipe exterior"
    ]
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
      "Dust wall art (if present)",
      "Dust TVs, electronics, book tops, knick-knacks, lamps (if present)",
      "Hand-polish all wood furniture (if present)",
      "Vacuum under all furniture (if present)",
      "Vacuum upholstered furniture and crevices (if present)",
      "Change linens and/or make beds (if present)"
    ]
  }
];
var TURNOVER_SECTIONS = [
  {
    title: "Guest-ready reset",
    items: [
      "Walk the unit \u2014 note any damage or missing items BEFORE cleaning (report in app)",
      "Strip all beds and gather used linens/towels",
      "Start laundry per linen instructions (host-provided / on-site / brought)",
      "Remove all trash and recycling; replace liners",
      "Wash, dry, and put away any dishes; empty dishwasher"
    ]
  },
  {
    title: "Clean",
    items: [
      "Kitchen: counters, sink, stove top, microwave, appliance exteriors, floor",
      "Bathrooms: shower/tub, toilet, sink, mirrors, floor \u2014 hotel standard",
      "All rooms: dust surfaces, disinfect touch points, vacuum and mop floors",
      "Spot-check walls, switches, and doors for marks",
      "Check under beds and sofas for guest items"
    ]
  },
  {
    title: "Stage & restock",
    items: [
      "Make all beds with fresh linens (per staging guide)",
      "Fold and stage towels per host's staging notes",
      "Restock consumables per restock list (TP, paper towels, soap, coffee\u2026)",
      "Stage welcome setup exactly as the host specified",
      "Set thermostat / lights / blinds per instructions",
      "Final walkthrough \u2014 take AFTER photos of every room",
      "Lock up per access instructions and confirm secure"
    ]
  }
];
var COMMERCIAL_ARRIVAL = {
  title: "Arrival & setup",
  items: [
    "Follow the access/security procedure recorded at walkthrough \u2014 badge, alarm, loading dock protocol",
    "Respect the confirmed service window \u2014 don't begin before or run past without notifying the office",
    "Walk the site and note anything already damaged or blocked"
  ],
  itemIds: [
    "commercial.universal.access",
    "commercial.universal.window",
    ""
  ]
};
var COMMERCIAL_LIGHT_ITEMS = [
  "Sweep/vacuum all floors",
  "Empty all trash and recycling; replace liners",
  "Service restrooms \u2014 toilets, sinks, mirrors, restock supplies",
  "Spot-clean entry glass",
  "Wipe down high-touch surfaces (door handles, light switches, push bars)"
];
var COMMERCIAL_LIGHT_IDS = [
  "commercial.light.floors",
  "commercial.light.trash",
  "commercial.light.restrooms",
  "commercial.light.entry_glass",
  "commercial.light.high_touch"
];
var COMMERCIAL_STANDARD_ITEMS = [
  ...COMMERCIAL_LIGHT_ITEMS,
  "Mop all hard floors",
  "Clean breakroom/kitchen area \u2014 counters, tables, appliance exteriors, sink",
  "Clean individual offices/rooms per the site's room count",
  "Dust reachable surfaces in common areas",
  "Restock all consumables to par level"
];
var COMMERCIAL_STANDARD_IDS = [
  ...COMMERCIAL_LIGHT_IDS,
  "commercial.standard.mop",
  "commercial.standard.breakroom",
  "commercial.standard.rooms",
  "commercial.standard.dust_common",
  "commercial.standard.consumables"
];
var COMMERCIAL_DETAILED_ITEMS = [
  ...COMMERCIAL_STANDARD_ITEMS,
  "Scrub restroom tile and grout",
  "High-touch surface sanitization pass beyond daily wipe-down",
  "Dust vents, light fixtures, and high surfaces",
  "Interior glass and partition cleaning",
  "Baseboard detail cleaning",
  "Deep floor care appropriate to floor type (per walkthrough findings)"
];
var COMMERCIAL_DETAILED_IDS = [
  ...COMMERCIAL_STANDARD_IDS,
  "commercial.detailed.grout",
  "commercial.detailed.sanitization",
  "commercial.detailed.high_dusting",
  "commercial.detailed.glass_partitions",
  "commercial.detailed.baseboards",
  "commercial.detailed.deep_floor_care"
];
var COMMERCIAL_CLOSEOUT = {
  title: "Close-out",
  items: [
    "Report any condition beyond scope immediately (mold, pest, biohazard, structural hazard) \u2014 stop and report, don't attempt",
    "Return all furniture and equipment to where you found it",
    "Secure the site per lock-up procedure (doors, alarm, lights)",
    "Crew Lead (if crew of 2+) confirms zone-by-zone completion before the crew leaves"
  ],
  itemIds: [
    "commercial.universal.report_beyond_scope",
    "",
    "",
    "commercial.universal.crew_lead_signoff"
  ]
};
var COMMERCIAL_SCOPE_ITEMS = {
  light: COMMERCIAL_LIGHT_ITEMS,
  standard: COMMERCIAL_STANDARD_ITEMS,
  detailed: COMMERCIAL_DETAILED_ITEMS
};
var COMMERCIAL_SCOPE_IDS = {
  light: COMMERCIAL_LIGHT_IDS,
  standard: COMMERCIAL_STANDARD_IDS,
  detailed: COMMERCIAL_DETAILED_IDS
};
var COMMERCIAL_SCOPE_LABEL = {
  light: "Light",
  standard: "Standard",
  detailed: "Detailed"
};
var COMMERCIAL_SECTIONS = [
  {
    title: "Arrival & setup",
    items: [
      "Check in per site access instructions (badge / code / contact)",
      "Notify the required contact on arrival (if specified)",
      "Take BEFORE photos of all areas in scope"
    ]
  },
  {
    title: "Service areas",
    items: [
      "Clean all areas listed in the job scope",
      "Restrooms: disinfect toilets, sinks, counters, mirrors; restock supplies",
      "Empty all trash and recycling; replace liners; take to designated disposal",
      "Vacuum carpets and mats; sweep and mop hard floors",
      "Wipe and disinfect touch points (handles, switches, rails)",
      "Break room / kitchenette: counters, sink, appliance exteriors, tables",
      "Dust surfaces, ledges, and reachable vents",
      "Interior glass at entrances (streak-free)"
    ]
  },
  {
    title: "Close-out",
    items: [
      "Complete any deep tasks scheduled for this visit (per scope)",
      "Take AFTER photos of every area cleaned",
      "Secure the site per lock-up procedure (doors, alarm, lights)",
      "Notify the required contact on departure (if specified)"
    ]
  }
];
function commercialChecklistSections(scopeLevel, photoZones, office = false) {
  const key = String(scopeLevel || "").toLowerCase().trim();
  const zones = (photoZones || []).map((z) => String(z || "").trim()).filter(Boolean);
  const items = COMMERCIAL_SCOPE_ITEMS[key] || (zones.length > 0 ? COMMERCIAL_SCOPE_ITEMS.standard : null);
  if (!items) return office ? OFFICE_SECTIONS : COMMERCIAL_SECTIONS;
  const label = COMMERCIAL_SCOPE_LABEL[key] || COMMERCIAL_SCOPE_LABEL.standard;
  const sections = [
    COMMERCIAL_ARRIVAL,
    {
      title: `${label} scope \u2014 every area in this job`,
      items: [...items],
      itemIds: [...COMMERCIAL_SCOPE_IDS[key] || COMMERCIAL_SCOPE_IDS.standard]
    }
  ];
  if (office) sections.push(...OFFICE_ONLY_SECTIONS);
  if (zones.length > 0) {
    for (const zone of zones) {
      sections.push({
        title: `${zone} \u2014 clean & document`,
        zoneName: zone,
        photoRequired: true,
        items: [
          `Complete the ${label.toLowerCase()} scope for ${zone}`,
          `BEFORE photos of ${zone} \u2014 taken before you start on it`,
          `AFTER photos of ${zone} \u2014 same angles as the before shots`,
          "Report anything in this zone you could not complete, and why"
        ]
      });
    }
  } else {
    sections.push({
      title: "Documentation",
      items: [
        "Take BEFORE photos of all areas in scope",
        "Before/after photos required, organized by zone/area for larger sites"
      ],
      itemIds: ["", "commercial.universal.photos"]
    });
  }
  sections.push(COMMERCIAL_CLOSEOUT);
  return sections;
}
var OFFICE_ONLY_SECTIONS = [
  {
    title: "Office rules",
    items: [
      "Follow the site's desk policy \u2014 clear-desk sites get the full desk surface; do-not-touch-papers sites get dusting around items only",
      "Confirm out-of-scope areas before starting (server/IT rooms, executive offices, secure storage) per walkthrough findings",
      "Service confidential/shredding bins separately from general trash if in scope",
      "Conference rooms: tables, chairs, glass, whiteboard trays (do not erase boards)"
    ],
    itemIds: [
      "office.rules.desk_policy",
      "office.rules.restricted_areas",
      "office.rules.confidential_waste",
      ""
    ]
  },
  {
    title: "After-hours close-out",
    items: [
      "Turn off lights per building instructions",
      "Set the alarm and lock up exactly per the security notes",
      "Badge out / check out with security if required"
    ]
  }
];
var OFFICE_SECTIONS = [
  ...COMMERCIAL_SECTIONS.slice(0, 2),
  ...OFFICE_ONLY_SECTIONS,
  {
    title: "After-hours close-out",
    items: [
      "Take AFTER photos of every area cleaned",
      "Turn off lights per building instructions",
      "Set the alarm and lock up exactly per the security notes",
      "Badge out / check out with security if required"
    ]
  }
];
var CHECKLISTS = {
  standard: {
    key: "standard",
    name: "Standard Clean",
    blurb: "Occupied-home maintenance: dust, vacuum, mop, kitchen exteriors, bathrooms, linens. Hand-wiping, inside cabinets, and appliance interiors are Deep or Move-In/Out.",
    sections: STANDARD_SECTIONS
  },
  deep: {
    key: "deep",
    name: "Deep Clean",
    blurb: "The reset: Standard surfaces, hand-wiped, plus under-burner and carpet-edge detail. Inside cabinets, fridge, and oven are Move-In/Out (or add-ons).",
    sections: DEEP_SECTIONS
  },
  combo: {
    key: "combo",
    name: "Deep + Standard Combo",
    blurb: "The reset: Standard surfaces, hand-wiped, plus under-burner and carpet-edge detail. Inside cabinets, fridge, and oven are Move-In/Out (or add-ons).",
    sections: DEEP_SECTIONS
  },
  move_in_out: {
    key: "move_in_out",
    name: "Move In / Move Out Clean",
    blurb: "Everything in a Deep Clean, plus inside cabinets, pantry, built-ins, fridge, and oven. Skip occupied-only lines (if present) when the home is empty.",
    sections: MOVE_IN_OUT_SECTIONS
  },
  recurring: {
    key: "recurring",
    name: "Maintenance Clean",
    blurb: "Same list as a Standard Clean \u2014 the recurring visit that keeps the home at baseline after a Deep reset.",
    sections: STANDARD_SECTIONS
  },
  turnover: { key: "turnover", name: "STR Turnover \u2014 Guest-Ready", sections: TURNOVER_SECTIONS },
  commercial: { key: "commercial", name: "Commercial Site Service", sections: COMMERCIAL_SECTIONS },
  office: { key: "office", name: "Office Clean (After-Hours)", sections: OFFICE_SECTIONS },
  focused: {
    key: "focused",
    name: "Focused / Single-Area Clean",
    sections: [
      {
        title: "Focused clean",
        items: [
          "Clean ONLY the areas listed on this job \u2014 do not expand to a whole-home clean",
          "Take BEFORE and AFTER photos of each selected area",
          "Report blocked access or damage before leaving"
        ]
      }
    ]
  }
};
function normalizeServiceType(serviceType) {
  const raw = String(serviceType || "standard").toLowerCase().replace(/[\s\-\/]+/g, "_");
  if (raw === "moveinout" || raw === "move_in_out" || raw === "movein" || raw === "moveout") return "move_in_out";
  if (raw === "membership" || raw === "recurring" || raw === "maintenance") return "recurring";
  if (raw === "deep") return "deep";
  if (raw === "combo" || raw === "deep_standard" || raw === "deep_+_standard") return "combo";
  if (raw === "turnover" || raw === "str_turnover" || raw === "str" || raw.includes("airbnb")) return "turnover";
  if (raw === "office") return "office";
  if (raw === "commercial" || raw === "retail" || raw === "warehouse" || raw === "restaurant" || raw === "gym" || raw === "medical" || raw === "business") {
    return "commercial";
  }
  if (raw === "focused" || raw === "single_area" || raw === "singlearea") return "focused";
  return CHECKLISTS[raw] ? raw : "standard";
}
var SPECIALTY_CHECKLIST_KEYS = /* @__PURE__ */ new Set([
  "focused",
  "move_in_out",
  "turnover",
  "commercial",
  "office"
]);
function isMembershipMaintenanceVisit(booking) {
  if (!booking) return false;
  const key = normalizeServiceType(booking.service_type);
  if (SPECIALTY_CHECKLIST_KEYS.has(key)) return false;
  if (booking.is_recurring === true) return true;
  return String(booking.booking_channel || "").toLowerCase() === "recurring";
}
function contractorChecklistKeyForBooking(booking, fallbackServiceType) {
  if (isMembershipMaintenanceVisit(booking)) return "recurring";
  return normalizeServiceType(booking?.service_type || fallbackServiceType);
}
function jobServiceTypeForBooking(booking, fallbackServiceType) {
  if (isMembershipMaintenanceVisit(booking)) return "standard";
  return String(booking?.service_type || fallbackServiceType || "standard");
}
function getContractorChecklist(serviceType, focusedAreas, focusedSettings = FOCUSED_SAME_DAY_DEFAULTS, commercial) {
  const key = normalizeServiceType(serviceType);
  let resolved;
  if (key === "focused") {
    const sections = focusedChecklistSections(focusedAreas || [], focusedSettings).map((s) => ({ ...s, photoRequired: true }));
    resolved = { key: "focused", name: "Focused / Single-Area Clean", sections };
  } else if (key === "commercial" || key === "office") {
    const sections = commercialChecklistSections(
      commercial?.scopeLevel ?? "standard",
      commercial?.photoZones,
      key === "office"
    );
    const label = COMMERCIAL_SCOPE_LABEL[String(commercial?.scopeLevel || "standard").toLowerCase()];
    const base = key === "office" ? "Office Clean (After-Hours)" : "Commercial Site Service";
    resolved = { key, name: label ? `${base} \u2014 ${label}` : base, sections };
  } else {
    resolved = CHECKLISTS[key] || CHECKLISTS.standard;
  }
  return withBookedAddonSection(resolved, commercial?.bookedAddOns);
}
function countChecklistItems(checklist) {
  return checklist.sections.reduce((sum, s) => sum + s.items.length, 0);
}
var CONTRACTOR_ADDON_CATALOG = {
  fridge: { label: "Inside Fridge", price: 30, note: "Free w/ Move-In/Out" },
  oven: { label: "Inside Oven", price: 30, note: "Free w/ Move-In/Out" },
  windows: { label: "Interior Windows", price: 40, note: "Per visit" },
  laundry: { label: "Laundry \u2014 wash & fold", price: 35, note: "Per load" },
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
  pestLight: { label: "Pest \u2014 Light", price: 65, note: "Dead bugs, webs, minor trails. Confined surface work." },
  moldMinor: { label: "Mold \u2014 Minor (surface)", price: 65, note: "Small non-porous surface area. Confined work at the Focused Clean area rate." }
};
var MOVE_INCLUDED_ADDON_IDS = /* @__PURE__ */ new Set(["fridge", "oven"]);
function includedAddonIdsForChecklistKey(key) {
  return normalizeServiceType(key) === "move_in_out" ? MOVE_INCLUDED_ADDON_IDS : /* @__PURE__ */ new Set();
}
function withBookedAddonSection(checklist, bookedAddOns) {
  const included = includedAddonIdsForChecklistKey(checklist.key);
  const ids = [...new Set((bookedAddOns || []).map((id) => String(id)))].filter(
    (id) => CONTRACTOR_ADDON_CATALOG[id] && !included.has(id)
  );
  if (ids.length === 0) return checklist;
  return {
    ...checklist,
    sections: [
      ...checklist.sections,
      {
        title: "Booked add-ons",
        items: ids.map((id) => {
          const a = CONTRACTOR_ADDON_CATALOG[id];
          return a.note ? `${a.label} (${a.note})` : a.label;
        })
      }
    ]
  };
}

// supabase/functions/_shared/site-zones.ts
function newZoneId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `z-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function asName(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}
function parseSiteZones(raw, max = 12) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const entry of raw) {
    if (out.length >= max) break;
    let name = "";
    let description = "";
    let id = "";
    if (typeof entry === "string" || typeof entry === "number") {
      name = asName(entry);
    } else if (entry && typeof entry === "object") {
      const o = entry;
      name = asName(o.name ?? o.label ?? o.title);
      description = String(o.description ?? o.notes ?? "").trim().slice(0, 400);
      id = String(o.id ?? "").trim();
    }
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: id || newZoneId(), name, description });
  }
  return out;
}
function siteZoneNames(raw, max = 12) {
  return parseSiteZones(raw, max).map((z) => z.name);
}

// supabase/functions/_shared/job-checklist.ts
function pinnedVersion(checklist) {
  const sections = checklist.sections.map((s, si) => ({
    title: s.title,
    items: s.items,
    itemIds: Array.isArray(s.itemIds) ? s.itemIds : null,
    photoRequired: Boolean(s.photoRequired),
    zoneName: s.zoneName ?? null,
    keys: s.items.map((_, ii) => `${si}:${ii}`)
  }));
  const itemIdMap = {};
  sections.forEach((section, si) => {
    if (!section.itemIds) return;
    section.itemIds.forEach((id, ii) => {
      if (id) itemIdMap[`${si}:${ii}`] = id;
    });
  });
  return {
    snapshot: {
      key: checklist.key,
      name: checklist.name,
      blurb: checklist.blurb ?? null,
      pinned_at: (/* @__PURE__ */ new Date()).toISOString(),
      sections
    },
    itemIdMap
  };
}
function randomToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function loadBookingForChecklist(supabase, args) {
  if (args.bookingId) {
    const { data: data2 } = await supabase.from("bookings").select("id, service_type, is_recurring, membership_plan, booking_channel, focused_areas, scope_level, photo_zones, add_ons").eq("id", args.bookingId).maybeSingle();
    if (data2) return data2;
  }
  const { data } = await supabase.from("bookings").select("id, service_type, is_recurring, membership_plan, booking_channel, focused_areas, scope_level, photo_zones, add_ons").eq("job_id", args.jobId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data || null;
}
async function ensureJobChecklist(supabase, args) {
  const { jobId } = args;
  if (!jobId) return null;
  const booking = await loadBookingForChecklist(supabase, args);
  let focusedAreas = null;
  if (Array.isArray(booking?.focused_areas)) focusedAreas = booking.focused_areas;
  const commercialOpts = {
    scopeLevel: booking?.scope_level || null,
    photoZones: siteZoneNames(booking?.photo_zones),
    bookedAddOns: Array.isArray(booking?.add_ons) ? booking.add_ons.map(String) : []
  };
  const checklistKey = contractorChecklistKeyForBooking(
    booking,
    args.serviceType || booking?.service_type || null
  );
  const jobType = jobServiceTypeForBooking(
    booking,
    args.serviceType || booking?.service_type || null
  );
  try {
    await supabase.from("jobs").update({ service_type: jobType }).eq("id", jobId);
  } catch (_) {
  }
  const { data: existing } = await supabase.from("job_checklists").select("id, token, service_type, completed_at, started_at, completed_items").eq("job_id", jobId).maybeSingle();
  if (existing?.id) {
    const stale = String(existing.service_type || "") !== checklistKey;
    const untouched = !existing.completed_at && !existing.started_at && !(Number(existing.completed_items) > 0);
    if ((stale || untouched) && !existing.completed_at) {
      let focusedSettings2 = FOCUSED_SAME_DAY_DEFAULTS;
      if (checklistKey === "focused") {
        try {
          const { data: settingsRow } = await supabase.from("app_settings").select("value").eq("key", FOCUSED_SAME_DAY_SETTINGS_KEY).maybeSingle();
          if (settingsRow?.value) focusedSettings2 = mergeFocusedSameDaySettings(settingsRow.value);
        } catch (_) {
        }
      }
      const resolved2 = getContractorChecklist(checklistKey, focusedAreas, focusedSettings2, commercialOpts);
      const totalItems2 = countChecklistItems(resolved2);
      const pinned2 = pinnedVersion(resolved2);
      await supabase.from("job_checklists").update({
        service_type: checklistKey,
        booking_id: booking?.id || args.bookingId || null,
        total_items: totalItems2,
        items: {},
        completed_items: 0,
        progress_pct: 0,
        started_at: null,
        section_meta: {},
        // Re-issued because the booking changed type — the crew gets a new
        // list, so the pin moves with it.
        checklist_key: checklistKey,
        sections_snapshot: pinned2.snapshot,
        item_id_map: pinned2.itemIdMap
      }).eq("id", existing.id);
    }
    return { id: existing.id, token: existing.token };
  }
  let focusedSettings = FOCUSED_SAME_DAY_DEFAULTS;
  if (checklistKey === "focused") {
    try {
      const { data: settingsRow } = await supabase.from("app_settings").select("value").eq("key", FOCUSED_SAME_DAY_SETTINGS_KEY).maybeSingle();
      if (settingsRow?.value) focusedSettings = mergeFocusedSameDaySettings(settingsRow.value);
    } catch (_) {
    }
  }
  const resolved = getContractorChecklist(checklistKey, focusedAreas, focusedSettings, commercialOpts);
  const totalItems = countChecklistItems(resolved);
  const pinned = pinnedVersion(resolved);
  const { data: created, error } = await supabase.from("job_checklists").insert({
    job_id: jobId,
    booking_id: booking?.id || args.bookingId || null,
    service_type: checklistKey,
    token: randomToken(),
    total_items: totalItems,
    section_meta: {},
    checklist_key: checklistKey,
    sections_snapshot: pinned.snapshot,
    item_id_map: pinned.itemIdMap
  }).select("id, token").maybeSingle();
  if (error) {
    const { data: raced } = await supabase.from("job_checklists").select("id, token").eq("job_id", jobId).maybeSingle();
    return raced?.id ? { id: raced.id, token: raced.token } : null;
  }
  return created?.id ? { id: created.id, token: created.token } : null;
}

// supabase/functions/_shared/addon-qc.ts
var SITE_FINDING_PREFIX = "site_finding_";
var ADDON_LABELS = Object.fromEntries(
  Object.entries(CONTRACTOR_ADDON_CATALOG).map(([id, a]) => [id, a.label])
);
function labelOfAddon(id) {
  return ADDON_LABELS[id] || CONTRACTOR_ADDON_CATALOG[id]?.label || id;
}
function isSiteFindingAddonId(id) {
  return String(id).startsWith(SITE_FINDING_PREFIX);
}
function clientTypeOf(booking) {
  const t = String(booking.booking_type || "");
  if (t === "commercial") return "commercial";
  if (t === "office") return "office";
  if (t === "str_turnover") return "str";
  if (t === "partnership") {
    const pd = booking.partner_details;
    return String(pd?.booking_type || "") === "str_turnover" ? "str" : "commercial";
  }
  return "residential";
}
function bookingRefOf(booking) {
  const n = booking.booking_number;
  return n != null ? `NVC-${String(n).padStart(4, "0")}` : `Job ${String(booking.id).slice(0, 8)}`;
}
function httpUrls(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(String).filter((u) => /^https?:\/\//i.test(u));
}
function catalogPriceCents(id, serviceType) {
  if (String(serviceType) === "moveInOut" && (id === "fridge" || id === "oven")) return 0;
  const entry = CONTRACTOR_ADDON_CATALOG[id];
  return entry ? Math.round(entry.price * 100) : null;
}
function mergeLines(existing, incoming) {
  const byId = /* @__PURE__ */ new Map();
  for (const line of existing) {
    if (line?.id) byId.set(line.id, line);
  }
  for (const line of incoming) {
    if (!line?.id) continue;
    const prev = byId.get(line.id);
    byId.set(line.id, {
      id: line.id,
      label: line.label || prev?.label || labelOfAddon(line.id),
      source: line.source || prev?.source || "booked",
      amount_cents: line.amount_cents != null ? line.amount_cents : prev?.amount_cents ?? null,
      charge_status: line.charge_status || prev?.charge_status || null,
      charge_id: line.charge_id || prev?.charge_id || null,
      added_at: line.added_at || prev?.added_at || null
    });
  }
  return [...byId.values()];
}
function parseExistingLines(raw) {
  if (!raw || typeof raw !== "object") return [];
  const d = raw;
  if (!Array.isArray(d.addons)) return [];
  const out = [];
  for (const row of d.addons) {
    if (!row || typeof row !== "object") continue;
    const r = row;
    const id = String(r.id || "").trim();
    if (!id) continue;
    out.push({
      id,
      label: String(r.label || labelOfAddon(id)),
      source: ["booked", "admin", "contractor_request", "pay_page"].includes(String(r.source)) ? String(r.source) : "booked",
      amount_cents: r.amount_cents == null ? null : Math.round(Number(r.amount_cents)),
      charge_status: r.charge_status ? String(r.charge_status) : null,
      charge_id: r.charge_id ? String(r.charge_id) : null,
      added_at: r.added_at ? String(r.added_at) : null
    });
  }
  return out;
}
function buildDescription(lines) {
  if (lines.length === 0) return "No catalog add-ons on this job.";
  const bullets = lines.map((l) => {
    const amt = l.amount_cents != null ? `$${(l.amount_cents / 100).toFixed(2)}` : "included";
    const st = l.charge_status ? ` \xB7 ${l.charge_status.replace(/_/g, " ")}` : "";
    return `\u2022 ${l.label} (${l.source.replace(/_/g, " ")}) \u2014 ${amt}${st}`;
  });
  return "Catalog add-ons on this job. This QC record is the dispute-packet entry for extra services (not a quality complaint).\n\n" + bullets.join("\n");
}
function statusForLines(lines) {
  const unpaid = lines.some(
    (l) => l.charge_status === "charge_failed" || l.charge_status === "invoiced" || l.charge_status === "pending"
  );
  return unpaid ? "open" : "resolved";
}
async function documentBookingAddonsInQc(supabase, opts) {
  const booking = opts.booking;
  const bookingId = String(booking.id || "");
  if (!bookingId) return null;
  const booked = Array.isArray(booking.add_ons) ? booking.add_ons.map(String) : [];
  const added = (opts.addedIds || []).map(String);
  const ids = [.../* @__PURE__ */ new Set([...booked, ...added])].filter((id) => id && !isSiteFindingAddonId(id));
  if (ids.length === 0 && added.length === 0) {
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const serviceType = String(booking.service_type || "");
  const incoming = ids.map((id) => ({
    id,
    label: labelOfAddon(id),
    source: added.includes(id) ? opts.source || "admin" : "booked",
    amount_cents: opts.amountCentsById?.[id] ?? catalogPriceCents(id, serviceType),
    charge_status: added.includes(id) ? opts.chargeStatus || null : null,
    charge_id: added.includes(id) ? opts.chargeId || null : null,
    added_at: nowIso
  }));
  try {
    const { data: charges } = await supabase.from("booking_addon_charges").select("id, added_addons, amount_cents, status, created_at").eq("booking_id", bookingId).order("created_at", { ascending: true });
    for (const row of charges || []) {
      const list = Array.isArray(row.added_addons) ? row.added_addons.map(String) : [];
      const catalog = list.filter((id) => !isSiteFindingAddonId(id));
      if (catalog.length === 0) continue;
      const per = catalog.length > 0 ? Math.round(Number(row.amount_cents || 0) / catalog.length) : 0;
      for (const id of catalog) {
        incoming.push({
          id,
          label: labelOfAddon(id),
          source: "admin",
          amount_cents: opts.amountCentsById?.[id] ?? per,
          charge_status: String(row.status || ""),
          charge_id: String(row.id),
          added_at: row.created_at ? String(row.created_at) : nowIso
        });
      }
    }
  } catch (_) {
  }
  if (incoming.length === 0) return null;
  const { data: existing } = await supabase.from("qc_issues").select("id, details, status").eq("booking_id", bookingId).eq("issue_type", "addon").maybeSingle();
  const merged = mergeLines(parseExistingLines(existing?.details), incoming);
  if (merged.length === 0) return null;
  const totalCents = merged.reduce((s, l) => s + Math.max(0, Number(l.amount_cents || 0)), 0);
  const details = {
    kind: "addon",
    addons: merged,
    total_cents: totalCents,
    before_photo_urls: httpUrls(booking.before_photos),
    after_photo_urls: httpUrls(booking.after_photos)
  };
  const title = `Add-ons: ${merged.map((l) => l.label).join(", ")}`.slice(0, 200);
  const description = [buildDescription(merged), opts.note ? `
${opts.note}` : ""].filter(Boolean).join("");
  const status = statusForLines(merged);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const { data: docRow } = await supabase.from("job_documentation").select("id").eq("booking_id", bookingId).maybeSingle();
  if (existing?.id) {
    const patch = {
      title,
      description,
      details,
      severity: "low",
      status,
      documentation_id: docRow?.id || null,
      job_id: booking.job_id || null,
      updated_at: now
    };
    if (status === "resolved") {
      patch.resolved_at = now;
      patch.resolved_by_name = "System";
      patch.resolution_note = "Documented on the QC record for the dispute packet \u2014 not a quality complaint.";
    } else {
      patch.resolved_at = null;
      patch.resolved_by_name = null;
    }
    await supabase.from("qc_issues").update(patch).eq("id", existing.id);
    await supabase.from("qc_issue_events").insert({
      issue_id: existing.id,
      action: "note",
      note: `Add-on documentation refreshed (${merged.length} service${merged.length === 1 ? "" : "s"}).`,
      actor_name: "System",
      data: { issue_type: "addon", total_cents: totalCents }
    }).then(() => void 0, () => void 0);
    return String(existing.id);
  }
  const { data: issue, error } = await supabase.from("qc_issues").insert({
    booking_id: bookingId,
    job_id: booking.job_id || null,
    client_type: clientTypeOf(booking),
    documentation_id: docRow?.id || null,
    cleaner_id: null,
    cleaner_name: null,
    cleaners: [],
    client_name: `${booking.first_name || ""} ${booking.last_name || ""}`.trim() || null,
    client_email: booking.email || null,
    booking_ref: bookingRefOf(booking),
    issue_type: "addon",
    severity: "low",
    status,
    title,
    description,
    details,
    reported_via: "system",
    reported_by_name: "Add-on documentation",
    resolution_note: status === "resolved" ? "Documented on the QC record for the dispute packet \u2014 not a quality complaint." : null,
    resolved_at: status === "resolved" ? now : null,
    resolved_by_name: status === "resolved" ? "System" : null
  }).select("id").maybeSingle();
  if (error) throw error;
  if (issue?.id) {
    await supabase.from("qc_issue_events").insert({
      issue_id: issue.id,
      action: "created",
      to_status: status,
      note: description.slice(0, 2e3),
      actor_name: "System",
      data: { issue_type: "addon", total_cents: totalCents }
    }).then(() => void 0, () => void 0);
  }
  return issue?.id ? String(issue.id) : null;
}
async function documentBookingAddonsInQcSafe(supabase, opts) {
  try {
    await documentBookingAddonsInQc(supabase, opts);
  } catch (e) {
    console.warn(
      "[addon-qc] documentation failed (non-blocking)",
      e instanceof Error ? e.message : String(e)
    );
  }
}

// supabase/functions/_shared/app-secrets.ts
var cache = /* @__PURE__ */ new Map();
async function resolveSecret(supabase, name) {
  if (cache.has(name)) return cache.get(name) ?? "";
  let value = "";
  try {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", name).maybeSingle();
    if (data?.value && typeof data.value === "string") {
      value = data.value.trim();
    }
  } catch (err) {
    console.warn(`[app-secrets] DB read failed for ${name}`, err);
  }
  if (!value) {
    value = (Deno.env.get(name) || "").trim();
  }
  cache.set(name, value);
  return value;
}

// supabase/functions/_shared/sms.ts
var SUPPORTED_TYPES = ["job_offer", "reminder", "confirmation", "verification"];
async function describeInvokeError(err, data) {
  try {
    const ctx = err?.context;
    if (ctx && typeof ctx.text === "function" && !ctx.bodyUsed) {
      const text = await ctx.text();
      if (text) return text;
    }
  } catch {
  }
  if (typeof err === "string") return err;
  if (err?.message && err.message !== "Edge Function returned a non-2xx status code") return String(err.message);
  try {
    return JSON.stringify(data ?? err);
  } catch {
    return String(err);
  }
}
async function sendSms(supabase, args) {
  const phone = (args.toPhone || "").toString().trim();
  if (!phone) {
    console.log("[sendSms] Skipped \u2014 no phone");
    return false;
  }
  if (!args.message || !args.message.trim()) {
    console.log("[sendSms] Skipped \u2014 no message");
    return false;
  }
  const type = args.type && SUPPORTED_TYPES.includes(args.type) ? args.type : "confirmation";
  try {
    const { data, error } = await supabase.functions.invoke("send-ghl-sms", {
      body: { phone, message: args.message, type }
    });
    const ghlError = error || data && data.error;
    if (!ghlError) return true;
    const errText = await describeInvokeError(ghlError, data);
    if (/unsubscrib/i.test(errText)) {
      console.warn(`[sendSms] Recipient has unsubscribed (STOP) \u2014 dropping message permanently`, { phone });
      return true;
    }
    console.warn("[sendSms] GHL send failed, falling back to Telnyx", errText.slice(0, 300));
  } catch (err) {
    console.warn(
      "[sendSms] GHL send threw, falling back to Telnyx",
      err instanceof Error ? err.message : String(err)
    );
  }
  try {
    const { error } = await supabase.functions.invoke("send-sms-notification", {
      body: {
        toPhone: phone,
        message: args.message,
        type,
        jobAssignmentId: args.jobAssignmentId
      }
    });
    if (error) {
      console.error("[sendSms] Telnyx fallback invoke error", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[sendSms] Telnyx fallback threw", err instanceof Error ? err.message : String(err));
    return false;
  }
}
function formatServiceDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = /* @__PURE__ */ new Date(`${dateStr}T12:00:00`);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}
function formatTimeSlot(slot) {
  if (!slot) return "";
  const map = {
    "8-12": "8:00 AM \u2013 12:00 PM",
    "12-16": "12:00 PM \u2013 4:00 PM",
    "16-20": "4:00 PM \u2013 8:00 PM"
  };
  return map[slot] || slot;
}

// supabase/functions/_shared/booking-policy.ts
var SUPPORT_PHONE_DISPLAY = "(844) 735-2070";

// supabase/functions/_shared/stripe-invoice-save-card.ts
var invoicePaymentSettingsSaveCard = {
  payment_method_types: ["card"]
};

// supabase/functions/admin-modify-booking/index.ts
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400"
};
var SERVICE_LABELS = {
  standard: "Standard Clean",
  deep: "Deep Clean",
  combo: "Deep + Standard Combo",
  moveInOut: "Move-In / Move-Out Clean"
};
var ADD_ON_LABELS = {
  fridge: "Inside Fridge",
  oven: "Inside Oven",
  windows: "Interior Windows",
  laundry: "Laundry \u2014 wash & fold",
  changeLinens: "Change bed linens",
  dishes: "Dishes & kitchen cleanup",
  baseboards: "Baseboards (hand-wiped)",
  blinds: "Blinds & shutters",
  cabinets: "Inside cabinets",
  walls: "Spot wall washing",
  ceilingFans: "Ceiling fans",
  microwave: "Inside microwave",
  dishwasher: "Inside dishwasher",
  garage: "Garage sweep-out",
  basement: "Basement clean",
  patio: "Patio / balcony",
  petHair: "Heavy pet-hair removal",
  closets: "Inside closets / tidy",
  trashHaul: "Trash haul",
  deepBathroomDetail: "Deep bathroom detail",
  cateringEvent: "Catering / event cleanup",
  firstCleanDeep: "First-clean deep clean",
  pestLight: "Pest \u2014 Light",
  moldMinor: "Mold \u2014 Minor (surface)"
};
function addOnLabel(id) {
  return ADD_ON_LABELS[id] || String(id).replace(/_/g, " ");
}
async function ensureAdminOrVa(admin, req) {
  const auth = req.headers.get("Authorization");
  if (!auth) throw new Error("Admin authorization required");
  const token = auth.replace(/^Bearer\s+/i, "");
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data: u } = await userClient.auth.getUser(token);
  if (!u?.user?.id) throw new Error("Not signed in");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const allowed = (roles || []).some((r) => ["admin", "va"].includes(r.role));
  if (!allowed) throw new Error("Admins or VAs only");
  return u.user.id;
}
function normalizeEmail(raw) {
  return String(raw ?? "").toLowerCase().trim();
}
function normalizePhone(raw) {
  return String(raw ?? "").replace(/\D/g, "");
}
function trimStr(raw) {
  return String(raw ?? "").trim();
}
function errMessage(e) {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e;
    const parts = [o.message, o.details, o.hint].filter(Boolean);
    if (parts.length > 0) return `${parts.join(" \u2014 ")}${o.code ? ` (${o.code})` : ""}`;
    try {
      return JSON.stringify(e);
    } catch {
      return "Unknown error";
    }
  }
  return String(e);
}
async function reissueDepositInvoice(admin, booking) {
  const existingUrl = typeof booking.hosted_invoice_url === "string" ? booking.hosted_invoice_url : null;
  const existingId = typeof booking.stripe_invoice_id === "string" ? booking.stripe_invoice_id : null;
  const amount = Number(booking.deposit_cents || 0);
  if (amount <= 0) return { url: existingUrl, invoiceId: existingId, warning: null };
  try {
    const key = await resolveSecret(admin, "STRIPE_SECRET_KEY");
    if (!key) {
      return {
        url: existingUrl,
        invoiceId: existingId,
        warning: "Stripe is not configured, so the existing pay link was kept."
      };
    }
    const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" });
    if (existingId) {
      try {
        const inv = await stripe.invoices.retrieve(existingId);
        if ((inv.status === "open" || inv.status === "paid") && inv.hosted_invoice_url) {
          if (inv.status === "open") {
            await stripe.invoices.sendInvoice(existingId).catch(() => void 0);
          }
          return { url: inv.hosted_invoice_url, invoiceId: existingId, warning: null };
        }
      } catch {
      }
    }
    const email = String(booking.email || "").trim();
    if (!email) {
      return {
        url: existingUrl,
        invoiceId: existingId,
        warning: "No customer email, so a new deposit invoice could not be created."
      };
    }
    let customerId = typeof booking.customer_id === "string" && booking.customer_id.startsWith("cus_") ? booking.customer_id : "";
    if (!customerId) {
      const found = await stripe.customers.list({ email, limit: 1 });
      customerId = found.data[0]?.id || "";
    }
    if (!customerId) {
      const created = await stripe.customers.create({
        email,
        name: `${booking.first_name || ""} ${booking.last_name || ""}`.trim() || void 0,
        phone: String(booking.phone || "") || void 0
      });
      customerId = created.id;
    }
    const description = `Novara deposit \u2014 booking ${booking.booking_number || booking.id}`;
    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: "send_invoice",
      days_until_due: 1,
      description,
      metadata: {
        booking_id: String(booking.id),
        purpose: "deposit",
        reinstated: "true"
      },
      auto_advance: false,
      payment_settings: invoicePaymentSettingsSaveCard
    });
    if (!invoice.id) throw new Error("Stripe did not return invoice id");
    try {
      await stripe.invoiceItems.create({
        customer: customerId,
        invoice: invoice.id,
        amount,
        currency: "usd",
        description
      });
      const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
      await stripe.invoices.sendInvoice(invoice.id).catch(() => void 0);
      return {
        url: finalized.hosted_invoice_url || existingUrl,
        invoiceId: invoice.id,
        warning: null
      };
    } catch (err) {
      await stripe.invoices.del(invoice.id).catch(() => void 0);
      throw err;
    }
  } catch (err) {
    const warning = err instanceof Error ? err.message : String(err);
    console.warn("[admin-modify-booking] reissue invoice failed", warning);
    return { url: existingUrl, invoiceId: existingId, warning };
  }
}
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  try {
    const actorId = await ensureAdminOrVa(admin, req);
    const body = await req.json();
    const action = String(body.action || "update_service");
    const { bookingId, serviceType, homeSizeId, addOns, bedrooms, bathrooms, dwellingType, totalEstimateCents, addOnPrices } = body;
    if (!bookingId) throw new Error("bookingId is required");
    const { data: booking, error: bErr } = await admin.from("bookings").select("*").eq("id", bookingId).single();
    if (bErr || !booking) throw new Error("Booking not found");
    if (action === "update_customer_info") {
      const firstName = trimStr(body.firstName);
      const lastName = trimStr(body.lastName);
      const email = normalizeEmail(body.email);
      const phone = normalizePhone(body.phone);
      const address = trimStr(body.address);
      const city = trimStr(body.city);
      const state = trimStr(body.state);
      const zipCode = trimStr(body.zipCode ?? body.zip);
      if (!firstName) throw new Error("First name is required");
      if (!email || !email.includes("@")) throw new Error("A valid email is required");
      const bookingPatch = {
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        address,
        city,
        state,
        zip_code: zipCode,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      const { error: upErr2 } = await admin.from("bookings").update(bookingPatch).eq("id", bookingId);
      if (upErr2) throw new Error(`Booking update failed: ${errMessage(upErr2)}`);
      const customerPatch = {
        first_name: firstName,
        last_name: lastName,
        email,
        phone: phone || null,
        address: address || null,
        city: city || null,
        state: state || null,
        zip: zipCode || null,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      const customerUuid = typeof booking.customer_id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        booking.customer_id
      ) ? booking.customer_id : null;
      const prevEmail = normalizeEmail(booking.email);
      if (customerUuid || prevEmail) {
        let custQ = admin.from("customers").update(customerPatch);
        custQ = customerUuid ? custQ.eq("id", customerUuid) : custQ.eq("email", prevEmail);
        const { error: custErr } = await custQ;
        if (custErr) {
          console.warn("[admin-modify-booking] customer mirror failed (non-blocking)", errMessage(custErr));
        }
      }
      if (booking.job_id) {
        const jobPatch = {
          address,
          city,
          state,
          zip: zipCode
        };
        const { error: jobErr } = await admin.from("jobs").update(jobPatch).eq("id", booking.job_id);
        if (jobErr) {
          console.warn("[admin-modify-booking] job address mirror failed (non-blocking)", errMessage(jobErr));
        }
      }
      try {
        await admin.from("events").insert({
          event_type: "booking.customer_info_updated",
          source: "admin-modify-booking",
          summary: `Customer info updated on booking ${booking.booking_number || bookingId}`,
          data: {
            booking_id: bookingId,
            by: actorId,
            before: {
              first_name: booking.first_name,
              last_name: booking.last_name,
              email: booking.email,
              phone: booking.phone,
              address: booking.address,
              city: booking.city,
              state: booking.state,
              zip_code: booking.zip_code
            },
            after: bookingPatch
          }
        });
      } catch (evErr) {
        console.warn("[admin-modify-booking] event log failed (non-blocking)", evErr);
      }
      try {
        await admin.functions.invoke("send-zapier-webhook", { body: { bookingId } });
      } catch (e) {
        console.error("[admin-modify-booking] GHL sync failed (non-critical):", e);
      }
      console.log("[admin-modify-booking] customer info updated", { bookingId, actorId, email });
      return new Response(
        JSON.stringify({
          success: true,
          bookingId,
          customer: {
            first_name: firstName,
            last_name: lastName,
            email,
            phone,
            address,
            city,
            state,
            zip_code: zipCode
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }
    if (action === "update_job_notes") {
      const NOTE_MAX = 2e3;
      const accessNotes = String(body.accessNotes ?? body.access_notes ?? "").trim().slice(0, NOTE_MAX);
      const teamNotes = String(body.teamNotes ?? body.team_notes ?? "").trim().slice(0, NOTE_MAX);
      const bookingPatch = {
        access_notes: accessNotes || null,
        team_notes: teamNotes || null,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      const { error: upErr2 } = await admin.from("bookings").update(bookingPatch).eq("id", bookingId);
      if (upErr2) throw new Error(`Booking update failed: ${errMessage(upErr2)}`);
      if (booking.job_id) {
        const { error: jobErr } = await admin.from("jobs").update({ notes: accessNotes || null }).eq("id", booking.job_id);
        if (jobErr) {
          console.warn("[admin-modify-booking] job notes mirror failed (non-blocking)", errMessage(jobErr));
        }
      }
      try {
        await admin.from("events").insert({
          event_type: "booking.job_notes_updated",
          source: "admin-modify-booking",
          summary: `Job notes updated on booking ${booking.booking_number || bookingId}`,
          data: {
            booking_id: bookingId,
            by: actorId,
            before: {
              access_notes: booking.access_notes || null,
              team_notes: booking.team_notes || null
            },
            after: bookingPatch
          }
        });
      } catch (evErr) {
        console.warn("[admin-modify-booking] event log failed (non-blocking)", evErr);
      }
      try {
        await admin.functions.invoke("send-zapier-webhook", { body: { bookingId } });
      } catch (e) {
        console.error("[admin-modify-booking] GHL sync failed (non-critical):", e);
      }
      console.log("[admin-modify-booking] job notes updated", { bookingId, actorId });
      return new Response(
        JSON.stringify({
          success: true,
          bookingId,
          access_notes: accessNotes || null,
          team_notes: teamNotes || null
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }
    if (action === "reinstate_unpaid_deposit") {
      if (booking.payment_received_at) {
        throw new Error("This booking already has a payment \u2014 reopen it as a new booking instead.");
      }
      const alreadyPending = booking.status === "pending_payment";
      if (booking.status !== "cancelled" && !alreadyPending) {
        throw new Error("Only cancelled bookings can be reinstated.");
      }
      const reason = `${booking.auto_cancelled_reason || ""} ${booking.cancel_reason || ""} ${booking.team_notes || ""}`;
      const looksUnpaid = /unpaid.?deposit/i.test(reason) || Boolean(booking.hosted_invoice_url || booking.stripe_invoice_id) || alreadyPending && Number(booking.deposit_cents || 0) > 0;
      if (!looksUnpaid) {
        throw new Error("This cancelled booking is not an unpaid-deposit auto-cancel.");
      }
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const noteLine = alreadyPending ? `Deposit pay link resent ${nowIso.slice(0, 10)}.` : `Reinstated after unpaid-deposit auto-cancel ${nowIso.slice(0, 10)} (customer requested).`;
      const prevNotes = String(booking.team_notes || "").trim();
      const pay = await reissueDepositInvoice(admin, booking);
      const bookingPatch = {
        pending_deposit_started_at: nowIso,
        hosted_invoice_url: pay.url || booking.hosted_invoice_url || null,
        updated_at: nowIso,
        team_notes: prevNotes ? `${prevNotes}
${noteLine}` : noteLine
      };
      if (!alreadyPending) {
        bookingPatch.status = "pending_payment";
        bookingPatch.cancel_reason = null;
        bookingPatch.cancelled_at = null;
        bookingPatch.auto_cancelled_reason = null;
        bookingPatch.cancel_fee_cents = 0;
      }
      if (pay.invoiceId) bookingPatch.stripe_invoice_id = pay.invoiceId;
      let updateQuery = admin.from("bookings").update(bookingPatch).eq("id", bookingId);
      updateQuery = alreadyPending ? updateQuery.eq("status", "pending_payment") : updateQuery.eq("status", "cancelled");
      const { data: updated, error: upErr2 } = await updateQuery.select("id");
      if (upErr2) throw new Error(`Reinstate failed: ${errMessage(upErr2)}`);
      if (!updated || updated.length === 0) {
        throw new Error("Reinstate failed: this booking changed before it could be reopened.");
      }
      await admin.from("booking_emails_sent").delete().eq("booking_id", bookingId).in("kind", [
        "pending_deposit_reminder_30m",
        "pending_deposit_reminder_2h",
        "pending_deposit_reminder_next_day_2h",
        "pending_deposit_auto_cancelled"
      ]);
      const money = `$${((Number(booking.deposit_cents) || 0) / 100).toFixed(2)}`;
      const when = [
        booking.service_date ? formatServiceDate(booking.service_date) : null,
        booking.time_slot ? formatTimeSlot(booking.time_slot) : null
      ].filter(Boolean).join(" \xB7 ");
      const link = pay.url || booking.hosted_invoice_url;
      try {
        if (booking.phone) {
          await sendSms(admin, {
            toPhone: booking.phone,
            message: `Novara Cleaning: Your cleaning${when ? ` (${when})` : ""} is reopened and pending the ${money} deposit.` + (link ? ` Pay here: ${link}` : " Check your email for the invoice.") + ` Call ${SUPPORT_PHONE_DISPLAY} with questions.`,
            type: "confirmation"
          });
        }
      } catch (smsErr) {
        console.warn("[admin-modify-booking] reinstate SMS failed", smsErr);
      }
      if (booking.email && link) {
        try {
          const resendKey = await resolveSecret(admin, "RESEND_API_KEY");
          if (resendKey) {
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${resendKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                from: "Novara Cleaning <support@novaracleaning.com>",
                to: [booking.email],
                subject: `Your Novara cleaning is reopened \u2014 deposit needed`,
                html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#0f172a;line-height:1.55;max-width:560px">
                  <p>Hi ${booking.first_name || "there"},</p>
                  <p>We reopened your cleaning${when ? ` on <strong>${when}</strong>` : ""}. It stays pending until we receive the ${money} deposit.</p>
                  <p style="margin:20px 0"><a href="${link}" style="display:inline-block;background:#5C0FFE;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:600">Pay deposit ${money}</a></p>
                  <p style="font-size:12px;color:#94a3b8">Questions? Call ${SUPPORT_PHONE_DISPLAY}</p>
                </div>`
              })
            });
          }
        } catch (emailErr) {
          console.warn("[admin-modify-booking] reinstate email failed", emailErr);
        }
      }
      try {
        await admin.from("events").insert({
          event_type: "booking.reinstated_unpaid_deposit",
          source: "admin-modify-booking",
          summary: `Reinstated unpaid-deposit booking ${booking.booking_number || bookingId}`,
          data: { booking_id: bookingId, by: actorId, pay_url: link }
        });
      } catch (evErr) {
        console.warn("[admin-modify-booking] event log failed (non-blocking)", evErr);
      }
      try {
        await admin.functions.invoke("send-zapier-webhook", { body: { bookingId } });
      } catch (e) {
        console.error("[admin-modify-booking] GHL sync failed (non-critical):", e);
      }
      return new Response(
        JSON.stringify({
          success: true,
          bookingId,
          status: "pending_payment",
          payUrl: link,
          invoiceWarning: pay.warning,
          resent: alreadyPending
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }
    if (action !== "update_service") {
      throw new Error(`Unknown action: ${action}`);
    }
    if (booking.status === "cancelled") throw new Error("Cannot modify a cancelled booking");
    if (booking.status === "completed") throw new Error("Cannot modify a completed booking");
    const newServiceType = serviceType || booking.service_type;
    const newHomeSize = homeSizeId || booking.home_size_id;
    const newAddOns = Array.isArray(addOns) ? addOns : booking.add_ons || [];
    const newTotalCents = Number.isFinite(totalEstimateCents) ? Math.round(totalEstimateCents) : booking.total_estimate_cents;
    const prevTotalCents = Number(booking.total_estimate_cents || 0);
    const priceMap = addOnPrices && typeof addOnPrices === "object" ? addOnPrices : {};
    const addOnBreakdown = newAddOns.map((id) => {
      const dollars2 = Number(priceMap[id]);
      return Number.isFinite(dollars2) ? `${addOnLabel(id)} ($${dollars2.toFixed(2)})` : addOnLabel(id);
    });
    const update = {
      service_type: newServiceType,
      home_size_id: newHomeSize,
      add_ons: newAddOns,
      total_estimate_cents: newTotalCents,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (bedrooms !== void 0 && bedrooms !== null) update.bedrooms = bedrooms;
    if (bathrooms !== void 0 && bathrooms !== null) update.bathrooms = bathrooms;
    if (dwellingType !== void 0 && dwellingType !== null) update.dwelling_type = dwellingType;
    if (addOnBreakdown.length > 0) {
      const prevNotes = booking.team_notes || "";
      const line = `Service adjusted ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)} \u2014 ${SERVICE_LABELS[newServiceType] || newServiceType}; add-ons: ${addOnBreakdown.join(", ")}; total $${(Math.max(0, newTotalCents) / 100).toFixed(2)}.`;
      update.team_notes = prevNotes ? `${prevNotes}
${line}` : line;
    }
    const { error: upErr } = await admin.from("bookings").update(update).eq("id", bookingId);
    if (upErr) throw new Error(`Booking update failed: ${errMessage(upErr)}`);
    if (booking.job_id) {
      try {
        await ensureJobChecklist(admin, {
          jobId: String(booking.job_id),
          bookingId,
          serviceType: String(newServiceType)
        });
      } catch (e) {
        console.warn("[admin-modify-booking] checklist sync failed (non-blocking)", e);
      }
    }
    await documentBookingAddonsInQcSafe(admin, {
      booking: { ...booking, ...update },
      source: "admin",
      addedIds: newAddOns.filter((a) => !(booking.add_ons || []).includes(a))
    });
    console.log("[admin-modify-booking] updated", { bookingId, actorId, newServiceType, newHomeSize, newTotalCents });
    const svcLabel = SERVICE_LABELS[newServiceType] || newServiceType;
    const dollars = `$${(Math.max(0, newTotalCents) / 100).toFixed(2)}`;
    const priceDiffDollars = (newTotalCents - prevTotalCents) / 100;
    const dateLabel = booking.service_date ? (/* @__PURE__ */ new Date(`${booking.service_date}T12:00:00`)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "your scheduled date";
    const addOnSummary = addOnBreakdown.length > 0 ? addOnBreakdown.join(", ") : newAddOns.length > 0 ? newAddOns.map(addOnLabel).join(", ") : "None";
    try {
      const diffLine = priceDiffDollars > 0 ? ` (+$${priceDiffDollars.toFixed(2)})` : priceDiffDollars < 0 ? ` (-$${Math.abs(priceDiffDollars).toFixed(2)})` : "";
      await sendSms(admin, {
        toPhone: booking.phone,
        message: `Novara Cleaning: Your cleaning${booking.service_date ? ` on ${dateLabel}` : ""} was updated to ${svcLabel}. Add-ons: ${addOnSummary}. New total: ${dollars}${diffLine}. Questions? Call ${SUPPORT_PHONE_DISPLAY}.`,
        type: "confirmation"
      });
      console.log("[admin-modify-booking] customer SMS sent");
    } catch (e) {
      console.error("[admin-modify-booking] SMS failed (non-blocking):", e);
    }
    try {
      await admin.functions.invoke("send-booking-email", {
        body: {
          email: booking.email,
          type: "modification",
          bookingData: {
            ...booking,
            service_type: newServiceType,
            home_size_id: newHomeSize,
            add_ons: newAddOns,
            total_estimate_cents: newTotalCents,
            priceDifference: priceDiffDollars.toFixed(2)
          }
        }
      });
      console.log("[admin-modify-booking] customer email sent");
    } catch (e) {
      console.error("[admin-modify-booking] email failed (non-blocking):", e);
    }
    try {
      await admin.functions.invoke("send-zapier-webhook", { body: { bookingId } });
      console.log("[admin-modify-booking] GHL sync triggered");
    } catch (e) {
      console.error("[admin-modify-booking] GHL sync failed (non-critical):", e);
    }
    return new Response(
      JSON.stringify({ success: true, bookingId, totalEstimateCents: newTotalCents }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const msg = errMessage(error);
    console.error("[admin-modify-booking] ERROR", msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});

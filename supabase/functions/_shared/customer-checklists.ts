// ─── Customer-facing cleaning checklists ───────────────────────────────
//
// One place for the scope-of-work content the customer sees: the email
// that goes out when a booking is confirmed, the personal checklist page
// (/my-checklist/<token>), and the admin resend tooling. Pure data and
// helpers — no I/O — so the content can be exercised without a runtime.


// ─── SERVICE-TYPE-AWARE CHECKLIST DATA ───────────────────────────────
//
// Each service type has its own subject, heading, intro, sections, and
// extras list. Extend CHECKLIST_BY_TYPE to add new types — the handler
// routes automatically. Idempotency kind is per-type so a deep_checklist
// and maintenance_checklist can both exist for the same booking without
// conflicting.

export interface ChecklistContent {
  subject: string;
  heading: string;
  intro: string;
  sections: Array<{ title: string; items: string[] }>;
  extras: string[];
  emailKind: string;
}

export const CHECKLIST_BY_TYPE: Record<string, ChecklistContent> = {
  standard: {
    subject: "Your Maintenance Cleaning Checklist — what's included ✨",
    heading: "Maintenance Cleaning Checklist",
    intro:
      "All recurring cleanings (weekly, biweekly and monthly) are what we call <strong>maintenance cleans</strong> because the goal is to <em>maintain the cleanliness</em> of the home. These are thorough, efficient cleanings, covering every area of the house every single time.",
    emailKind: "maintenance_checklist",
    sections: [
      {
        title: "Kitchen",
        items: [
          "Dust and spot clean cabinet fronts",
          "Clean counter tops",
          "Clean sink and polish faucet",
          "Wipe microwave interior and exterior",
          "Dust small appliances & items on counter tops",
          "Clean microwave (inside and out)",
          "Clean/polish oven and refrigerator exterior",
          "Clean/polish stove top and vent hood",
          "Vacuum and mop kitchen floor",
          "Remove trash, replace bag, wipe exterior",
        ],
      },
      {
        title: "Bathrooms",
        items: [
          "Clean mirrors (streak-free)",
          "Dust light fixtures",
          "Spot clean cabinet fronts",
          "Scrub the shower and tub",
          "Clean counters, sinks and polish fixtures",
          "Disinfect toilet and toilet area",
          "Vacuum bathroom rugs",
          "Remove trash, replace bag, wipe exterior",
          "Clean and disinfect bathroom floors",
        ],
      },
      {
        title: "All Rooms",
        items: [
          "Remove cob webs and dust ceiling fans",
          "Dust reachable light fixtures and ceiling fans",
          "Dust wall art and AC/heating vents",
          "Disinfect light switches and door knobs",
          "Dust and spot clean doors and door frames",
          "Dust window sills and window ledges",
          "Dust baseboards and blinds",
          "Dust TVs, electronics, knick-knacks, book tops, picture frames, lamps, etc.",
          "Dust all furniture — polish as needed",
          "Dust banister and handrails",
          "Vacuum all floors/stairs and mop hard surface floors",
          "Vacuum all furniture (if possible)",
          "Change linen and/or make all beds",
          "Clean front/back door glass",
        ],
      },
    ],
    extras: [
      "Hand wash baseboards",
      "Clean oven (interior)",
      "Clean refrigerator/freezer",
      "Wash interior window (must be reachable with a 2-step stool)",
      "Hand wash wood blinds or shutters",
    ],
  },

  deep: {
    subject: "Your Deep Clean Checklist — full scope included ✨",
    heading: "Deep Clean Checklist",
    intro:
      "Your Deep Clean is the thorough reset your home deserves. We go further than a standard maintenance clean — hand-wiping every surface, detail-cleaning appliances, and reaching every corner so your home is set to the highest baseline.",
    emailKind: "deep_checklist",
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
        title: "All Rooms",
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
    extras: [
      "Hand wash baseboards (included in Deluxe)",
      "Clean oven interior",
      "Clean refrigerator and freezer interior",
      "Wash interior windows (reachable with a 2-step stool)",
      "Hand wash wood blinds or shutters (included in Deluxe)",
    ],
  },

  moveinout: {
    subject: "Your Move In/Out Cleaning Checklist — complete scope ✨",
    heading: "Move In/Out Clean Checklist",
    intro:
      "Your Move In/Out Clean covers every inch of the empty home — including everything in a Deep Clean plus the interior of all cabinets, drawers, and built-ins, and inside the refrigerator and oven. Occupied-only lines (furniture, linens, rugs) are marked <em>if present</em> so an empty house can skip them.",
    emailKind: "moveinout_checklist",
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
          "Hand-wipe small appliances and items on countertops (if present)",
          "Remove trash, replace bag, wipe exterior",
          "Clean inside refrigerator and freezer",
          "Clean inside oven",
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
          "Vacuum bathroom rugs (if present)",
          "Remove trash, replace bags, wipe exterior",
        ],
      },
      {
        title: "All Rooms",
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
          "Change linens and/or make beds (if present)",
        ],
      },
    ],
    extras: [
      "Wash interior windows (reachable with a 2-step stool)",
      "Hand wash wood blinds or shutters",
      "Carpet shampooing / steam cleaning (separate service)",
    ],
  },

  combo: {
    subject: "Your Combo Clean Checklist — both visits covered ✨",
    heading: "Combo Clean Checklist",
    intro:
      "Your Combo Clean includes a Deep Clean on the first visit followed by a Standard Maintenance Clean on the follow-up visit. The scope below covers your initial deep clean — your second visit follows the standard maintenance checklist.",
    emailKind: "combo_checklist",
    sections: [
      {
        title: "Kitchen (Deep Clean — First Visit)",
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
        title: "Bathrooms (Deep Clean — First Visit)",
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
        title: "All Rooms (Deep Clean — First Visit)",
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
    extras: [
      "Clean oven interior",
      "Clean refrigerator and freezer interior",
      "Wash interior windows (reachable with a 2-step stool)",
      "Hand wash wood blinds or shutters",
    ],
  },

  commerciallight: {
    subject: "Your Commercial Light checklist — what's included ✨",
    heading: "Commercial Light Checklist",
    intro:
      "A Light commercial visit keeps a maintained facility presentable: floors swept and vacuumed, trash pulled, restrooms reset, and visible spills spot-cleaned. Standard adds mopping, rooms, and touch-point disinfection.",
    emailKind: "commercial_light_checklist",
    sections: [
      {
        title: "Arrival & setup",
        items: [
          "Check in per site access instructions (badge / code / contact)",
          "Notify the required contact on arrival (if specified)",
          "Confirm the alarm is disarmed per the security notes before starting",
          "Walk the site and note anything already damaged or blocked",
        ],
      },
      {
        title: "Light scope — every area in this job",
        items: [
          "Sweep and vacuum all floors in scope",
          "Empty all trash and recycling; replace liners; take to designated disposal",
          "Restrooms: disinfect toilets, sinks, counters, mirrors; restock supplies",
          "Spot-clean visible spills and marks",
        ],
      },
      {
        title: "Documentation",
        items: [
          "Take BEFORE photos of all areas in scope",
          "Take AFTER photos of every area cleaned",
        ],
      },
      {
        title: "Close-out",
        items: [
          "Complete any deep tasks scheduled for this visit (per scope)",
          "Return all furniture and equipment to where you found it",
          "Secure the site per lock-up procedure (doors, alarm, lights)",
          "Notify the required contact on departure (if specified)",
        ],
      },
    ],
    extras: [
      "Catering / event cleanup",
      "Deep bathroom detail (per restroom)",
      "Interior window wash beyond entry glass",
      "After-hours or weekend premium window",
      "Floor machine / scrubber pass",
    ],
  },

  commercialstandard: {
    subject: "Your Commercial Standard checklist — what's included ✨",
    heading: "Commercial Standard Checklist",
    intro:
      "Standard is the default commercial visit. It includes everything in Light, then mops hard floors, resets the break room, wipes individual offices and rooms, and disinfects handles, switches, and rails.",
    emailKind: "commercial_standard_checklist",
    sections: [
      {
        title: "Arrival & setup",
        items: [
          "Check in per site access instructions (badge / code / contact)",
          "Notify the required contact on arrival (if specified)",
          "Confirm the alarm is disarmed per the security notes before starting",
          "Walk the site and note anything already damaged or blocked",
        ],
      },
      {
        title: "Standard scope — every area in this job",
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
      {
        title: "Documentation",
        items: [
          "Take BEFORE photos of all areas in scope",
          "Take AFTER photos of every area cleaned",
        ],
      },
      {
        title: "Close-out",
        items: [
          "Complete any deep tasks scheduled for this visit (per scope)",
          "Return all furniture and equipment to where you found it",
          "Secure the site per lock-up procedure (doors, alarm, lights)",
          "Notify the required contact on departure (if specified)",
        ],
      },
    ],
    extras: [
      "Catering / event cleanup",
      "Deep bathroom detail (per restroom)",
      "Interior window wash beyond entry glass",
      "After-hours or weekend premium window",
      "Floor machine / scrubber pass",
    ],
  },

  commercialdetailed: {
    subject: "Your Commercial Detailed checklist — full scope included ✨",
    heading: "Commercial Detailed Checklist",
    intro:
      "Detailed is the reset pass: everything in Standard, then floor edges and grout, a high-touch sanitization of shared equipment, detail dusting of ledges and vents, and streak-free interior glass.",
    emailKind: "commercial_detailed_checklist",
    sections: [
      {
        title: "Arrival & setup",
        items: [
          "Check in per site access instructions (badge / code / contact)",
          "Notify the required contact on arrival (if specified)",
          "Confirm the alarm is disarmed per the security notes before starting",
          "Walk the site and note anything already damaged or blocked",
        ],
      },
      {
        title: "Detailed scope — every area in this job",
        items: [
          "Sweep and vacuum all floors in scope",
          "Empty all trash and recycling; replace liners; take to designated disposal",
          "Restrooms: disinfect toilets, sinks, counters, mirrors; restock supplies",
          "Spot-clean visible spills and marks",
          "Mop all hard floors",
          "Break room / kitchenette: counters, sink, appliance exteriors, tables",
          "Individual offices and rooms: surfaces wiped, trash pulled, floors done",
          "Wipe and disinfect touch points (handles, switches, rails)",
          "Scrub floors — grout lines, edges, and corners, not just the open middle",
          "High-touch sanitization pass: shared equipment, phones, rails, dispensers",
          "Detail dusting: ledges, sills, vents, fixtures, tops of partitions",
          "Interior glass and entry doors, streak-free",
        ],
      },
      {
        title: "Documentation",
        items: [
          "Take BEFORE photos of all areas in scope",
          "Take AFTER photos of every area cleaned",
        ],
      },
      {
        title: "Close-out",
        items: [
          "Complete any deep tasks scheduled for this visit (per scope)",
          "Return all furniture and equipment to where you found it",
          "Secure the site per lock-up procedure (doors, alarm, lights)",
          "Notify the required contact on departure (if specified)",
        ],
      },
    ],
    extras: [
      "Catering / event cleanup",
      "Deep bathroom detail (per restroom)",
      "Interior window wash beyond entry glass",
      "After-hours or weekend premium window",
      "Floor machine / scrubber pass",
    ],
  },

  office: {
    subject: "Your Office Clean checklist — after-hours scope ✨",
    heading: "Office Clean (After-Hours) Checklist",
    intro:
      "Office visits run the Commercial Standard list, then add desk, conference, and lock-up rules so the workspace is usable the next morning.",
    emailKind: "office_checklist",
    sections: [
      {
        title: "Arrival & setup",
        items: [
          "Check in per site access instructions (badge / code / contact)",
          "Notify the required contact on arrival (if specified)",
          "Confirm the alarm is disarmed per the security notes before starting",
          "Walk the site and note anything already damaged or blocked",
        ],
      },
      {
        title: "Standard scope — every area in this job",
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
        title: "Documentation",
        items: [
          "Take BEFORE photos of all areas in scope",
          "Take AFTER photos of every area cleaned",
        ],
      },
      {
        title: "Close-out",
        items: [
          "Complete any deep tasks scheduled for this visit (per scope)",
          "Return all furniture and equipment to where you found it",
          "Secure the site per lock-up procedure (doors, alarm, lights)",
          "Notify the required contact on departure (if specified)",
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
    ],
    extras: [
      "Catering / event cleanup",
      "Deep bathroom detail (per restroom)",
      "Interior window wash beyond entry glass",
      "After-hours or weekend premium window",
      "Floor machine / scrubber pass",
    ],
  },
};

export function resolveChecklistType(serviceType: string, scopeLevel?: string | null): string {
  const lower = (serviceType || "").toLowerCase().replace(/[\s_-]/g, "");
  if (lower.includes("move") || lower.includes("inout")) return "moveinout";
  if (lower === "deep") return "deep";
  if (lower === "combo") return "combo";
  if (lower.includes("office")) return "office";
  if (lower.includes("commercial") || lower === "light" || lower === "detailed") {
    const scope = String(scopeLevel || lower.replace("commercial", "") || "standard").toLowerCase();
    if (scope.includes("light")) return "commerciallight";
    if (scope.includes("detailed")) return "commercialdetailed";
    if (lower === "light") return "commerciallight";
    if (lower === "detailed") return "commercialdetailed";
    return "commercialstandard";
  }
  return "standard";
}

// ─── Personal checklist ────────────────────────────────────────────────
//
// The same scope as the public page for that service, plus what is specific
// to this customer's visit: when and where, their add-ons (listed on their
// own, not offered again as extras), and the notes they gave about pets and
// access. Read live from the booking, so a reschedule or an added add-on
// shows up on the page without sending anything again.

export const CUSTOMER_SITE_ORIGIN = "https://try.novaracleaning.com";

export function personalChecklistUrl(token: string): string {
  return `${CUSTOMER_SITE_ORIGIN}/my-checklist/${encodeURIComponent(token)}`;
}

const ADD_ON_LABELS: Record<string, string> = {
  fridge: "Inside the refrigerator",
  oven: "Inside the oven",
  windows: "Interior windows",
  laundry: "Laundry (wash, dry, fold)",
  changeLinens: "Change bed linens",
  dishes: "Dishes",
  baseboards: "Hand-wash baseboards",
  blinds: "Blinds",
  cabinets: "Inside cabinets",
  walls: "Wall spot-washing",
  ceilingFans: "Ceiling fans",
  microwave: "Microwave detail",
  dishwasher: "Dishwasher",
  garage: "Garage sweep",
  basement: "Basement",
  patio: "Patio or balcony",
  petHair: "Pet hair treatment",
  closets: "Closets",
  trashHaul: "Trash haul-away",
  deepBathroomDetail: "Deep bathroom detail",
  cateringEvent: "Catering or event cleanup",
  firstCleanDeep: "First-clean deep clean",
  pestLight: "Light pest-evidence cleanup",
  moldMinor: "Minor mold treatment",
};

/** An add-on the customer booked already covers the matching line under "Extras". */
const ADD_ON_COVERS_EXTRA: Record<string, RegExp> = {
  fridge: /refrigerator|fridge/i,
  oven: /\boven\b/i,
  windows: /window/i,
  baseboards: /baseboard/i,
  blinds: /blinds|shutters/i,
};

export function addOnLabel(id: string): string {
  const known = ADD_ON_LABELS[id];
  if (known) return known;
  const spaced = String(id || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : "";
}

export function stripTags(value: string): string {
  return String(value || "").replace(/<[^>]+>/g, "").replace(/\s{2,}/g, " ").trim();
}

export interface PersonalChecklistBooking {
  first_name?: string | null;
  booking_number?: number | null;
  service_type?: string | null;
  scope_level?: string | null;
  service_date?: string | null;
  time_slot?: string | null;
  arrival_window?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  bedrooms?: number | string | null;
  bathrooms?: number | string | null;
  dwelling_type?: string | null;
  frequency?: string | null;
  add_ons?: unknown;
  pets?: string | null;
  access_notes?: string | null;
}

export interface PersonalChecklist {
  checklistType: string;
  heading: string;
  intro: string;
  firstName: string;
  bookingNumber: string | null;
  visit: {
    serviceDate: string | null;
    arrivalWindow: string | null;
    address: string | null;
    home: string | null;
    frequency: string | null;
  };
  yourAddOns: string[];
  notes: Array<{ label: string; value: string }>;
  sections: Array<{ title: string; items: string[] }>;
  extras: string[];
}

function prettyDate(ymd: string | null | undefined): string | null {
  if (!ymd) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd}T12:00:00` : ymd);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function frequencyLabel(value: string | null | undefined): string | null {
  const key = String(value || "").toLowerCase().replace(/[\s_-]/g, "");
  if (!key || key === "onetime" || key === "once" || key === "none") return "One-time";
  if (key === "weekly") return "Weekly";
  if (key === "biweekly") return "Every two weeks";
  if (key === "monthly") return "Monthly";
  return null;
}

export function buildPersonalChecklist(booking: PersonalChecklistBooking): PersonalChecklist {
  const checklistType = resolveChecklistType(booking.service_type || "standard", booking.scope_level);
  const content = CHECKLIST_BY_TYPE[checklistType] ?? CHECKLIST_BY_TYPE.standard;

  const addOnIds = (Array.isArray(booking.add_ons) ? booking.add_ons : [])
    .map((entry) => (typeof entry === "string" ? entry : String((entry as { id?: string })?.id || "")))
    .filter(Boolean);
  const yourAddOns = Array.from(new Set(addOnIds.map(addOnLabel).filter(Boolean)));

  const covered = addOnIds.map((id) => ADD_ON_COVERS_EXTRA[id]).filter(Boolean);
  const extras = content.extras.filter((line) => !covered.some((re) => re.test(line)));

  const street = [booking.address, booking.city, booking.state].map((part) => String(part || "").trim()).filter(Boolean);
  const bedrooms = booking.bedrooms === null || booking.bedrooms === undefined || booking.bedrooms === "" ? null : Number(booking.bedrooms);
  const bathrooms = booking.bathrooms === null || booking.bathrooms === undefined || booking.bathrooms === "" ? null : Number(booking.bathrooms);
  const homeBits: string[] = [];
  if (bedrooms !== null && Number.isFinite(bedrooms)) homeBits.push(`${bedrooms} bed`);
  if (bathrooms !== null && Number.isFinite(bathrooms)) homeBits.push(`${bathrooms} bath`);
  const dwelling = String(booking.dwelling_type || "").replace(/[_-]+/g, " ").trim();
  if (dwelling) homeBits.push(dwelling);

  const notes: Array<{ label: string; value: string }> = [];
  if (String(booking.pets || "").trim()) notes.push({ label: "Pets", value: String(booking.pets).trim() });
  if (String(booking.access_notes || "").trim()) notes.push({ label: "Access notes", value: String(booking.access_notes).trim() });

  return {
    checklistType,
    heading: content.heading,
    intro: stripTags(content.intro),
    firstName: String(booking.first_name || "").trim() || "there",
    bookingNumber: booking.booking_number ? `NVC-${String(booking.booking_number).padStart(4, "0")}` : null,
    visit: {
      serviceDate: prettyDate(booking.service_date),
      arrivalWindow: String(booking.arrival_window || booking.time_slot || "").trim() || null,
      address: street.length ? street.join(", ") : null,
      home: homeBits.length ? homeBits.join(" · ") : null,
      frequency: frequencyLabel(booking.frequency),
    },
    yourAddOns,
    notes,
    sections: content.sections,
    extras,
  };
}

/** A visit can be viewed until a month after it happened. Cancelled visits show nothing. */
export const CHECKLIST_VIEW_DAYS_AFTER_SERVICE = 30;

const META_CELL = "padding:8px 0;border-bottom:1px solid #3a3a40;";

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function personalRow(label: string, value: string | null): string {
  if (!value) return "";
  return `<tr><td style="${META_CELL}">${escapeHtml(label)}</td><td style="${META_CELL}font-weight:600;text-align:right">${escapeHtml(value)}</td></tr>`;
}

export function renderPersonalEmail(checklist: PersonalChecklist, url: string): string {
  const rows = [
    personalRow("Booking", checklist.bookingNumber),
    personalRow("Date", checklist.visit.serviceDate),
    personalRow("Arrival window", checklist.visit.arrivalWindow),
    personalRow("Address", checklist.visit.address),
    personalRow("Home", checklist.visit.home),
    personalRow("Frequency", checklist.visit.frequency),
  ].join("");
  const table = rows
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px">${rows}</table>`
    : "";
  const addOns = checklist.yourAddOns.length
    ? `<p style="margin:0 0 8px;"><strong style="color:#ffffff;">Your add-ons</strong></p><ul style="margin:0 0 16px;padding-left:20px;line-height:1.65">${
      checklist.yourAddOns.map((label) => `<li>${escapeHtml(label)}</li>`).join("")
    }</ul>`
    : "";
  const areas = `<p style="margin:0 0 8px;"><strong style="color:#ffffff;">What we cover</strong></p><ul style="margin:0 0 16px;padding-left:20px;line-height:1.65">${
    checklist.sections.map((section) => `<li>${escapeHtml(section.title)} (${section.items.length} tasks)</li>`).join("")
  }</ul>`;
  return `<h1 style="margin:0 0 14px;font-family:Inter,Arial,sans-serif;font-size:28px;line-height:1.2;font-weight:700;color:#ffffff;">Your cleaning checklist</h1>
<p style="margin:0 0 16px;">Hi ${escapeHtml(checklist.firstName)}, this is exactly what the Novara team will do on your visit. It is built from the home and add-ons you booked, and it stays up to date if anything about your booking changes.</p>
${table}${addOns}${areas}
<p style="margin:22px 0 0;"><a class="novara-btn" href="${escapeHtml(url)}" style="display:inline-block;padding:14px 28px;background:#e7e7ea;color:#18181b;text-decoration:none;border-radius:12px;font-weight:600;">Open your checklist</a></p>
<p style="margin:16px 0 0;font-size:14px;">This link is private to your booking, so please do not forward it. Questions or something to add? Reply to this email or text (844) 735-2070.</p>`;
}

export function checklistViewState(
  booking: { status?: string | null; service_date?: string | null },
  now: Date = new Date(),
): "ok" | "cancelled" | "expired" {
  if (String(booking.status || "").toLowerCase() === "cancelled") return "cancelled";
  if (!booking.service_date) return "ok";
  const day = new Date(`${String(booking.service_date).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(day.getTime())) return "ok";
  const cutoff = day.getTime() + CHECKLIST_VIEW_DAYS_AFTER_SERVICE * 24 * 60 * 60 * 1000;
  return now.getTime() > cutoff ? "expired" : "ok";
}

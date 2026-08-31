// ─── Proposal request catalog ──────────────────────────────────────────────
//
// The dedicated Proposals tab is the front door to the existing commercial
// walkthrough → firm price → proposal-to-billing pipeline. This module is the
// admin-editable content: property types, light intake questions, and the
// site-findings fields the walkthrough token captures. Crew execution lists
// live on a separate job-checklist token after dispatch — they are not
// copied onto the walkthrough.
//
// Saved copies live in app_settings.proposal_walkthrough_checklists. Defaults
// here merge underneath so a new item we ship appears without a re-seed, and
// an admin rewrite of a key still wins.

import {
  defaultScopeTemplateForType,
  isScopeTemplate,
  mergeScopeSections,
  scopeSectionsFromTemplate,
  type ScopeChecklistSection,
  type ScopeTemplateKey,
} from "@/lib/proposal-scope-checklists";

export type { ScopeChecklistSection, ScopeTemplateKey } from "@/lib/proposal-scope-checklists";

export const PROPOSAL_CHECKLISTS_KEY = "proposal_walkthrough_checklists";
export const PROPOSAL_SETTINGS_KEY = "proposal_request_settings";

export const PROPOSAL_REQUEST_STATUSES = [
  "pending_assign",
  "walkthrough_scheduled",
  "walkthrough_conducted",
  "firm_price_set",
  "excluded",
  "cancelled",
] as const;
export type ProposalRequestStatus = (typeof PROPOSAL_REQUEST_STATUSES)[number];

export const PROPOSAL_STATUS_LABELS: Record<ProposalRequestStatus, string> = {
  pending_assign: "Pending — Assigning Walkthrough Agent",
  walkthrough_scheduled: "Walkthrough Scheduled",
  walkthrough_conducted: "Walkthrough Conducted",
  firm_price_set: "Firm Price Set",
  excluded: "Excluded",
  cancelled: "Cancelled",
};

export type AccountKind = "commercial" | "office" | "str";
export type ChecklistFieldKind =
  | "number"
  | "integer"
  | "text"
  | "textarea"
  | "select"
  | "multiselect"
  | "yesno"
  | "time"
  | "floor_share"
  | "media"
  | "exclusion";

export interface SelectOption {
  value: string;
  label: string;
}

export interface ChecklistItem {
  key: string;
  label: string;
  help?: string;
  kind: ChecklistFieldKind;
  required?: boolean;
  options?: SelectOption[];
  /** Maps onto commercial_walkthroughs when the contractor submits. */
  mapsTo?: string;
}

export interface PropertyTypeDef {
  key: string;
  label: string;
  shortLabel: string;
  accountKind: AccountKind;
  /** commercial_facility_types key used by the existing pricing formula. */
  facilityTypeKey: string;
  sort: number;
  active: boolean;
}

export interface ProposalChecklists {
  types: PropertyTypeDef[];
  intakeByType: Record<string, ChecklistItem[]>;
  universal: ChecklistItem[];
  byType: Record<string, ChecklistItem[]>;
  /** Published /checklist slug this type starts from (admin can then edit). */
  scopeTemplateByType: Record<string, ScopeTemplateKey>;
  /** Published crew-list template for this type (job token after booking, not the walkthrough). */
  scopeByType: Record<string, ScopeChecklistSection[]>;
}

export type WalkthroughPayType = "flat" | "hourly";

export interface ProposalRequestSettings {
  pendingEmailSubject: string;
  pendingEmailBody: string;
  scheduledEmailSubject: string;
  scheduledEmailBody: string;
  adminNotifyEmail: string;
  walkthroughPayType: WalkthroughPayType;
  walkthroughPayCents: number;
  walkthroughHourlyCents: number;
  tokenTtlHours: number;
  agentEmailSubject: string;
  agentEmailBody: string;
}

export const FREQUENCIES = [
  "Daily",
  "Several times a week",
  "Weekly",
  "Bi-weekly",
  "Monthly",
  "As needed / on-call",
  "Not sure yet",
];

export const START_TIMEFRAMES = [
  "As soon as possible",
  "Within 2 weeks",
  "Within a month",
  "1–3 months",
  "Just exploring",
];

export const LEAD_SOURCES = [
  "Google",
  "Referral",
  "Instagram",
  "Yelp",
  "Repeat contact",
  "Inbound call",
  "Inbound email",
  "Other",
];

export const WALKTHROUGH_EXCLUSION_CODES: Record<string, string> = {
  none: "No excluded condition found",
  mold_over_threshold: "Mold beyond minor surface area",
  active_infestation: "Active pest infestation or bed bugs",
  biohazard: "Biohazard material — NovaraCleaning does not handle biohazard",
  structural_hazard: "Structural hazard",
  other: "Other condition outside our scope",
};

export const CONDITION_OPTIONS: SelectOption[] = [
  { value: "good", label: "Good — maintained, no backlog" },
  { value: "average", label: "Average — normal wear" },
  { value: "poor", label: "Poor — visible backlog, heavier first visit" },
  { value: "severe", label: "Severe — needs a restoration pass first" },
];

export const DENSITY_OPTIONS: SelectOption[] = [
  { value: "low", label: "Low — open floor, little to work around" },
  { value: "moderate", label: "Moderate — normal furniture/equipment" },
  { value: "high", label: "High — dense racking, shelving, or workstations" },
  { value: "severe", label: "Severe — access is the job" },
];

export const SCOPE_OPTIONS: SelectOption[] = [
  { value: "light", label: "Light" },
  { value: "standard", label: "Standard" },
  { value: "detailed", label: "Detailed" },
];

export const ACCESS_OPTIONS: SelectOption[] = [
  { value: "keys", label: "Keys" },
  { value: "code", label: "Code / keypad" },
  { value: "badge", label: "Badge / keycard" },
  { value: "lockbox", label: "Lockbox" },
  { value: "smart_lock", label: "Smart lock" },
  { value: "on_site_contact", label: "On-site contact lets crew in" },
  { value: "alarm", label: "Alarm procedure" },
];

export const DEFAULT_PROPERTY_TYPES: PropertyTypeDef[] = [
  { key: "str", label: "STR / Short-Term Rental", shortLabel: "STR", accountKind: "str", facilityTypeKey: "other", sort: 10, active: true },
  { key: "office", label: "Office", shortLabel: "Office", accountKind: "office", facilityTypeKey: "office", sort: 20, active: true },
  { key: "retail", label: "Commercial — Retail", shortLabel: "Retail", accountKind: "commercial", facilityTypeKey: "retail", sort: 30, active: true },
  { key: "warehouse", label: "Commercial — Warehouse / Industrial", shortLabel: "Warehouse", accountKind: "commercial", facilityTypeKey: "warehouse", sort: 40, active: true },
  { key: "restaurant", label: "Commercial — Restaurant", shortLabel: "Restaurant", accountKind: "commercial", facilityTypeKey: "restaurant", sort: 50, active: true },
  { key: "gym", label: "Commercial — Gym / Fitness", shortLabel: "Gym", accountKind: "commercial", facilityTypeKey: "gym", sort: 60, active: true },
  { key: "medical", label: "Commercial — Medical / Clinical", shortLabel: "Medical", accountKind: "commercial", facilityTypeKey: "medical", sort: 70, active: true },
  { key: "other", label: "Other", shortLabel: "Other", accountKind: "commercial", facilityTypeKey: "other", sort: 80, active: true },
];

const UNIVERSAL: ChecklistItem[] = [
  {
    key: "confirmed_sqft",
    label: "Confirmed square footage",
    help: "Measured or verified on site. This supersedes what the client stated and is the number of record for pricing.",
    kind: "integer",
    required: true,
    mapsTo: "sqft",
  },
  {
    key: "floor_type_breakdown",
    label: "Floor type breakdown",
    help: "Approximate share of carpet / hard floor / tile / sealed concrete. This drives equipment and labor more than raw sqft.",
    kind: "floor_share",
    required: true,
    mapsTo: "floor_types",
  },
  {
    key: "restroom_count",
    label: "Restroom count",
    kind: "integer",
    required: true,
    mapsTo: "restroom_count",
  },
  {
    key: "condition_rating",
    label: "Current condition rating",
    help: "Feeds the scope-level recommendation.",
    kind: "select",
    required: true,
    options: CONDITION_OPTIONS,
    mapsTo: "condition_level",
  },
  {
    key: "obstacle_density",
    label: "Obstacle / complexity density",
    kind: "select",
    required: true,
    options: DENSITY_OPTIONS,
    mapsTo: "obstacle_density",
  },
  {
    key: "exclusion_check",
    label: "Exclusion check",
    help: "Mold, pest, biohazard, or structural hazard stops pricing and routes to existing exclusion handling. NovaraCleaning does not handle biohazard.",
    kind: "exclusion",
    required: true,
  },
  {
    key: "exclusion_note",
    label: "Exclusion notes",
    help: "Required if an excluded condition is found — this is what the client will be told.",
    kind: "textarea",
  },
  {
    key: "service_window_start",
    label: "Service window starts",
    help: "Hours the space is realistically available.",
    kind: "time",
    required: true,
    mapsTo: "service_window_start",
  },
  {
    key: "service_window_end",
    label: "Service window ends",
    kind: "time",
    required: true,
    mapsTo: "service_window_end",
  },
  {
    key: "recommended_scope",
    label: "Recommended scope level",
    kind: "select",
    required: true,
    options: SCOPE_OPTIONS,
    mapsTo: "scope_level",
  },
  {
    key: "badge_required",
    label: "Badge or keycard required",
    kind: "yesno",
    required: true,
    mapsTo: "badge_required",
  },
  {
    key: "photos",
    label: "Photos + video",
    help: "Condition photos and a short walkthrough clip. Uploaded to this site's dated Drive folder.",
    kind: "media",
    required: true,
    mapsTo: "photos",
  },
  {
    key: "access_procedure",
    label: "Access / alarm procedure",
    help: "Optional. Keys, codes, badge, lockbox, on-site contact, alarm arm/disarm.",
    kind: "textarea",
    mapsTo: "after_hours_access_notes",
  },
  {
    key: "parking_loading",
    label: "Parking / loading for the crew",
    help: "Optional. Distance from entry to the work area.",
    kind: "textarea",
    mapsTo: "loading_dock_notes",
  },
  {
    key: "service_window_notes",
    label: "Service window notes",
    help: "Optional. Anything the start/end times do not capture.",
    kind: "textarea",
    mapsTo: "service_window_notes",
  },
  {
    key: "obstacles",
    label: "Obstacles / complexity notes",
    help: "Optional. What the crew will work around.",
    kind: "textarea",
    mapsTo: "obstacles",
  },
  {
    key: "trash_volume",
    label: "Trash / waste notes",
    help: "Optional. Receptacle count, dumpster, compactor, haul distance.",
    kind: "textarea",
  },
  {
    key: "janitor_closet",
    label: "Water source / janitor closet",
    help: "Optional. Note where it is — or that there isn't one.",
    kind: "textarea",
  },
  {
    key: "restroom_fixtures",
    label: "Restroom fixture notes",
    help: "Optional. Toilets, urinals, sinks — anything unusual.",
    kind: "textarea",
  },
  {
    key: "floor_count",
    label: "Floor count",
    help: "Optional. Defaults to 1 if blank.",
    kind: "integer",
    mapsTo: "floor_count",
  },
  {
    key: "breakroom_count",
    label: "Breakroom / kitchen count",
    help: "Optional. Use 0 if the site has none.",
    kind: "integer",
    mapsTo: "breakroom_count",
  },
  {
    key: "recommended_crew_size",
    label: "Recommended crew size",
    help: "Optional. Defaults to 2 if blank.",
    kind: "integer",
    mapsTo: "recommended_crew_size",
  },
  {
    key: "elevator_stairs",
    label: "Elevator / stairs",
    help: "Optional. Whether equipment can move between floors.",
    kind: "textarea",
  },
];

/** Dropped from the walkthrough so a saved admin catalog cannot put them back. */
export const RETIRED_FINDING_KEYS = new Set([
  "on_site_storage",
  "on_site_storage_notes",
  "access_method",
  "bed_count_sizes",
  "washer_dryer",
  "consumables",
  "staging",
  "inventory_damage",
  "guest_capacity",
  "extras_on_property",
  "trash_recycling_schedule",
  "str_access",
  "private_office_count",
  "open_vs_enclosed",
  "conference_rooms",
  "breakroom_kitchen",
  "reception_glass",
  "confidential_waste",
  "after_hours_alarm",
  "interior_glass",
  "stockroom_sqft",
  "fitting_room_count",
  "customer_vs_employee_restrooms",
  "storefront_glass",
  "fixture_density",
  "pos_count",
  "foot_traffic",
  "internal_office_sqft",
  "dock_doors",
  "machinery_on_floor",
  "ceiling_height_high_dusting",
  "forklift_traffic",
  "required_ppe",
  "breakroom_restroom_locations",
  "kitchen_equipment",
  "grease_floor_drains",
  "dining_seats",
  "dining_sqft",
  "bar_area",
  "walk_in_scope",
  "customer_vs_staff_restrooms",
  "health_code_notes",
  "equipment_count_type",
  "shower_count",
  "sauna_steam",
  "studio_count",
  "turf_mat",
  "bottle_fill",
  "high_touch_sanitization",
  "waiting_reception",
  "compliance_standards",
  "after_hours_escort",
]);

const INTAKE: Record<string, ChecklistItem[]> = {
  str: [
    { key: "approx_bedrooms", label: "Approximate bedroom count", kind: "integer" },
    { key: "approx_bathrooms", label: "Approximate bathroom count", kind: "integer" },
    {
      key: "linen_handling_guess",
      label: "How are linens handled today?",
      kind: "select",
      options: [
        { value: "host_on_site", label: "Host-provided on site" },
        { value: "on_site_laundry", label: "On-site laundry" },
        { value: "cleaner_offsite", label: "Cleaner launders off-site" },
        { value: "linen_service", label: "Linen service" },
        { value: "unknown", label: "Not sure yet" },
      ],
    },
    { key: "typical_turnover_window", label: "Typical checkout → check-in window", kind: "text", help: "The hard deadline that will govern every future job." },
  ],
  office: [
    { key: "approx_desks", label: "Approximate workstation / desk count", kind: "integer" },
    { key: "approx_headcount", label: "Approximate employee headcount", kind: "integer", help: "Drives restroom and breakroom load more than sqft." },
    { key: "after_hours_preferred", label: "After-hours service preferred?", kind: "yesno" },
  ],
  retail: [
    { key: "operating_hours", label: "Store operating hours", kind: "text", help: "The cleaning window is necessarily outside them." },
    { key: "has_fitting_rooms", label: "Fitting rooms on site?", kind: "yesno" },
  ],
  warehouse: [
    { key: "has_internal_office", label: "Office / admin space inside the facility?", kind: "yesno" },
    {
      key: "auto_scrubber_guess",
      label: "Could an auto-scrubber access the floor?",
      kind: "select",
      options: [
        { value: "unknown", label: "Not sure yet — confirm on site" },
        { value: "yes", label: "Yes, looks suitable" },
        { value: "no", label: "No — racking or equipment in the way" },
      ],
    },
  ],
  restaurant: [
    {
      key: "hood_handling",
      label: "Hood / exhaust",
      kind: "select",
      options: [
        { value: "specialist", label: "Handled by a specialist vendor (usual)" },
        { value: "in_scope", label: "Client wants it in our scope" },
        { value: "unknown", label: "Confirm at walkthrough" },
      ],
    },
    { key: "typical_close_time", label: "How late does close actually run?", kind: "text" },
  ],
  gym: [
    { key: "is_24_hour", label: "24-hour facility?", kind: "yesno", help: "If yes, there is no closed window — confirm how service happens around members." },
    { key: "has_locker_rooms", label: "Locker rooms / showers on site?", kind: "yesno" },
  ],
  medical: [
    {
      key: "biohazard_client_managed",
      label: "Client manages biohazard / sharps?",
      help: "NovaraCleaning does not handle biohazard. Confirm this is client-managed before we walk the site.",
      kind: "yesno",
      required: true,
    },
    { key: "escort_required", label: "After-hours escort required?", kind: "yesno" },
  ],
  other: [
    { key: "space_description", label: "Describe the space", kind: "textarea", required: true },
  ],
};

const BY_TYPE: Record<string, ChecklistItem[]> = {
  str: [
    { key: "bedroom_count", label: "Bedroom count", kind: "integer", required: true },
    { key: "bathroom_count", label: "Bathroom count", kind: "integer", required: true },
    {
      key: "linen_handling",
      label: "Linen handling",
      kind: "select",
      required: true,
      options: [
        { value: "host_on_site", label: "Host-provided on site" },
        { value: "on_site_laundry", label: "On-site laundry" },
        { value: "cleaner_offsite", label: "Cleaner launders off-site" },
        { value: "linen_service", label: "Linen service" },
      ],
    },
    {
      key: "turnover_window",
      label: "Turnover window",
      help: "Checkout → check-in — the hard deadline for every future job.",
      kind: "select",
      required: true,
      options: [
        { value: "under_4h", label: "Under 4 hours" },
        { value: "same_day", label: "Same day (4+ hours)" },
        { value: "next_day", label: "Next-day / overnight" },
        { value: "flexible", label: "Flexible / no same-day turn" },
      ],
    },
    {
      key: "linen_notes",
      label: "Linen / staging notes",
      help: "Optional. Washer-dryer, par levels, towel fold, welcome setup.",
      kind: "textarea",
    },
    {
      key: "guest_notes",
      label: "Unit notes",
      help: "Optional. Extras (hot tub, grill), inventory expectations, trash day.",
      kind: "textarea",
    },
  ],
  office: [
    { key: "desk_count", label: "Workstation / desk count", kind: "integer", required: true },
    {
      key: "employee_headcount",
      label: "Employee headcount",
      help: "Drives restroom and breakroom load far more than sqft.",
      kind: "integer",
      required: true,
    },
    {
      key: "desk_policy",
      label: "Desk policy",
      kind: "select",
      required: true,
      options: [
        { value: "clear_desk", label: "Clear-desk" },
        { value: "do_not_touch_papers", label: "Do not touch papers" },
        { value: "mixed", label: "Mixed / depends on area" },
      ],
    },
    {
      key: "restricted_areas",
      label: "Restricted areas",
      help: "Server/IT rooms, executive offices, secure storage.",
      kind: "textarea",
      required: true,
    },
    {
      key: "office_notes",
      label: "Office notes",
      help: "Optional. Conference rooms, kitchenette, glass, confidential waste.",
      kind: "textarea",
    },
  ],
  retail: [
    {
      key: "sales_floor_sqft",
      label: "Sales floor sqft",
      help: "Priced differently from stockroom / back-of-house.",
      kind: "integer",
      required: true,
    },
    {
      key: "operating_hours_confirmed",
      label: "Operating hours",
      help: "Cleaning window is outside them.",
      kind: "textarea",
      required: true,
    },
    {
      key: "retail_notes",
      label: "Retail notes",
      help: "Optional. Stockroom, fitting rooms, storefront glass, POS count.",
      kind: "textarea",
    },
  ],
  warehouse: [
    {
      key: "open_floor_sqft",
      label: "Open floor sqft",
      help: "Labor differs dramatically from racking-dense sqft.",
      kind: "integer",
      required: true,
    },
    { key: "racking_dense_sqft", label: "Racking-dense sqft", kind: "integer", required: true },
    {
      key: "warehouse_floor_type",
      label: "Floor type",
      kind: "select",
      required: true,
      options: [
        { value: "sealed_concrete", label: "Sealed concrete" },
        { value: "unsealed_concrete", label: "Unsealed concrete" },
        { value: "epoxy", label: "Epoxy" },
        { value: "mixed", label: "Mixed" },
      ],
    },
    { key: "auto_scrubber_suitable", label: "Auto-scrubber can access the floor?", kind: "yesno", required: true },
    {
      key: "warehouse_notes",
      label: "Warehouse notes",
      help: "Optional. Docks, machinery, high dusting, PPE, forklift traffic.",
      kind: "textarea",
    },
  ],
  restaurant: [
    { key: "kitchen_sqft", label: "Kitchen sqft", kind: "integer", required: true },
    {
      key: "hood_exhaust_scope",
      label: "Hood / exhaust",
      help: "Usually a specialist vendor — confirm in or out of scope.",
      kind: "select",
      required: true,
      options: [
        { value: "specialist", label: "Specialist vendor (not in our scope)" },
        { value: "in_scope", label: "In our scope" },
      ],
    },
    {
      key: "after_close_window",
      label: "After-close window",
      help: "How late close actually runs.",
      kind: "textarea",
      required: true,
    },
    {
      key: "restaurant_notes",
      label: "Restaurant notes",
      help: "Optional. Grease, drains, dining, bar, walk-in, health-code notes.",
      kind: "textarea",
    },
  ],
  gym: [
    { key: "locker_room_count", label: "Locker room count", kind: "integer", required: true },
    {
      key: "operating_hours_24",
      label: "24-hour facility?",
      help: "If yes, there is no closed window — note how service happens around members.",
      kind: "yesno",
      required: true,
    },
    {
      key: "gym_notes",
      label: "Gym notes",
      help: "Optional. Equipment mix, showers, sauna, studios, turf.",
      kind: "textarea",
    },
  ],
  medical: [
    { key: "exam_room_count", label: "Exam / treatment room count", kind: "integer", required: true },
    {
      key: "restricted_compliance_areas",
      label: "Restricted or compliance-governed areas",
      help: "What the cleaner may and may not enter.",
      kind: "textarea",
      required: true,
    },
    {
      key: "biohazard_sharps",
      label: "Biohazard / sharps handling",
      help: "Confirm this is client-managed. NovaraCleaning does not handle biohazard.",
      kind: "textarea",
      required: true,
    },
    {
      key: "medical_notes",
      label: "Medical notes",
      help: "Optional. Waiting area, escort, compliance standards the client expects.",
      kind: "textarea",
    },
  ],
  other: [
    { key: "other_layout_notes", label: "Layout and use of the space", kind: "textarea", required: true },
    { key: "other_special_requirements", label: "Special requirements", help: "Optional.", kind: "textarea" },
  ],
};

function defaultScopeCatalog(): {
  scopeTemplateByType: Record<string, ScopeTemplateKey>;
  scopeByType: Record<string, ScopeChecklistSection[]>;
} {
  const scopeTemplateByType: Record<string, ScopeTemplateKey> = {};
  const scopeByType: Record<string, ScopeChecklistSection[]> = {};
  for (const type of DEFAULT_PROPERTY_TYPES) {
    const template = defaultScopeTemplateForType(type.key, type.accountKind);
    scopeTemplateByType[type.key] = template;
    scopeByType[type.key] = scopeSectionsFromTemplate(template);
  }
  return { scopeTemplateByType, scopeByType };
}

export const DEFAULT_CHECKLISTS: ProposalChecklists = {
  types: DEFAULT_PROPERTY_TYPES,
  intakeByType: INTAKE,
  universal: UNIVERSAL,
  byType: BY_TYPE,
  ...defaultScopeCatalog(),
};

export const DEFAULT_PROPOSAL_SETTINGS: ProposalRequestSettings = {
  pendingEmailSubject: "Your NovaraCleaning proposal request — next steps",
  pendingEmailBody:
    "Hi [Name], thank you for requesting a proposal for [property/address]. Your request is in, " +
    "and we're currently assigning a walkthrough agent to assess the space. Because accurate " +
    "pricing depends on the actual condition, layout, and access of a property, we conduct an " +
    "on-site walkthrough before providing a firm quote — this protects you from surprise " +
    "adjustments later.\n\nWe'll reach out shortly to schedule a convenient time. If you have " +
    "a preferred window, just reply to this email.",
  scheduledEmailSubject: "Your NovaraCleaning walkthrough is scheduled",
  scheduledEmailBody:
    "Hi [Name], a walkthrough agent has been assigned for [property/address]. The visit is " +
    "confirmed for [date] at [time]. [Agent name] will assess the space so we can issue a firm " +
    "quote. Please make sure the site contact can provide access. Reply to this email if the " +
    "time no longer works.",
  adminNotifyEmail: "",
  walkthroughPayType: "flat",
  walkthroughPayCents: 7500,
  walkthroughHourlyCents: 3500,
  tokenTtlHours: 336,
  agentEmailSubject: "Walkthrough assignment — [property/address]",
  agentEmailBody:
    "Hi [Agent name], you've been assigned a paid walkthrough at [property/address] on [date] " +
    "at [time]. Open the site findings form (it auto-saves — this is not the crew job list):\n\n[link]\n\n" +
    "Confirm sqft, floors, restrooms, condition, the service window, exclusions, photos, and " +
    "the few type-specific items. Notes fields are optional. You are paid for this visit " +
    "whether or not the proposal converts.",
};

function cloneItem(item: ChecklistItem): ChecklistItem {
  return {
    ...item,
    options: item.options ? item.options.map((o) => ({ ...o })) : undefined,
  };
}

function cloneList(items: ChecklistItem[] | undefined): ChecklistItem[] {
  return (items || []).map(cloneItem);
}

function indexByKey(items: ChecklistItem[]): Map<string, ChecklistItem> {
  const map = new Map<string, ChecklistItem>();
  for (const item of items) {
    if (item?.key) map.set(item.key, cloneItem(item));
  }
  return map;
}

/**
 * Saved items overlay labels on the shipped list. Required/kind/mapsTo stay
 * on the default so we can narrow the walkthrough without a catalog reset.
 * Retired keys never come back from an older saved copy. Admin-added keys
 * that are not retired still append.
 */
export function mergeItemLists(defaults: ChecklistItem[], saved?: ChecklistItem[] | null): ChecklistItem[] {
  const base = defaults.filter((item) => item.key && !RETIRED_FINDING_KEYS.has(item.key));
  if (!saved || saved.length === 0) return cloneList(base);
  const savedMap = indexByKey(saved);
  const used = new Set<string>();
  const out: ChecklistItem[] = [];
  for (const item of base) {
    used.add(item.key);
    const override = savedMap.get(item.key);
    if (!override) {
      out.push(cloneItem(item));
      continue;
    }
    out.push({
      ...cloneItem(item),
      label: override.label || item.label,
      help: override.help !== undefined ? override.help : item.help,
      options: override.options || item.options,
    });
  }
  for (const item of saved) {
    if (!item.key || used.has(item.key) || RETIRED_FINDING_KEYS.has(item.key)) continue;
    used.add(item.key);
    out.push(cloneItem(item));
  }
  return out;
}

export function mergeChecklists(saved: unknown): ProposalChecklists {
  const raw = (saved && typeof saved === "object" ? saved : {}) as Partial<ProposalChecklists>;
  const savedTypes = Array.isArray(raw.types) ? raw.types : [];
  const typeMap = new Map(savedTypes.filter((t) => t?.key).map((t) => [t.key, t]));
  const types: PropertyTypeDef[] = [];
  const used = new Set<string>();
  for (const def of DEFAULT_PROPERTY_TYPES) {
    const override = typeMap.get(def.key);
    used.add(def.key);
    types.push(override ? { ...def, ...override, key: def.key } : { ...def });
  }
  for (const extra of savedTypes) {
    if (!extra?.key || used.has(extra.key)) continue;
    used.add(extra.key);
    types.push({
      key: extra.key,
      label: extra.label || extra.key,
      shortLabel: extra.shortLabel || extra.label || extra.key,
      accountKind: extra.accountKind || "commercial",
      facilityTypeKey: extra.facilityTypeKey || "other",
      sort: Number(extra.sort) || 90,
      active: extra.active !== false,
    });
  }
  types.sort((a, b) => a.sort - b.sort);

  const intakeByType: Record<string, ChecklistItem[]> = {};
  const byType: Record<string, ChecklistItem[]> = {};
  const scopeTemplateByType: Record<string, ScopeTemplateKey> = {};
  const scopeByType: Record<string, ScopeChecklistSection[]> = {};
  for (const t of types) {
    intakeByType[t.key] = mergeItemLists(
      INTAKE[t.key] || INTAKE.other,
      raw.intakeByType?.[t.key],
    );
    byType[t.key] = mergeItemLists(BY_TYPE[t.key] || [], raw.byType?.[t.key]);
    const template = isScopeTemplate(raw.scopeTemplateByType?.[t.key])
      ? raw.scopeTemplateByType[t.key]
      : defaultScopeTemplateForType(t.key, t.accountKind);
    scopeTemplateByType[t.key] = template;
    scopeByType[t.key] = mergeScopeSections(
      scopeSectionsFromTemplate(template),
      raw.scopeByType?.[t.key],
    );
  }

  return {
    types,
    intakeByType,
    universal: mergeItemLists(UNIVERSAL, raw.universal),
    byType,
    scopeTemplateByType,
    scopeByType,
  };
}

export function mergeProposalSettings(saved: unknown): ProposalRequestSettings {
  const raw = (saved && typeof saved === "object" ? saved : {}) as Partial<ProposalRequestSettings>;
  const payType = raw.walkthroughPayType === "hourly" ? "hourly" : "flat";
  return {
    ...DEFAULT_PROPOSAL_SETTINGS,
    ...raw,
    walkthroughPayType: payType,
    walkthroughPayCents: Number.isFinite(Number(raw.walkthroughPayCents))
      ? Math.max(0, Math.round(Number(raw.walkthroughPayCents)))
      : DEFAULT_PROPOSAL_SETTINGS.walkthroughPayCents,
    walkthroughHourlyCents: Number.isFinite(Number(raw.walkthroughHourlyCents))
      ? Math.max(0, Math.round(Number(raw.walkthroughHourlyCents)))
      : DEFAULT_PROPOSAL_SETTINGS.walkthroughHourlyCents,
    tokenTtlHours: Number.isFinite(Number(raw.tokenTtlHours))
      ? Math.max(24, Math.round(Number(raw.tokenTtlHours)))
      : DEFAULT_PROPOSAL_SETTINGS.tokenTtlHours,
  };
}

export function activePropertyTypes(catalog: ProposalChecklists): PropertyTypeDef[] {
  return catalog.types.filter((t) => t.active !== false);
}

export function propertyTypeByKey(catalog: ProposalChecklists, key: string): PropertyTypeDef | null {
  return catalog.types.find((t) => t.key === key) || null;
}

/**
 * Site findings for the walkthrough token only.
 * Crew scope lists stay on `/cleaner/job-checklist/<token>` after dispatch.
 */
export function walkthroughChecklistFor(
  catalog: ProposalChecklists,
  typeKey: string,
): {
  universal: ChecklistItem[];
  typeSpecific: ChecklistItem[];
  all: ChecklistItem[];
  scope: ScopeChecklistSection[];
  scopeTemplate: ScopeTemplateKey;
} {
  const type = catalog.types.find((t) => t.key === typeKey);
  const typeSpecific = catalog.byType[typeKey] || [];
  const scopeTemplate =
    catalog.scopeTemplateByType?.[typeKey]
    || defaultScopeTemplateForType(typeKey, type?.accountKind);
  return {
    universal: catalog.universal,
    typeSpecific,
    all: [...catalog.universal, ...typeSpecific],
    scope: [],
    scopeTemplate,
  };
}

export function intakeFieldsFor(catalog: ProposalChecklists, typeKey: string): ChecklistItem[] {
  return catalog.intakeByType[typeKey] || [];
}

export function formatFloorShare(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const v = value as Record<string, unknown>;
  const parts = [
    ["carpet", "carpet"],
    ["hard", "hard floor"],
    ["tile", "tile"],
    ["concrete", "sealed concrete"],
  ] as const;
  return parts
    .map(([k, label]) => {
      const n = Number(v[k]);
      return Number.isFinite(n) && n > 0 ? `${n}% ${label}` : null;
    })
    .filter(Boolean)
    .join(", ");
}

export function formatAnswer(item: ChecklistItem, value: unknown): string {
  if (value == null || value === "") return "";
  switch (item.kind) {
    case "yesno":
      return value === true || value === "yes" ? "Yes" : value === false || value === "no" ? "No" : String(value);
    case "select":
      return item.options?.find((o) => o.value === value)?.label || String(value);
    case "multiselect":
      return Array.isArray(value)
        ? value.map((v) => item.options?.find((o) => o.value === v)?.label || String(v)).join(", ")
        : String(value);
    case "floor_share":
      return formatFloorShare(value);
    case "exclusion":
      return WALKTHROUGH_EXCLUSION_CODES[String(value)] || String(value);
    case "media":
      return Array.isArray(value) ? `${value.length} file${value.length === 1 ? "" : "s"}` : "";
    default:
      return String(value);
  }
}

export function isAnswered(item: ChecklistItem, value: unknown): boolean {
  if (value == null || value === "") return false;
  if (item.kind === "yesno") return value === true || value === false || value === "yes" || value === "no";
  if (item.kind === "media") return Array.isArray(value) && value.length > 0;
  if (item.kind === "floor_share") return formatFloorShare(value).length > 0;
  if (item.kind === "exclusion") return String(value).length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return String(value).trim().length > 0;
}

export function missingRequired(items: ChecklistItem[], answers: Record<string, unknown>): string[] {
  return items.filter((i) => i.required && !isAnswered(i, answers[i.key])).map((i) => i.label);
}

export interface ExclusionFinding {
  code: string;
  note: string;
}

/** An on-site exclusion stops pricing. `none` is not a stop. */
export function exclusionFromAnswers(answers: Record<string, unknown>): ExclusionFinding | null {
  const code = String(answers.exclusion_check || "").trim();
  if (!code || code === "none") return null;
  if (!WALKTHROUGH_EXCLUSION_CODES[code] || code === "none") return null;
  const note = String(answers.exclusion_note || "").trim();
  return { code, note };
}

function intVal(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function strVal(v: unknown, max = 2000): string | null {
  const s = String(v ?? "").trim().slice(0, max);
  return s || null;
}

function clockVal(v: unknown): string | null {
  const raw = String(v ?? "").trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(raw) ? raw : null;
}

function yesVal(v: unknown): boolean {
  return v === true || v === "yes";
}

/**
 * Map checklist answers onto the existing commercial_walkthroughs conduct
 * payload. Type-specific answers ride along in findings_extra so they never
 * have to be re-entered for Firm Price Set.
 */
export function mapAnswersToConduct(
  type: PropertyTypeDef,
  items: ChecklistItem[],
  answers: Record<string, unknown>,
): {
  conduct: Record<string, unknown>;
  findingsExtra: Record<string, unknown>;
} {
  const conduct: Record<string, unknown> = {
    facilityTypeKey: type.facilityTypeKey,
  };
  const findingsExtra: Record<string, unknown> = {
    property_type_key: type.key,
  };

  for (const item of items) {
    const value = answers[item.key];
    if (item.key === "photos" && Array.isArray(value)) {
      conduct.photos = value.map((u) => String(u)).filter(Boolean).slice(0, 40);
      continue;
    }
    if (item.mapsTo) {
      switch (item.mapsTo) {
        case "sqft":
        case "restroom_count":
        case "breakroom_count":
        case "floor_count":
        case "recommended_crew_size":
          conduct[
            item.mapsTo === "sqft"
              ? "confirmedSqft"
              : item.mapsTo === "restroom_count"
                ? "restroomCount"
                : item.mapsTo === "breakroom_count"
                  ? "breakroomCount"
                  : item.mapsTo === "floor_count"
                    ? "floorCount"
                    : "recommendedCrewSize"
          ] = intVal(value);
          break;
        case "floor_types":
          conduct.floorTypes = item.kind === "floor_share" ? formatFloorShare(value) : strVal(value, 500);
          break;
        case "condition_level":
          conduct.conditionLevel = strVal(value, 20);
          break;
        case "obstacle_density":
          conduct.obstacleDensity = strVal(value, 20);
          break;
        case "obstacles":
          conduct.obstacles = strVal(value, 2000);
          break;
        case "scope_level":
          conduct.scopeLevel = strVal(value, 20);
          break;
        case "badge_required":
          conduct.badgeRequired = yesVal(value);
          break;
        case "service_window_start":
          conduct.serviceWindowStart = clockVal(value);
          break;
        case "service_window_end":
          conduct.serviceWindowEnd = clockVal(value);
          break;
        case "service_window_notes":
          conduct.serviceWindowNotes = strVal(value, 1000);
          break;
        case "loading_dock_notes":
          conduct.loadingDockNotes = strVal(value, 1000);
          break;
        case "after_hours_access_notes":
          conduct.afterHoursAccessNotes = strVal(value, 1000);
          break;
        default:
          break;
      }
    }
    if (value != null && value !== "") {
      findingsExtra[item.key] = item.kind === "media" ? undefined : value;
      if (findingsExtra[item.key] === undefined) delete findingsExtra[item.key];
    }
  }

  if (conduct.badgeRequired == null) conduct.badgeRequired = answers.access_method === "badge";
  if (conduct.breakroomCount == null) conduct.breakroomCount = intVal(answers.breakroom_count) ?? 0;
  if (conduct.floorCount == null) conduct.floorCount = intVal(answers.floor_count) ?? 1;
  if (conduct.recommendedCrewSize == null) {
    conduct.recommendedCrewSize = intVal(answers.recommended_crew_size) ?? 2;
  }
  if (!conduct.facilityTypeKey) conduct.facilityTypeKey = type.facilityTypeKey;

  const extraBits = [
    strVal(answers.janitor_closet, 500),
    strVal(answers.trash_volume, 500),
    strVal(answers.elevator_stairs, 400),
  ].filter(Boolean);
  if (extraBits.length && !conduct.obstacles) {
    conduct.obstacles = extraBits.join(" · ");
  } else if (extraBits.length) {
    conduct.obstacles = `${conduct.obstacles}\n${extraBits.join(" · ")}`;
  }

  return { conduct, findingsExtra };
}

export interface EmailVars {
  name?: string;
  address?: string;
  date?: string;
  time?: string;
  agentName?: string;
  link?: string;
}

export function interpolateTemplate(template: string, vars: EmailVars): string {
  return template
    .replace(/\[Name\]/gi, vars.name || "there")
    .replace(/\[property\/address\]/gi, vars.address || "your property")
    .replace(/\[date\]/gi, vars.date || "")
    .replace(/\[time\]/gi, vars.time || "")
    .replace(/\[Agent name\]/gi, vars.agentName || "your walkthrough agent")
    .replace(/\[link\]/gi, vars.link || "");
}

export function emailToHtml(body: string): string {
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const withLinks = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#5C0FFE">$1</a>',
  );
  const paragraphs = withLinks
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.55;color:#1e293b">${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
  return `<div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px">${paragraphs}<p style="margin:24px 0 0;color:#64748b">— Novara Cleaning</p></div>`;
}

export function walkthroughLink(token: string): string {
  return `https://contractor.novaracleaning.com/cleaner/walkthrough/${token}`;
}

/** Authenticated office copy of the same tokenized onsite document. */
export function walkthroughStaffPath(token: string): string {
  return `/admin/proposals/doc/${encodeURIComponent(token)}`;
}

export function formatWhen(iso: string): { date: string; time: string; label: string } {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
  return { date, time, label: `${date} at ${time}` };
}

export function slugTypeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

export function computeWalkthroughPayCents(
  settings: ProposalRequestSettings,
  hours?: number | null,
): number {
  if (settings.walkthroughPayType === "hourly") {
    const h = Number(hours);
    const qty = Number.isFinite(h) && h > 0 ? h : 1;
    return Math.round(qty * settings.walkthroughHourlyCents);
  }
  return settings.walkthroughPayCents;
}

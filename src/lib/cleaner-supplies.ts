// ─── Contractor supply checklist (from NovaraCleaning Supply Checklist PDF) ──
//
// Essentials = "Get These Before Your First Job". Optional = premium/add later.
// Not every essential is equally blocking for a standard clean — e.g. an apron
// or duster can wait, but vacuum + chemicals cannot. `neededForJob` marks the
// items a standard residential job actually depends on.
//
// Readiness threshold: a contractor is supply-ready when they own at least
// SUPPLY_READY_PERCENT of the neededForJob essentials (ceil). Optional items
// never count toward readiness.

export type SupplyCategory = "solutions" | "tools" | "safety" | "optional" | "commercial_equipment";

export interface SupplyItem {
  id: string;
  label: string;
  category: SupplyCategory;
  /** True = counted toward the job-readiness %. */
  neededForJob: boolean;
  /**
   * Heavy equipment a commercial site may require. Declaring it is what makes
   * a contractor eligible for sites whose walkthrough recorded that need — it
   * is never counted toward residential readiness, because nobody needs an
   * auto-scrubber to clean a two-bedroom flat.
   */
  commercialEquipment?: boolean;
}

export const SUPPLY_READY_PERCENT = 70;

export const SUPPLY_ITEMS: SupplyItem[] = [
  // Cleaning Solutions — all required for a standard clean
  { id: "all_purpose_cleaner", label: "All-purpose cleaner", category: "solutions", neededForJob: true },
  { id: "glass_mirror_cleaner", label: "Glass & mirror cleaner", category: "solutions", neededForJob: true },
  { id: "disinfectant_spray", label: "Disinfectant spray", category: "solutions", neededForJob: true },
  { id: "bathroom_cleaner", label: "Bathroom cleaner (soap scum remover)", category: "solutions", neededForJob: true },
  { id: "toilet_bowl_cleaner", label: "Toilet bowl cleaner", category: "solutions", neededForJob: true },
  { id: "kitchen_degreaser", label: "Kitchen degreaser", category: "solutions", neededForJob: true },

  // Tools — core kit for floors, baths, kitchen; a few can wait
  { id: "vacuum", label: "Vacuum with attachments", category: "tools", neededForJob: true },
  { id: "mop_bucket", label: "Mop & bucket (or spray mop)", category: "tools", neededForJob: true },
  { id: "microfiber_cloths", label: "Microfiber cloths (10–15)", category: "tools", neededForJob: true },
  { id: "scrub_brush", label: "Scrub brush (tile/grout)", category: "tools", neededForJob: true },
  { id: "toilet_brush", label: "Toilet brush", category: "tools", neededForJob: true },
  { id: "cleaning_toothbrush", label: "Cleaning toothbrush", category: "tools", neededForJob: false },
  { id: "white_scrub_pads", label: "White scrub pads (non-scratch)", category: "tools", neededForJob: true },
  { id: "duster", label: "Duster (microfiber or feather)", category: "tools", neededForJob: false },
  { id: "spray_bottles", label: "Spray bottles", category: "tools", neededForJob: true },
  { id: "cleaning_tote", label: "Cleaning tote or caddy", category: "tools", neededForJob: true },

  // Safety & personal — gloves are non-negotiable; shoes/apron can follow
  { id: "rubber_gloves", label: "Rubber gloves", category: "safety", neededForJob: true },
  { id: "non_slip_shoes", label: "Non-slip shoes", category: "safety", neededForJob: false },
  { id: "cleaning_apron", label: "Cleaning apron with pockets", category: "safety", neededForJob: false },

  // Optional — premium / specialty (never required for readiness)
  { id: "stainless_steel_cleaner", label: "Stainless steel cleaner & polish", category: "optional", neededForJob: false },
  { id: "wood_furniture_polish", label: "Wood furniture polish", category: "optional", neededForJob: false },
  { id: "stone_cleaner", label: "Stone cleaner (pH neutral)", category: "optional", neededForJob: false },
  { id: "oven_cleaner", label: "Oven cleaner (for add-on service)", category: "optional", neededForJob: false },
  { id: "squeegee", label: "Squeegee", category: "optional", neededForJob: false },
  { id: "whisk_broom", label: "Whisk broom", category: "optional", neededForJob: false },
  { id: "step_stool", label: "Step stool (2-step max)", category: "optional", neededForJob: false },
  { id: "mask_respirator", label: "Mask/respirator (ovens, showers)", category: "optional", neededForJob: false },
  { id: "toilet_toothbrush", label: "Separate toilet toothbrush (different color)", category: "optional", neededForJob: false },
  { id: "leather_cleaner", label: "Leather cleaner (rare)", category: "optional", neededForJob: false },

  // Commercial equipment — self-certified, never required for residential
  // readiness. A commercial walkthrough records what a building demands
  // (required_equipment on the site); these are the answers to that question.
  { id: "auto_scrubber", label: "Ride-on or walk-behind auto-scrubber", category: "commercial_equipment", neededForJob: false, commercialEquipment: true },
  { id: "floor_buffer", label: "Floor buffer / burnisher", category: "commercial_equipment", neededForJob: false, commercialEquipment: true },
  { id: "carpet_extractor", label: "Carpet extractor", category: "commercial_equipment", neededForJob: false, commercialEquipment: true },
  { id: "wet_vac", label: "Wet/dry shop vac", category: "commercial_equipment", neededForJob: false, commercialEquipment: true },
  { id: "backpack_vacuum", label: "Backpack vacuum", category: "commercial_equipment", neededForJob: false, commercialEquipment: true },
  { id: "high_duster", label: "High-reach duster / extension pole", category: "commercial_equipment", neededForJob: false, commercialEquipment: true },
  { id: "pressure_washer", label: "Pressure washer", category: "commercial_equipment", neededForJob: false, commercialEquipment: true },
  { id: "floor_scrubber_pads", label: "Floor pads & scrubbing chemicals", category: "commercial_equipment", neededForJob: false, commercialEquipment: true },
];

/** The equipment catalog a commercial walkthrough picks from. */
export function commercialEquipmentItems(): SupplyItem[] {
  return SUPPLY_ITEMS.filter((i) => i.commercialEquipment === true);
}

export function commercialEquipmentLabel(id: string): string {
  return SUPPLY_ITEMS.find((i) => i.id === id)?.label || id.replace(/_/g, " ");
}

/**
 * Which of a site's required equipment this contractor has certified they own.
 *
 * Advisory, not a hard filter: a site can be worked by a crew where one member
 * brings the scrubber, and refusing every cleaner who has not ticked a box
 * would break dispatch for the many sites that need nothing special. Dispatch
 * shows the gap and lets a human decide.
 */
export function equipmentMatch(
  inventory: SupplyInventory | null | undefined,
  requiredEquipment: string[] | null | undefined,
): { required: string[]; owned: string[]; missing: string[]; ok: boolean } {
  const required = (requiredEquipment || []).map(String).filter(Boolean);
  const inv = inventory || {};
  const owned = required.filter((id) => inv[id] === true);
  const missing = required.filter((id) => inv[id] !== true);
  return { required, owned, missing, ok: missing.length === 0 };
}

export const SUPPLY_CATEGORY_LABEL: Record<SupplyCategory, string> = {
  solutions: "Cleaning Solutions",
  tools: "Tools",
  safety: "Safety & Personal",
  optional: "Optional — Add Later",
  commercial_equipment: "Commercial Equipment — Self-Certified",
};

export const SUPPLY_CHECKLIST_PDF = "/NovaraCleaning_Supply_Checklist_dd14.pdf";

export type SupplyInventory = Record<string, boolean>;

export function neededSupplyItems(): SupplyItem[] {
  return SUPPLY_ITEMS.filter((i) => i.neededForJob);
}

export function supplyReadyThresholdCount(): number {
  const needed = neededSupplyItems().length;
  return Math.ceil((needed * SUPPLY_READY_PERCENT) / 100);
}

export function scoreSupplyInventory(inventory: SupplyInventory | null | undefined): {
  ownedNeeded: number;
  totalNeeded: number;
  percent: number;
  ready: boolean;
  threshold: number;
} {
  const needed = neededSupplyItems();
  const ownedNeeded = needed.filter((i) => inventory?.[i.id] === true).length;
  const totalNeeded = needed.length;
  const threshold = supplyReadyThresholdCount();
  const percent = totalNeeded === 0 ? 0 : Math.round((ownedNeeded / totalNeeded) * 100);
  return {
    ownedNeeded,
    totalNeeded,
    percent,
    ready: ownedNeeded >= threshold,
    threshold,
  };
}

/** Keep only ids that exist in the catalog, so a stale form can't write junk. */
export function sanitizeSupplyInventory(
  submitted: Record<string, unknown> | null | undefined,
): SupplyInventory {
  const allowed = new Set(SUPPLY_ITEMS.map((i) => i.id));
  const inventory: SupplyInventory = {};
  for (const [id, val] of Object.entries(submitted || {})) {
    if (allowed.has(id)) inventory[id] = val === true;
  }
  return inventory;
}

/**
 * The exact columns a supply submission writes. Shared so the tokenized page
 * and the onboarding portal leave a contractor's row in the same state — the
 * portal step reads supply_checklist_submitted_at back as "done", and it can
 * only do that if both writers set it.
 */
export function supplySubmissionPatch(
  inventory: SupplyInventory,
  now: string = new Date().toISOString(),
) {
  return {
    supply_inventory: inventory,
    supply_checklist_submitted_at: now,
    ob_supplies_checklist_viewed: true,
    ob_supplies_checklist_viewed_at: now,
    updated_at: now,
  };
}

/** Timeline entry for a submission, so admin sees it whichever route was used. */
export function supplySubmissionEvent(args: {
  cleanerId: string;
  firstName?: string | null;
  inventory: SupplyInventory;
  source: string;
}) {
  const score = scoreSupplyInventory(args.inventory);
  return {
    event_type: "cleaner.supply_checklist_submitted",
    cleaner_id: args.cleanerId,
    source: args.source,
    summary:
      `${args.firstName || "Cleaner"} submitted supply checklist — ` +
      `${score.ownedNeeded}/${score.totalNeeded} job-needed (${score.percent}%, ready=${score.ready})`,
    data: {
      owned_needed: score.ownedNeeded,
      total_needed: score.totalNeeded,
      percent: score.percent,
      ready: score.ready,
      threshold: score.threshold,
      inventory: args.inventory,
    },
  };
}

// ─── Account setup sequence ──────────────────────────────────────────────
//
// One ordered definition of onboarding, shared by the portal a contractor
// works through, the page a mailed setup link lands on, and the admin action
// that sends that link. Before this existed each of those three decided the
// order for itself, so they could disagree about what was left to do.

export interface CleanerSetupState {
  phone_verified?: boolean | null;
  supply_checklist_submitted_at?: string | null;
  ob_supplies_checklist_viewed?: boolean | null;
  payouts_enabled?: boolean | null;
  ob_payouts_setup?: boolean | null;
  stripe_account_id?: string | null;
}

export type CleanerSetupStepId = "phone" | "supplies" | "payouts";

export interface CleanerSetupStep {
  id: CleanerSetupStepId;
  /** Sentence-case label, reused in the portal and on the mailed link page. */
  title: string;
  done: boolean;
}

/**
 * The supply checkoff counts as done once it has been submitted — not once a
 * contractor owns SUPPLY_READY_PERCENT of the kit. Onboarding asks what they
 * already have; it never waits on them buying a vacuum. Readiness stays
 * visible to dispatch either way.
 *
 * ob_supplies_checklist_viewed is the legacy flag the old checklist page set
 * alongside the timestamp, honoured here so contractors who did this before
 * the timestamp existed are not asked twice.
 */
export function isSupplyChecklistSubmitted(c: CleanerSetupState): boolean {
  return (
    Boolean(c.supply_checklist_submitted_at) ||
    Boolean(c.ob_supplies_checklist_viewed)
  );
}

/** Stripe Connect reached, whether or not payouts have finished enabling. */
export function isPayoutSetupStarted(c: CleanerSetupState): boolean {
  return (
    Boolean(c.payouts_enabled) ||
    Boolean(c.ob_payouts_setup) ||
    Boolean(c.stripe_account_id)
  );
}

/**
 * Onboarding in the order everything presents it.
 *
 * Payouts sit last deliberately: bank details and tax identity are the most
 * friction in the flow and the step a contractor is most likely to abandon,
 * so it is asked only once the cheap steps are behind them.
 */
export function cleanerSetupSteps(c: CleanerSetupState): CleanerSetupStep[] {
  return [
    {
      id: "phone",
      title: "Verify your phone number",
      done: Boolean(c.phone_verified),
    },
    {
      id: "supplies",
      title: "Check off your supplies",
      done: isSupplyChecklistSubmitted(c),
    },
    {
      id: "payouts",
      title: "Set up payouts (Stripe)",
      done: isPayoutSetupStarted(c),
    },
  ];
}

export function isCleanerSetupComplete(c: CleanerSetupState): boolean {
  return cleanerSetupSteps(c).every((s) => s.done);
}

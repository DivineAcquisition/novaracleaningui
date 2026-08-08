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

export type SupplyCategory = "solutions" | "tools" | "safety" | "optional";

export interface SupplyItem {
  id: string;
  label: string;
  category: SupplyCategory;
  /** True = counted toward the job-readiness %. */
  neededForJob: boolean;
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
];

export const SUPPLY_CATEGORY_LABEL: Record<SupplyCategory, string> = {
  solutions: "Cleaning Solutions",
  tools: "Tools",
  safety: "Safety & Personal",
  optional: "Optional — Add Later",
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

/** Account setup complete = phone verified + Stripe Connect started/ready. */
export function isCleanerSetupComplete(c: {
  phone_verified?: boolean | null;
  payouts_enabled?: boolean | null;
  ob_payouts_setup?: boolean | null;
  stripe_account_id?: string | null;
}): boolean {
  const stripe =
    Boolean(c.payouts_enabled) ||
    Boolean(c.ob_payouts_setup) ||
    Boolean(c.stripe_account_id);
  return Boolean(c.phone_verified) && stripe;
}

// ─── Customer-facing value stack ─────────────────────────────────────────
//
// Deliverables framed as included product value (not hidden ops process).
// Headlines are used as checkmarks on checkout / offer / sign pages.

export type ValueStackItem = {
  /** Short checkmark line shown next to value stacks. */
  headline: string;
  /** One-line customer framing. */
  tagline: string;
};

/** Headlines only — append to service checkmark lists. */
export const VALUE_STACK_HEADLINES = [
  "Before & After Photo Report",
  "$15 Off Your Next Clean",
  "Customer Portal Access",
  "Cleaners we send are background-checked",
] as const;

export const VALUE_STACK_ITEMS: ValueStackItem[] = [
  {
    headline: "Before & After Photo Report",
    tagline: "Photo proof of every clean, sent to you",
  },
  {
    headline: "$15 Off Your Next Clean",
    tagline: "Loyalty credit after your first clean (once)",
  },
  {
    headline: "Customer Portal Access",
    tagline: "Your own dashboard",
  },
  {
    headline: "Cleaners we send are background-checked",
    tagline: "The people who come to the home are background-checked",
  },
];

/** Existing premium / trust lines that already appear on checkout. */
export const CHECKOUT_PREMIUM_FEATURES = [
  "Insured 2-person team",
  "Eco-friendly products & HEPA vacuums",
  "All supplies and equipment included",
  "48-hour re-clean guarantee",
  ...VALUE_STACK_HEADLINES,
] as const;

export const CHECKLIST_INDEX_PATH = "/checklist";

export { checklistPathForServiceType } from "@/lib/checklists";

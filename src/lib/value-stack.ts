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
  "Before and after photo report",
  "Customer portal access",
  "Insured",
] as const;

export const VALUE_STACK_ITEMS: ValueStackItem[] = [
  {
    headline: "Before and after photo report",
    tagline: "Photo proof of every clean, sent to you",
  },
  {
    headline: "Customer portal access",
    tagline: "Your own dashboard",
  },
  {
    headline: "Insured",
    tagline: "General liability insurance",
  },
];

/** Existing premium / trust lines that already appear on checkout. */
export const CHECKOUT_PREMIUM_FEATURES = [
  "Insured 2-person team",
  "Supplies and equipment included",
  "All supplies and equipment included",
  "48-hour re-clean guarantee",
  ...VALUE_STACK_HEADLINES,
] as const;

export const CHECKLIST_INDEX_PATH = "/checklist";

export { checklistPathForServiceType } from "@/lib/checklists";

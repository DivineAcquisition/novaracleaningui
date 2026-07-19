// ─── Customer-facing value stack ─────────────────────────────────────────
//
// Deliverables framed as included product value (not hidden ops process).
// Headlines are used as checkmarks on checkout / offer / sign pages.
// Full items power the /value-stack page ("value stacker").

export type ValueStackItem = {
  /** Short checkmark line shown next to value stacks. */
  headline: string;
  /** One-line customer framing. */
  tagline: string;
  /** Longer copy for the value-stacker page. */
  description: string;
};

/** Headlines only — append to service checkmark lists. */
export const VALUE_STACK_HEADLINES = [
  "Before & After Photo Report",
  "$15 Off Your Next Clean",
  "Customer Portal Access",
  "Vetted, Background-Checked Cleaners",
] as const;

export const VALUE_STACK_ITEMS: ValueStackItem[] = [
  {
    headline: "Before & After Photo Report",
    tagline: "Photo proof of every clean, sent to you",
    description:
      "Every job is documented. You receive a before/after photo report so you can see the work — not a hidden ops process, an included deliverable.",
  },
  {
    headline: "$15 Off Your Next Clean",
    tagline: "Loyalty credit after your first clean (once)",
    description:
      "After your first clean, you get a $15 loyalty credit toward your next booking. It comes out of company margin — not cleaner pay.",
  },
  {
    headline: "Customer Portal Access",
    tagline: "Your own dashboard",
    description:
      "Your own login to view booking history, upcoming visits, photo reports, invoices/receipts, and rebooking — all in one place.",
  },
  {
    headline: "Vetted, Background-Checked Cleaners",
    tagline: "Trusted pros, not strangers",
    description:
      "Cleaners are screened, background-checked, and rated through the Novara Score system so you get trusted pros — not strangers.",
  },
];

/** Existing premium / trust lines that already appear on checkout. */
export const CHECKOUT_PREMIUM_FEATURES = [
  "Insured & bonded 2-person team",
  "Eco-friendly products & HEPA vacuums",
  "All supplies and equipment included",
  "48-hour re-clean guarantee",
  ...VALUE_STACK_HEADLINES,
] as const;

export const VALUE_STACK_PATH = "/value-stack";
export const CHECKLIST_INDEX_PATH = "/checklist";

/** Map booking service type → public checklist slug. */
export function checklistPathForServiceType(serviceType?: string | null): string {
  const t = String(serviceType || "").toLowerCase();
  if (t === "deep" || t === "combo") return "/checklist/deep-clean";
  if (t === "moveinout" || t === "move-in-out" || t === "move_in_out") {
    return "/checklist/move-in-out";
  }
  if (t === "membership" || t === "weekly" || t === "biweekly" || t === "monthly" || t === "recurring") {
    return "/checklist/recurring";
  }
  return "/checklist/standard-clean";
}

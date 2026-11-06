/**
 * Membership plan copy for /membership and /membership/[planId].
 * Benefits and terms match the existing plan definitions and membership terms;
 * prices come from MEMBERSHIP_PRICES, the table checkout charges.
 */

import { MEMBERSHIP_PRICES } from "@/lib/pricing";

export type PlanId = "monthly" | "biweekly" | "weekly";

export const PLAN_ORDER: PlanId[] = ["monthly", "biweekly", "weekly"];

export const PLANS: Record<
  PlanId,
  {
    name: string;
    cadence: string;
    tagline: string;
    credits: number;
    hours: string;
    discount: string;
    popular?: boolean;
    benefits: string[];
  }
> = {
  monthly: {
    name: "Glow Monthly",
    cadence: "Once a month",
    tagline: "One clean a month. Enough to keep a tidy home from slipping.",
    credits: 1,
    hours: "priced by home size",
    discount: "",
    benefits: ["1 clean a month", "24-hour re-clean guarantee", "Priority customer support"],
  },
  biweekly: {
    name: "Glow Bi-Weekly",
    cadence: "Every two weeks",
    tagline: "Two cleans a month with the same cleaner. The plan most homes pick.",
    credits: 2,
    hours: "priced by home size",
    discount: "",
    popular: true,
    benefits: ["2 cleans a month", "Dedicated cleaner match", "Reschedule with 48 hours’ notice"],
  },
  weekly: {
    name: "Glow Weekly",
    cadence: "Every week",
    tagline: "Four cleans a month, your cleaner, and your preferred time slot.",
    credits: 4,
    hours: "priced by home size",
    discount: "",
    benefits: [
      "4 cleans a month",
      "Dedicated cleaner and preferred time slot",
      "Free deep clean every 6 months",
    ],
  },
};

export const MEMBERSHIP_COPY = {
  eyebrow: "Membership",
  headline: "Keep it clean without booking every time.",
  lead: "Pick how often. Your plan bills monthly, and every visit follows the Recurring checklist. The first month starts with a deep clean so every visit after it is upkeep.",
  firstMonthFee: 75,
  howHeadline: "How a membership starts.",
  howLead: "The same steps as a one-time booking, then your visits repeat.",
  steps: [
    { title: "Pick a plan", body: "Choose monthly, every two weeks, or weekly, and your home size." },
    { title: "Book the first clean", body: "Your ZIP, your details, and a date for the first visit." },
    { title: "Pay the first month", body: "Billed on this site, including the first-month deep clean." },
    { title: "Sign the agreement", body: "Add your address and sign the membership agreement." },
    { title: "Visits repeat", body: "Your cleaner comes back on your schedule. Reschedule or pause from your account." },
  ],
  compareHeadline: "Compare plans.",
  terms: [
    "Billing repeats monthly on the payment method you use at checkout.",
    "Cancel with 14 days' written notice before the next billing date, by email or from your account.",
    "Reschedule with 48 hours' notice before a visit.",
    "Every new membership includes a $75 deep clean in the first month.",
    "Report anything missed within 24 hours of a member visit for a free re-clean.",
  ],
  termsLink: { href: "https://novaracleaning.com/terms", label: "Read the full terms" },
  oneTime: { text: "Not ready for a plan?", link: "Book a one-time clean", href: "/#get-price" },
} as const;

export function planPrice(plan: PlanId, homeSize: string): number {
  return MEMBERSHIP_PRICES[homeSize]?.[plan] ?? 0;
}

export function planFrom(plan: PlanId): number {
  const values = Object.values(MEMBERSHIP_PRICES)
    .map((row) => row[plan])
    .filter((v) => v > 0);
  return values.length ? Math.min(...values) : 0;
}

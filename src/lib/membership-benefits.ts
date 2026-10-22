// ─── Glow Membership benefits (customer-facing) ──────────────────────────
//
// Single source of truth for the public /membership-benefits page and the
// admin Quotes send flow. Copy is grounded in what members actually get:
// the customer portal (Control Center), the Before & After photo report,
// preferred-cleaner control, member pricing, priority scheduling, and the
// re-clean guarantee. Plan facts mirror MEMBERSHIP_PLANS in lib/pricing.ts.

export interface BenefitSection {
  title: string;
  tagline: string;
  icon: "portal" | "camera" | "cleaner" | "price" | "calendar" | "shield" | "credit" | "flex";
  items: string[];
}

export const MEMBERSHIP_BENEFITS_PATH = "/membership-benefits";
export const MEMBERSHIP_BENEFITS_URL =
  "https://try.novaracleaning.com/membership-benefits";

/** The headline trio — the benefits we lead with everywhere. */
export const HERO_BENEFITS: BenefitSection[] = [
  {
    title: "Customer Portal Access",
    tagline: "Your own Control Center for everything cleaning.",
    icon: "portal",
    items: [
      "See every upcoming and past visit in one dashboard",
      "Reschedule, modify, or cancel visits yourself — no phone tag",
      "Book with your membership credits in a couple of taps",
      "Manage billing securely (update cards, view invoices)",
      "Rate each visit and message the team from one place",
    ],
  },
  {
    title: "Before & After Photo Report",
    tagline: "Photo proof of every single clean, sent to you.",
    icon: "camera",
    items: [
      "Cleaners document the home before they start and after they finish",
      "A private photo gallery link lands in your inbox / texts after each visit",
      "Every visit is verifiable — you always know exactly what was done",
      "Perfect for rentals, offices, and anyone managing a home remotely",
    ],
  },
  {
    title: "Your Cleaner, Every Time",
    tagline: "Same-team continuity — never start over with a stranger.",
    icon: "cleaner",
    items: [
      "Choose your preferred cleaner and keep them visit after visit",
      "The portal remembers who has cleaned for you and routes them back to you",
      "Same trusted team learns your home, your products, and your standards",
      "If your regular is ever out, we brief the backup on your preferences first",
      "Every cleaner is vetted, background-checked, and insured",
    ],
  },
];

/** The rest of the value stack. */
export const MORE_BENEFITS: BenefitSection[] = [
  {
    title: "Member Pricing & Add-On Discount",
    tagline: "Our best per-clean rates — plus a members-only discount on extras.",
    icon: "price",
    items: [
      "Members pay our lowest per-clean rates — always below one-time pricing",
      "Members-only discount on every add-on — inside the fridge, inside the oven, interior windows, laundry, and more",
      "One flat rate based on your home size — no surprise totals",
    ],
  },
  {
    title: "Priority Scheduling & Preferred Slot",
    tagline: "Members book first — and hold their favorite time.",
    icon: "calendar",
    items: [
      "Priority access to the best arrival windows",
      "Reserve a preferred standing day and arrival window on Bi-Weekly and Weekly plans",
      "Most member requests are scheduled within 48 hours",
    ],
  },
  {
    title: "Satisfaction Guarantee",
    tagline: "If it's not right, we make it right.",
    icon: "shield",
    items: [
      "48-hour re-clean guarantee on every visit",
      "Insured and bonded professional teams",
      "Eco-friendly products and HEPA vacuums, supplies included",
    ],
  },
  {
    title: "Cleaning Credits & Deep-Clean Reset",
    tagline: "Your plan, ready when you are — with a periodic reset built in.",
    icon: "credit",
    items: [
      "Monthly cleaning credits included with every plan (1, 2, or 4 per month)",
      "Redeem credits straight from the portal — pick a date, done",
      "A periodic deep-clean credit to reset the whole home every few months",
    ],
  },
  {
    title: "Total Flexibility",
    tagline: "A membership that works around you.",
    icon: "flex",
    items: [
      "Free rescheduling — life happens, your plan flexes",
      "Pause or cancel anytime from the portal",
      "Switch plans as your needs change",
    ],
  },
];

export interface PlanSummary {
  id: "monthly" | "biweekly" | "weekly";
  label: string;
  cleansPerMonth: number;
  blurb: string;
  highlight?: boolean;
}

/** Mirrors MEMBERSHIP_PLANS in lib/pricing.ts — display only. */
export const PLAN_SUMMARIES: PlanSummary[] = [
  {
    id: "monthly",
    label: "Glow Monthly",
    cleansPerMonth: 1,
    blurb: "1 clean per month — keep the baseline fresh.",
  },
  {
    id: "biweekly",
    label: "Glow Bi-Weekly",
    cleansPerMonth: 2,
    blurb: "2 cleans per month — our most popular rhythm.",
    highlight: true,
  },
  {
    id: "weekly",
    label: "Glow Weekly",
    cleansPerMonth: 4,
    blurb: "Weekly visits — a home that's always guest-ready.",
  },
];

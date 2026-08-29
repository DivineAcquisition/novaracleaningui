// ─── Screenshot definitions ────────────────────────────────────────────────
//
// One entry per image in the guides. `doc` ties the shot to the guide that
// embeds it, so `npm run docs:verify` can prove every guide's images exist
// and every captured image is actually used.
//
// Callout labels are the words the guide's numbered steps use, so the reader
// can match badge 2 in the image to step 2 in the text without translating.

import type { Page } from "playwright";

export interface Shot {
  id: string;
  /** Guide slug this image belongs to (docs/admin-workspace/<doc>.md). */
  doc: string;
  /** Caption rendered under the image. */
  caption: string;
  url: string;
  /** Text that must appear before the shot is taken. */
  waitForText?: string;
  /** Extra interaction (open a tab, expand a sheet) before capturing. */
  setup?: (page: Page) => Promise<void>;
  callouts: Array<{
    text?: string;
    selector?: string;
    nth?: number;
    pad?: number;
    exact?: boolean;
    within?: string;
    label: string;
  }>;
  fullPage?: boolean;
  /**
   * Crop to one element instead of the whole page. Use for dense screens
   * where a full-page shot would be unreadable at documentation width — the
   * reader wants the quote rail, not the whole booking form around it.
   */
  clipSelector?: string;
  /** Viewport height override for tall screens. */
  height?: number;
}

const clickTab = (name: string) => async (page: Page) => {
  const tab = page.getByRole("tab", { name: new RegExp(name, "i") }).first();
  if (await tab.count()) {
    await tab.click().catch(() => {});
    await page.waitForTimeout(1200);
  }
};

export const SHOTS: Shot[] = [
  // ── Dashboard ────────────────────────────────────────────────────────────
  {
    id: "dashboard-overview",
    doc: "dashboard",
    caption: "The dashboard as it looks when you sign in.",
    url: "/admin/dashboard",
    waitForText: "Today at a glance",
    callouts: [
      { text: "Bookings today", label: "Bookings today" },
      { text: "Revenue today", label: "Revenue today" },
      { text: "Active cleaners", label: "Active cleaners" },
      { text: "Pending offers", label: "Pending offers" },
      { text: "Live activity", label: "Live activity feed" },
    ],
  },
  {
    id: "dashboard-sidebar",
    doc: "dashboard",
    caption: "The workspace sidebar. Which entries you see depends on your role.",
    url: "/admin/dashboard",
    waitForText: "Workspace",
    callouts: [
      { text: "Workspace", label: "Section list" },
      { text: "Bookings", nth: 0, label: "Bookings" },
      { text: "Operations", nth: 0, label: "Operations" },
      { text: "Signed in", label: "Who you are signed in as" },
      { text: "Sign out", label: "Sign out" },
    ],
  },

  // ── Bookings ─────────────────────────────────────────────────────────────
  {
    id: "bookings-list",
    doc: "bookings",
    caption: "The bookings list with the search and filter row.",
    url: "/admin/bookings",
    waitForText: "Bookings",
    callouts: [
      { selector: "input[placeholder*='Search name']", label: "Search box" },
      { text: "All statuses", label: "Status filter" },
      { text: "All bookings", label: "Date-range filter" },
      { text: "Refresh", label: "Refresh" },
    ],
    fullPage: true,
  },
  {
    id: "bookings-row",
    doc: "bookings",
    caption: "A single booking row. Clicking anywhere on it opens the booking.",
    url: "/admin/bookings",
    waitForText: "Jordan Reyes",
    callouts: [
      { text: "Jordan Reyes", label: "Customer and booking number" },
      { text: "Columbia", nth: 0, label: "Where the job is" },
      { text: "confirmed", nth: 0, label: "Status badge" },
    ],
  },

  // ── Internal booking / pricing ───────────────────────────────────────────
  {
    id: "internal-booking-customer",
    doc: "internal-booking",
    caption: "Step 1 — who the booking is for.",
    url: "/admin/csr",
    waitForText: "Novara Internal Booking",
    callouts: [
      { text: "One-time clean", label: "Booking type" },
      { text: "First name", label: "Customer name" },
      { text: "Email", nth: 0, label: "Email" },
      { text: "Service address", label: "Service address" },
      { text: "ZIP", nth: 0, label: "ZIP — this sets the pricing zone" },
    ],
    fullPage: true,
  },
  {
    id: "internal-booking-service",
    doc: "internal-booking",
    caption: "Step 2 — home size, service type and condition drive the price.",
    url: "/admin/csr",
    waitForText: "Home size",
    callouts: [
      { text: "Home size", nth: 0, label: "Home size band" },
      { text: "Standard Clean", label: "Service type" },
      { text: "Add-ons", nth: 0, label: "Add-ons" },
      { text: "Light", nth: 0, label: "Home condition" },
    ],
    fullPage: true,
  },
  {
    // The worked example in the Pricing guide: a 1,501–2,000 sq ft home in
    // Zone B (ZIP 21044), Standard Clean, standard condition. Typing the ZIP
    // is what switches the rail from the fallback catalogue price to the real
    // zone-priced quote, so the setup fills it and waits for the rail to
    // settle before the shot is taken.
    id: "internal-booking-quote-rail",
    doc: "pricing",
    caption:
      "The Live quote rail showing the worked example from this guide — a 1,501–2,000 sq ft Standard Clean in Zone B at standard condition.",
    url: "/admin/csr",
    waitForText: "Live quote",
    setup: async (page) => {
      const zip = page.locator('input[placeholder="22201"]').first();
      await zip.fill("21044");
      await zip.blur().catch(() => {});
      // The quote request is debounced 350 ms, then the rail re-renders.
      await page.waitForTimeout(2500);
    },
    clipSelector: 'aside[class*="col-span-4"] > div > div',
    // Tall viewport so the rail is fully on screen without Playwright
    // scrolling it under the sticky header.
    height: 1200,
    callouts: [
      {
        text: "1,501 – 2,000 sq ft",
        within: 'aside[class*="col-span-4"]',
        pad: 5,
        label: "Base rate for this home size",
      },
      { text: "Condition: standard", nth: 0, pad: 5, label: "Condition step" },
      { text: "Demand adjustment", nth: 0, pad: 5, label: "Demand — not charging today" },
      {
        text: "Total",
        exact: true,
        within: 'aside[class*="col-span-4"]',
        pad: 5,
        label: "What the customer pays",
      },
      {
        text: "Deposit",
        exact: true,
        within: 'aside[class*="col-span-4"]',
        pad: 5,
        label: "Deposit due now",
      },
    ],
  },

  // ── Pricing admin ────────────────────────────────────────────────────────
  {
    id: "pricing-zones",
    doc: "pricing",
    caption: "The Zones tab — where each service area's multiplier is set.",
    url: "/admin/pricing",
    waitForText: "Dynamic Pricing",
    callouts: [
      { text: "Zones", nth: 0, label: "Zones tab" },
      { text: "Zone A — Premium", nth: 0, label: "A zone and its multiplier" },
      { text: "Zip mapping", label: "ZIP-to-zone lookup" },
    ],
    fullPage: true,
  },
  {
    id: "pricing-guardrails",
    doc: "pricing",
    caption: "The Guardrails tab — condition multipliers, the floor and the override band.",
    url: "/admin/pricing",
    waitForText: "Dynamic Pricing",
    setup: clickTab("Guardrails"),
    callouts: [
      { text: "Condition multipliers", label: "Condition multipliers" },
      { text: "Min cleaner hourly", label: "Minimum cleaner hourly — sets the floor" },
      { text: "VA override band", label: "How far a VA may adjust" },
      { text: "Quote lock", label: "How long a saved quote holds" },
    ],
    fullPage: true,
  },
  {
    id: "pricing-demand",
    doc: "pricing",
    caption: "The Demand tab — reactive pricing and whether it is actually charging.",
    url: "/admin/pricing",
    waitForText: "Dynamic Pricing",
    setup: clickTab("Demand"),
    callouts: [
      { text: "Reactive pricing live", label: "Master switch" },
      { text: "Shadow mode", label: "Shadow mode" },
      { text: "Min multiplier", label: "How far it may move" },
    ],
    fullPage: true,
  },

  // ── Cleaners ─────────────────────────────────────────────────────────────
  {
    id: "cleaners-directory",
    doc: "cleaners",
    caption: "The contractor directory with its status filters.",
    url: "/admin/cleaners",
    waitForText: "Cleaner directory",
    callouts: [
      { text: "Contractors", nth: 0, label: "Section switch" },
      { selector: "input[placeholder*='Search by name']", label: "Search" },
      { text: "Active", nth: 0, label: "Status filters" },
      { text: "+ Add cleaner", label: "Add a contractor" },
    ],
    fullPage: true,
  },
  {
    id: "cleaners-row",
    doc: "cleaners",
    caption: "A contractor row — tier, status, onboarding progress and score at a glance.",
    url: "/admin/cleaners",
    waitForText: "Dana Whitfield",
    callouts: [
      { text: "Dana Whitfield", label: "Name, tier and revenue share" },
      { text: "Onboarding", nth: 0, label: "Onboarding progress" },
      { text: "Performance", nth: 0, label: "Scores" },
    ],
  },

  // ── Operations ───────────────────────────────────────────────────────────
  {
    id: "operations-tabs",
    doc: "operations",
    caption: "Operations pulls four screens into one: at-risk work, dispatch, map and sync.",
    url: "/admin/operations",
    waitForText: "Needs attention",
    callouts: [
      { text: "Needs attention", nth: 0, label: "Needs attention" },
      { text: "Dispatch", nth: 0, label: "Dispatch" },
      { text: "Map", nth: 0, label: "Map" },
      { text: "Sync health", nth: 0, label: "Sync health" },
    ],
    fullPage: true,
  },

  // ── Customers ────────────────────────────────────────────────────────────
  {
    id: "customers-list",
    doc: "customers",
    caption: "The customer list. The search box also matches referral codes.",
    url: "/admin/customers",
    waitForText: "Customers",
    callouts: [
      { selector: "input[placeholder*='Search name']", label: "Search — includes referral codes" },
      { text: "New customer", label: "Create an account" },
      { text: "Jordan Reyes", nth: 0, label: "Click a row to open the account" },
    ],
    fullPage: true,
  },

  // ── Recurring ────────────────────────────────────────────────────────────
  {
    id: "recurring-hub",
    doc: "recurring",
    caption: "The memberships and recurring hub, with the portfolio numbers across the top.",
    url: "/admin/recurring",
    waitForText: "Memberships & recurring",
    callouts: [
      { text: "Active MRR", label: "Monthly recurring revenue" },
      { text: "At risk", nth: 0, label: "Plans needing attention" },
      { text: "New recurring plan", label: "Start a new plan" },
    ],
    fullPage: true,
  },

  // ── Quality control ──────────────────────────────────────────────────────
  {
    id: "qc-overview",
    doc: "quality-control",
    caption: "Quality Control — open issues, documentation compliance and the issue list.",
    url: "/admin/qc",
    waitForText: "Quality Control",
    callouts: [
      { text: "Open issues", label: "Open issues" },
      { text: "Documentation compliance", label: "Documentation compliance" },
      { text: "Report issue", label: "Log a new issue" },
    ],
    fullPage: true,
  },

  // ── Proposals ────────────────────────────────────────────────────────────
  {
    id: "proposals-hub",
    doc: "proposals",
    caption: "The proposals hub. Work moves left to right across these tabs.",
    url: "/admin/proposals",
    waitForText: "Proposals",
    callouts: [
      { text: "New request", label: "Take a new request" },
      { text: "Queue", nth: 0, label: "Requests waiting on a walkthrough" },
      { text: "Firm price", label: "Set the firm price" },
      { text: "Send", nth: 0, label: "Send the proposal" },
    ],
    fullPage: true,
  },

  // ── Quotes ───────────────────────────────────────────────────────────────
  {
    id: "quotes-list",
    doc: "quotes",
    caption: "Saved quotes and website quote requests.",
    url: "/admin/quotes",
    waitForText: "Quotes",
    callouts: [
      { text: "Saved quotes", label: "Quotes saved from internal booking" },
      { text: "Website requests", label: "Requests from the website" },
      { text: "New quote / book", label: "Start a new quote" },
    ],
    fullPage: true,
  },

  // ── Payroll ──────────────────────────────────────────────────────────────
  {
    id: "payroll-tabs",
    doc: "payroll",
    caption: "Payroll has four tabs, and they do different things — read this one carefully.",
    url: "/admin/payroll",
    waitForText: "Custom Payout",
    callouts: [
      { text: "Custom Payout", nth: 0, label: "Confirm and notify" },
      { text: "Extra Pay", nth: 0, label: "Mileage, supplies, bonuses" },
      { text: "Pay Rates", nth: 0, label: "Crew-size percentages" },
      { text: "Run Payroll", nth: 0, label: "Actually send money" },
    ],
    fullPage: true,
  },

  // ── VA performance ───────────────────────────────────────────────────────
  {
    id: "va-performance",
    doc: "va-performance",
    caption: "VA Performance — what the system observed, next to what was self-reported.",
    url: "/admin/va-performance",
    waitForText: "VA Performance",
    callouts: [
      { text: "Today", nth: 0, label: "Today" },
      { text: "Discrepancy queue", label: "Numbers that did not line up" },
      { text: "Send EOD links", label: "Send today's EOD links" },
    ],
    fullPage: true,
  },

  // ── Team ─────────────────────────────────────────────────────────────────
  {
    id: "team-access",
    doc: "team",
    caption: "Team and access — the VA onboarding queue sits above the member list.",
    url: "/admin/team",
    waitForText: "Team & access",
    callouts: [
      { text: "VA onboarding queue", label: "Onboarding queue" },
      { text: "Send a VA offer letter", label: "Send an offer letter" },
      { text: "Work email", label: "Add someone directly" },
    ],
    fullPage: true,
  },

  // ── Commercial ───────────────────────────────────────────────────────────
  {
    id: "commercial-hub",
    doc: "commercial",
    caption: "The commercial hub and its five workspaces.",
    url: "/admin/commercial",
    waitForText: "Overview",
    // Text matching is unreliable here: the sidebar descriptions contain the
    // same words as the workspace tabs. Target the tab row positionally.
    callouts: [
      { text: "Home", exact: true, nth: 0, label: "Home — pipeline snapshot" },
      { text: "Deals", exact: true, nth: 0, label: "Deals — walkthroughs and firm price" },
      { text: "Jobs", exact: true, nth: 0, label: "Jobs — one-off and recurring work" },
      { text: "Compliance", exact: true, nth: 0, label: "Compliance — insurance certificates" },
      { text: "STR", exact: true, nth: 0, label: "STR — turnovers and hosts" },
    ],
    fullPage: true,
  },

  // ── Weekly report ────────────────────────────────────────────────────────
  {
    id: "weekly-report",
    doc: "weekly-report",
    caption: "The weekly report screen — schedule it, or generate one on demand.",
    url: "/admin/weekly-report",
    waitForText: "Weekly Sales",
    callouts: [
      { text: "Generate last week", label: "Generate last week's report" },
      { text: "Schedule", nth: 0, label: "When it runs automatically" },
    ],
    fullPage: true,
  },
];

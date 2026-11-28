// ─── Admin navigation (single source of truth) ───────────────────────────
//
// One role-aware definition feeds the desktop sidebar, the mobile menu, the
// ⌘K command search and the header page title. Labels here are what operators
// see; `aliases` keep former labels (CSR, Internal Booking, Operations,
// Accounts, Intake …) findable in search so muscle memory and old guides
// still work. `help` text is shown in search only — sidebar rows carry the
// label alone.
//
// Visibility is a UX layer. Route guards (ProtectedRoute requiredRole) and
// server-side role checks remain the source of truth: an `adminOnly` item is
// hidden from VAs here AND its page is `admin_strict`.

import {
  RiAlarmWarningLine,
  RiCalendarCheckLine,
  RiDashboardLine,
  RiFileChartLine,
  RiFileEditLine,
  RiFileList3Line,
  RiGroupLine,
  RiHotelLine,
  RiLineChartLine,
  RiMailLine,
  RiMailSendLine,
  RiMoneyDollarCircleLine,
  RiPriceTag3Line,
  RiRepeatLine,
  RiShieldCheckLine,
  RiSparklingLine,
  RiTeamLine,
  RiToolsLine,
  RiUserAddLine,
  RiUserStarLine,
} from "@/components/icons";

export type AdminNavRole = "admin" | "va";

export interface AdminNavItem {
  /** Stable key (used for React keys and collapse state). */
  id: string;
  title: string;
  /** Destination. May carry a query (e.g. a tab) — saved URLs keep working. */
  url: string;
  /** Destination override for VAs (same label, a route they are allowed). */
  vaUrl?: string;
  icon: typeof RiDashboardLine;
  /** Shown in command search, not in the sidebar. */
  help: string;
  /** Former labels and synonyms, indexed by command search. */
  aliases?: string[];
  /** Hidden from VAs (page is admin_strict or otherwise restricted). */
  adminOnly?: boolean;
  /** Extra path prefixes that should light this item up (redirect targets etc.). */
  alsoMatches?: string[];
}

export interface AdminNavGroup {
  id: string;
  title: string;
  items: AdminNavItem[];
}

/** Pinned primary action above the groups. */
export const PRIMARY_ACTION: AdminNavItem = {
  id: "new-booking",
  title: "New Booking",
  url: "/admin/csr",
  icon: RiFileEditLine,
  help: "Book or quote a customer on a call — price, save, resume, hand to dispatch",
  aliases: ["CSR", "CSR form", "Internal Booking", "Internal booker", "VA booking", "Quote a call", "Book a customer"],
};

export const NAV_GROUPS: AdminNavGroup[] = [
  {
    id: "daily",
    title: "Daily Work",
    items: [
      {
        id: "today",
        title: "Today",
        url: "/admin/dashboard",
        icon: RiDashboardLine,
        help: "What needs a decision now, today's schedule, then metrics",
        aliases: ["Dashboard", "Home", "Overview"],
      },
      {
        id: "bookings",
        title: "Bookings",
        url: "/admin/bookings",
        icon: RiCalendarCheckLine,
        help: "Every booking · cancel, reschedule, refund · awaiting deposit · needs staffing",
        aliases: ["Jobs", "Appointments"],
      },
      {
        id: "dispatch",
        title: "Dispatch & Coverage",
        url: "/admin/operations",
        icon: RiAlarmWarningLine,
        help: "Needs attention · dispatch offers · coverage map · sync health",
        aliases: ["Operations", "Needs attention", "Dispatch", "Map", "Operational map", "Coverage", "Sync health"],
        alsoMatches: ["/admin/dispatch", "/admin/attention", "/admin/map", "/admin/sync"],
      },
      {
        id: "qc",
        title: "Quality Control",
        url: "/admin/qc",
        icon: RiShieldCheckLine,
        help: "Open cases by severity · evidence · statements · re-clean decisions",
        aliases: ["QC", "Issues", "Complaints", "Re-clean", "Disputes"],
      },
    ],
  },
  {
    id: "sales",
    title: "Sales & Clients",
    items: [
      {
        id: "quotes",
        title: "Quotes",
        url: "/admin/quotes",
        icon: RiFileList3Line,
        help: "Saved quotes · price-lock expiry · resume and convert",
        aliases: ["Saved quotes", "Estimates"],
        adminOnly: true,
      },
      {
        id: "proposals",
        title: "Proposals",
        url: "/admin/proposals",
        icon: RiMailSendLine,
        help: "Offers · send · agreement · payment · walkthrough pricing",
        aliases: ["Offers", "Walkthroughs", "Commercial proposals", "STR proposals"],
      },
      {
        id: "customers",
        title: "Customers",
        url: "/admin/customers",
        icon: RiGroupLine,
        help: "Customer accounts · next visit · credits · billing",
        aliases: ["Clients", "Members"],
      },
      {
        id: "accounts",
        title: "Business Accounts",
        url: "/admin/accounts",
        icon: RiHotelLine,
        help: "Commercial clients · STR hosts · property managers · portfolio · COI",
        aliases: ["Accounts", "Commercial", "Partnerships", "Partner", "STR", "Property managers"],
        adminOnly: true,
        alsoMatches: ["/admin/commercial", "/admin/partner"],
      },
      {
        id: "recurring",
        title: "Recurring Plans",
        url: "/admin/recurring",
        icon: RiRepeatLine,
        help: "Memberships · recurring cleans · cadence · pause and resume",
        aliases: ["Recurring", "Memberships", "Subscriptions"],
      },
    ],
  },
  {
    id: "workforce",
    title: "Workforce",
    items: [
      {
        id: "cleaners",
        title: "Cleaners & Crews",
        url: "/admin/cleaners",
        icon: RiToolsLine,
        help: "Directory · availability · crews · readiness · urgent hire",
        aliases: ["Cleaners", "Crews", "Contractors", "Directory"],
        alsoMatches: ["/admin/crews"],
      },
      {
        id: "hiring",
        title: "Hiring & Onboarding",
        // Full admins get the contractor intake workspace. VAs keep their
        // existing applicant pipeline inside Cleaners; contractor intake
        // stays admin-only.
        url: "/admin/intake",
        vaUrl: "/admin/cleaners?section=applicants",
        icon: RiUserAddLine,
        help: "Applicants · stage · next step · onboarding · Lead Field Cleaner",
        aliases: ["Intake", "Applicants", "Applications", "Recruiting", "Onboarding"],
      },
    ],
  },
  {
    id: "finance",
    title: "Finance & Reports",
    items: [
      {
        id: "pay",
        title: "Cleaner Pay",
        url: "/admin/payroll",
        icon: RiMoneyDollarCircleLine,
        help: "Money owed · extra pay · pay runs · external payments · rates",
        aliases: ["Payroll", "Payouts", "Extra pay", "1099"],
        adminOnly: true,
      },
      {
        id: "pnl",
        title: "Profit & Loss",
        url: "/admin/pnl",
        icon: RiLineChartLine,
        help: "Collected · pipeline · ad spend · contribution by period",
        aliases: ["P&L", "PnL", "Profit"],
        adminOnly: true,
      },
      {
        id: "va-performance",
        title: "VA Performance",
        url: "/admin/va-performance",
        icon: RiUserStarLine,
        help: "Verified actuals vs EOD · flags · revenue per VA hour",
        aliases: ["VA Performance", "EOD"],
        adminOnly: true,
      },
      {
        id: "weekly-report",
        title: "Weekly Report",
        url: "/admin/weekly-report",
        icon: RiFileChartLine,
        help: "Sales · retention · growth report generation and delivery",
        aliases: ["Weekly Report", "Report PDF"],
        adminOnly: true,
      },
    ],
  },
  {
    id: "settings",
    title: "Settings",
    items: [
      {
        id: "pricing",
        title: "Pricing Rules",
        url: "/admin/pricing",
        icon: RiPriceTag3Line,
        help: "Zones · demand-reactive pricing · guardrails · preview on a sample job",
        aliases: ["Pricing", "Dynamic pricing", "Price rules"],
        adminOnly: true,
      },
      {
        id: "team",
        title: "Team Access",
        url: "/admin/team",
        icon: RiTeamLine,
        help: "Admins and VA access · invited, active, revoked",
        aliases: ["Team", "Users", "Roles", "Permissions"],
        adminOnly: true,
      },
      {
        id: "email",
        title: "Email Settings & Delivery",
        url: "/admin/email",
        icon: RiMailLine,
        help: "Email types · templates · footers · consent · delivery lookup · suppression",
        aliases: ["Email", "Delivery log", "Suppression", "Templates"],
        adminOnly: true,
      },
      {
        id: "compliance",
        title: "Booking Compliance",
        url: "/admin/compliance",
        icon: RiShieldCheckLine,
        help: "Outstanding reviews · acceptances · wording · privacy requests",
        aliases: ["Compliance", "Privacy requests", "Acceptances"],
        adminOnly: true,
      },
      {
        id: "assistant",
        title: "Assistant Settings",
        url: "/admin/assistant",
        icon: RiSparklingLine,
        help: "Ask Novara policy · review queue · assistant health",
        aliases: ["Assistant", "Ask Novara", "AI"],
        adminOnly: true,
      },
    ],
  },
];

/** The item as a given role sees it (VA destination applied). */
export function resolveItem(item: AdminNavItem, role: AdminNavRole): AdminNavItem {
  return role === "va" && item.vaUrl ? { ...item, url: item.vaUrl } : item;
}

/**
 * Groups visible to a role, with VA destinations applied and empty groups
 * removed. Until the role resolves, callers pass "va" so restricted items
 * never flash for a VA.
 */
export function navForRole(role: AdminNavRole): AdminNavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => role === "admin" || !item.adminOnly).map((item) => resolveItem(item, role)),
  })).filter((group) => group.items.length > 0);
}

export function allItemsForRole(role: AdminNavRole): AdminNavItem[] {
  return [PRIMARY_ACTION, ...navForRole(role).flatMap((g) => g.items)];
}

function splitUrl(url: string): { path: string; query: URLSearchParams } {
  const [path, qs = ""] = url.split("?");
  return { path, query: new URLSearchParams(qs) };
}

function pathMatches(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * Score how well an item matches the current location. Segment-aware so
 * prefix-colliding routes don't both light up, and query-aware so
 * /admin/cleaners?section=applicants lights "Hiring & Onboarding" rather than
 * "Cleaners & Crews". 0 = no match; higher = more specific.
 */
export function matchScore(item: AdminNavItem, pathname: string | null, search: URLSearchParams | null): number {
  if (!pathname) return 0;
  const { path, query } = splitUrl(item.url);
  let score = 0;
  if (pathMatches(pathname, path)) {
    score = 10 + path.length;
    for (const [k, v] of query.entries()) {
      if (search?.get(k) === v) score += 100;
      else return 0;
    }
  } else if (item.alsoMatches?.some((p) => pathMatches(pathname, p))) {
    score = 5;
  }
  return score;
}

/** The single active item for the current location, or undefined. */
export function findActiveItem(
  items: AdminNavItem[],
  pathname: string | null,
  search: URLSearchParams | null,
): AdminNavItem | undefined {
  let best: AdminNavItem | undefined;
  let bestScore = 0;
  for (const item of items) {
    const s = matchScore(item, pathname, search);
    if (s > bestScore) {
      best = item;
      bestScore = s;
    }
  }
  return best;
}

/** Text the command menu indexes for an item: label, help and former labels. */
export function searchText(item: AdminNavItem, groupTitle?: string): string {
  return [item.title, item.help, groupTitle, ...(item.aliases || [])].filter(Boolean).join(" ").toLowerCase();
}

/** The sidebar label for a nav item id — the page title every screen shows. */
export function navTitle(id: string): string {
  if (id === PRIMARY_ACTION.id) return PRIMARY_ACTION.title;
  for (const group of NAV_GROUPS) {
    const item = group.items.find((i) => i.id === id);
    if (item) return item.title;
  }
  throw new Error(`Unknown admin nav id: ${id}`);
}

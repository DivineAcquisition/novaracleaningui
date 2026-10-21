// ─── Hiring site role catalog ───────────────────────────────────────────────
//
// Shared copy for hiring.novaracleaning.com. Field Tech is the primary open
// role; Specialized Contractors + Commercial Cleaner sit on an active
// evergreen list (applicants are selected when demand opens).

export type HiringRoleId = "field-tech" | "lead-cleaner" | "recurring-home-cleaner" | "turnover-cleaner" | "specialized-contractors" | "commercial-cleaner";
export type HiringRoleGroup = "field" | "lead" | "specialty";

export interface HiringRole {
  id: HiringRoleId;
  slug: string;
  title: string;
  shortTitle: string;
  tagline: string;
  summary: string;
  location: string;
  type: string;
  pay: string;
  evergreen: boolean;
  group: HiringRoleGroup;
  level: number;
  featured?: boolean;
  highlights: string[];
  expectations: string[];
}

export const HIRING_ROLES: HiringRole[] = [
  {
    id: "field-tech",
    slug: "field-tech",
    title: "Field Cleaner",
    shortTitle: "Field Cleaner",
    tagline: "Independent contractor cleaners for residential homes across the DMV.",
    summary:
      "Join Novara's field team as an independent contractor. Accept jobs near you, earn revenue-share pay, and run your own clean — backed by our scheduling, payments, and support.",
    location: "DMV (MD · DC · VA)",
    type: "1099 · Flexible",
    pay: "35–45% of the job",
    evergreen: false,
    group: "field",
    level: 2,
    highlights: [
      "Revenue-share pay — 35% to start, up to 45% as you prove yourself",
      "You set availability; accept the jobs that fit your week",
      "Jobs routed near your home base so you drive less and earn more",
      "Stripe payouts after completed work",
    ],
    expectations: [
      "Show up on time and check in through the app when you arrive",
      "Follow the job checklist and Novara quality standards",
      "Bring your own supplies (we share a starter checklist)",
      "Treat every home and customer with care",
      "Upload before/after photos and mark the job complete",
    ],
  },
  {
    id: "lead-cleaner",
    slug: "lead-cleaner",
    title: "Lead Field Cleaner",
    shortTitle: "Lead Field Cleaner",
    tagline: "Lead larger jobs, walk the finished work, and show new cleaners the standard.",
    summary:
      "An experienced independent contractor on the Novara network. Lead jobs pay 47% of the job. Solo jobs stay at your normal tier. You can accept or decline any lead, trial, or backup offer.",
    location: "DMV (MD · DC · VA)",
    type: "1099 · Lead jobs",
    pay: "47% on jobs you lead",
    evergreen: false,
    group: "lead",
    level: 3,
    featured: true,
    highlights: [
      "47% of the job on lead jobs. Solo jobs stay at your tier rate",
      "Final walkthrough and photos before a lead job closes",
      "Show a new cleaner the work on a trial job. Novara decides the result",
      "First look at urgent, same-day, and dropped jobs",
    ],
    expectations: [
      "You may accept or decline any lead, trial, or backup offer",
      "You do not approve, reject, or set pay for another contractor",
      "Walkthrough notes are facts and photos",
      "Novara pays every contractor directly",
      "A verified vehicle and a full kit for a two-person job",
    ],
  },
  {
    id: "recurring-home-cleaner",
    slug: "recurring-home-cleaner",
    title: "Recurring Home Cleaner",
    shortTitle: "Recurring",
    tagline: "Residential weekly and biweekly homes. A voluntary independent contractor track.",
    summary: "Residential only. Weekly and biweekly homes. You choose this track. It is independent contractor work.",
    location: "DMV (MD · DC · VA)",
    type: "Independent Contractor",
    pay: "Set in intake settings",
    evergreen: false,
    group: "field",
    level: 2,
    highlights: ["Residential homes on a weekly or biweekly rhythm", "Voluntary track", "You bring your own supplies"],
    expectations: ["Show up prepared with the proper equipment", "Vacuum and mop are part of a normal home"],
  },
  {
    id: "turnover-cleaner",
    slug: "turnover-cleaner",
    title: "Turnover Cleaner",
    shortTitle: "Turnover",
    tagline: "Short-term rental and rental-unit turnovers, with same-day windows.",
    summary: "Turnovers for short-term rentals and rental units. Same-day windows. Independent contractor work.",
    location: "DMV (MD · DC · VA)",
    type: "Independent Contractor",
    pay: "Set in intake settings",
    evergreen: false,
    group: "specialty",
    level: 2,
    highlights: ["Short-term rental and rental-unit turnovers", "Same-day windows", "You bring your own supplies"],
    expectations: ["Show up prepared with the proper equipment", "Vacuum and mop are part of a turnover"],
  },
  {
    id: "specialized-contractors",
    slug: "specialized-contractors",
    title: "Specialized Contractors",
    shortTitle: "Specialized",
    tagline: "Deep clean, move-out, post-construction, and specialty residential work.",
    summary:
      "Experienced contractors for specialty residential jobs — deep cleans, move-in/move-out, and higher-complexity scopes. This is an active evergreen list: we review every application and select contractors when demand opens.",
    location: "DMV (MD · DC · VA)",
    type: "1099 · On-demand",
    pay: "Job-based · specialty rates",
    evergreen: true,
    group: "specialty",
    level: 2,
    highlights: [
      "Higher-complexity residential scopes when they open",
      "Selected from the evergreen list when needed — not a standing daily roster",
      "Bring proven specialty experience (deep, move-out, post-construction)",
      "Same contractor portal and payout rails as Field Cleaner",
    ],
    expectations: [
      "Reliable transportation and your own specialty supplies",
      "Comfortable with multi-hour, checklist-driven jobs",
      "Clear photo documentation and on-time completion",
      "Professional communication with dispatch",
    ],
  },
  {
    id: "commercial-cleaner",
    slug: "commercial-cleaner",
    title: "Commercial Cleaner",
    shortTitle: "Commercial",
    tagline: "Offices, retail, and commercial facilities — scheduled and on-call.",
    summary:
      "Independent contractors for commercial and office cleaning. This is an active evergreen list: applicants are reviewed and selected when commercial demand opens in your area.",
    location: "DMV (MD · DC · VA)",
    type: "1099 · Scheduled / on-call",
    pay: "Job-based · commercial rates",
    evergreen: true,
    group: "specialty",
    level: 2,
    highlights: [
      "Commercial and office facilities when routes open",
      "Active evergreen list — selected when needed, not added while there is no work",
      "Recurring and one-off commercial scopes",
      "Contractor portal + Stripe payouts",
    ],
    expectations: [
      "Reliable schedule adherence for facility windows",
      "Comfortable in commercial / office environments",
      "Own supplies and transportation",
      "Clear check-in / check-out and photo documentation",
    ],
  },
];

export function roleBySlug(slug: string): HiringRole | undefined {
  return HIRING_ROLES.find((r) => r.slug === slug);
}

export function roleById(id: HiringRoleId): HiringRole {
  return HIRING_ROLES.find((r) => r.id === id)!;
}

/** Label stored on cleaner_applicants.role for pipeline filtering. */
export function applicantRoleLabel(id: HiringRoleId): string {
  switch (id) {
    case "field-tech":
      return "Field Cleaner";
    case "lead-cleaner":
      return "Lead Field Cleaner";
    case "recurring-home-cleaner":
      return "Recurring Home Cleaner";
    case "turnover-cleaner":
      return "Turnover Cleaner";
    case "specialized-contractors":
      return "Specialized Contractor";
    case "commercial-cleaner":
      return "Commercial Cleaner";
  }
}

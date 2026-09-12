// ─── Guided tour anchors ─────────────────────────────────────────────────────
//
// Every element a walkthrough step can point at is named here once, and both
// sides import the name: the component spreads `tourAnchor(TOUR.x)` onto the
// element, and the step in the catalog references `TOUR.x`.
//
// Why a registry instead of CSS selectors in the step definitions: a selector
// like `.grid > div:nth-child(2)` survives no refactor at all, and when it
// breaks it breaks silently — the walkthrough points at empty space, or at the
// wrong thing, which is worse. A named attribute is something a developer
// deletes deliberately, and `npm run tours:verify` fails when a step
// references an anchor no component renders any more.
//
// Naming note: this feature is "walkthroughs" to contractors, but "tour" in
// code. `walkthrough` was already taken — it means a commercial property site
// visit (`/cleaner/walkthrough/[token]`, `/api/admin/walkthroughs`), and
// reusing the word would have made both features harder to search for.
//
// Anchors are contractor-facing UI only. Nothing here should be attached to an
// element that only exists for admins.

/**
 * Anchor ids, grouped by the screen they live on.
 *
 * The string values are stable and appear in the DOM; treat them like public
 * identifiers. Renaming one means updating the component that renders it, and
 * the verify script will tell you if you missed a side.
 */
export const TOUR = {
  // ── Portal chrome (every page inside ContractorLayout) ──
  navDashboard: "nav-dashboard",
  navOffers: "nav-offers",
  navJobLookup: "nav-job-lookup",
  navProfile: "nav-profile",
  navTraining: "nav-training",
  helpButton: "help-button",

  // ── /cleaner/dashboard ──
  dashboardStats: "dashboard-stats",
  statEarnings: "stat-earnings",
  statJobsCompleted: "stat-jobs-completed",
  statRating: "stat-rating",
  statUpcoming: "stat-upcoming",
  upcomingJobs: "upcoming-jobs",
  completedJobs: "completed-jobs",
  payments: "payments",

  // ── A job card on the dashboard ──
  jobCard: "job-card",
  jobCardPay: "job-card-pay",
  jobCardWhen: "job-card-when",
  jobCardAddress: "job-card-address",
  jobCardDetails: "job-card-details",
  jobCardChecklist: "job-card-checklist",
  jobCardCheckIn: "job-card-check-in",

  // ── /cleaner/mobile-dashboard ──
  jobsTabs: "jobs-tabs",

  // ── /cleaner/job-offers ──
  offersList: "offers-list",
  offerCard: "offer-card",
  offerReview: "offer-review",

  // ── /cleaner/job-offer/[token] ──
  offerDecision: "offer-decision",

  // ── /cleaner/job-checklist/[token] ──
  checklistProgress: "checklist-progress",
  checklistNotes: "checklist-notes",
  checklistSection: "checklist-section",
  checklistItem: "checklist-item",
  checklistSectionPhotos: "checklist-section-photos",
  checklistReportIssue: "checklist-report-issue",
  checklistFinish: "checklist-finish",

  // ── /cleaner/job-photos/[token] ──
  photosBefore: "photos-before",
  photosAfter: "photos-after",
  photosNotes: "photos-notes",
  photosSubmit: "photos-submit",

  // ── /contractor/jobs (pay ledger + Novara Score) ──
  lookupForm: "lookup-form",
  payTiles: "pay-tiles",
  scoreTiles: "score-tiles",
  tips: "tips",

  // ── /cleaner/profile ──
  profileAvailability: "profile-availability",

  // ── /cleaner/training ──
  trainingRecordings: "training-recordings",
} as const;

export type TourAnchor = (typeof TOUR)[keyof typeof TOUR];

/** Every anchor id, for the verify script and the overlay's dev warnings. */
export const ALL_TOUR_ANCHORS: TourAnchor[] = Object.values(TOUR);

export const TOUR_ATTRIBUTE = "data-tour";

/**
 * Spread onto the element a step points at:
 *
 *   <Card {...tourAnchor(TOUR.jobCard)}>
 *
 * Returning an object rather than a bare string keeps the attribute name in
 * one place, so anchors can never be half-renamed across the codebase.
 */
export function tourAnchor(anchor: TourAnchor): Record<string, string> {
  return { [TOUR_ATTRIBUTE]: anchor };
}

/**
 * The live element for an anchor, or null when this screen doesn't have it.
 *
 * Two reasons an anchor can match more than once, and both need the same
 * answer — the one the contractor can actually see:
 *
 *   The portal chrome renders its nav twice, once for the sidebar and once
 *   for the mobile drawer, and only one of them is visible at a given width.
 *   The hidden copy still matches the selector but measures zero by zero, so
 *   naively taking the first match spotlights a point in the corner.
 *
 *   Repeated content (a job card per job) matches once per item. The first
 *   visible one is the soonest job, which is the one being talked about.
 */
export function findAnchor(anchor: TourAnchor): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const matches = Array.from(
    document.querySelectorAll<HTMLElement>(`[${TOUR_ATTRIBUTE}="${anchor}"]`),
  );
  if (!matches.length) return null;
  const visible = matches.find((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  return visible || null;
}

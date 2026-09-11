// ─── Guided tour catalog ─────────────────────────────────────────────────────
//
// The seven contractor walkthroughs. Each one runs against the live portal —
// there is no recorded copy of the UI here, only the names of things to point
// at and what to say about them. That is the whole reason this approach was
// chosen: a screenshot of the dashboard goes stale the day someone moves a
// button, and nothing tells you. A step that points at `TOUR.jobCardChecklist`
// either finds the real button or reports itself as missing.
//
// Keep every walkthrough short. The contractors these are written for are
// standing in a driveway with one hand on a caddy; anything over about two
// minutes gets skipped, and a skipped walkthrough teaches nothing.

import { TOUR, type TourAnchor } from "./anchors";

// ── Screens ────────────────────────────────────────────────────────────────
//
// A step names the screen it lives on so the engine knows whether it can get
// there. Two of these screens are reachable only through a per-job token that
// dispatch texts to the contractor (the on-site checklist and photo pages, no
// login required). We can't manufacture one of those links, and we would not
// want to drop a contractor into a real job's checklist mid-tour anyway — one
// stray tap and they've checked off work they haven't done. So token screens
// are `tokenScoped`: their steps spotlight the real element when the
// contractor is already on that page, and otherwise explain it from wherever
// they are.

export type TourScreenId =
  | "dashboard"
  | "mobileDashboard"
  | "offers"
  | "offerDecision"
  | "jobLookup"
  | "profile"
  | "training"
  | "jobChecklist"
  | "jobPhotos";

export interface TourScreen {
  id: TourScreenId;
  /** How a contractor would describe this screen. Used in fallback copy. */
  label: string;
  /** Path the engine can navigate to, or null when a job token is required. */
  path: string | null;
  /** True when reaching this screen needs a per-job link from dispatch. */
  tokenScoped: boolean;
}

export const TOUR_SCREENS: Record<TourScreenId, TourScreen> = {
  dashboard: { id: "dashboard", label: "your dashboard", path: "/cleaner/dashboard", tokenScoped: false },
  mobileDashboard: { id: "mobileDashboard", label: "your dashboard", path: "/cleaner/mobile-dashboard", tokenScoped: false },
  offers: { id: "offers", label: "the Offers page", path: "/cleaner/job-offers", tokenScoped: false },
  offerDecision: { id: "offerDecision", label: "a job offer", path: null, tokenScoped: true },
  jobLookup: { id: "jobLookup", label: "Job lookup", path: "/contractor/jobs", tokenScoped: false },
  profile: { id: "profile", label: "your Profile", path: "/cleaner/profile", tokenScoped: false },
  training: { id: "training", label: "Training", path: "/cleaner/training", tokenScoped: false },
  jobChecklist: { id: "jobChecklist", label: "the job checklist", path: null, tokenScoped: true },
  jobPhotos: { id: "jobPhotos", label: "the job photo page", path: null, tokenScoped: true },
};

// ── Steps ──────────────────────────────────────────────────────────────────

export type TourPlacement = "auto" | "top" | "bottom" | "left" | "right";

export interface TourStep {
  /** Stable within its walkthrough. Saved progress refers to the index, but
   *  this id is what shows up in logs and in the verify script's output. */
  id: string;
  title: string;
  body: string;
  /** The screen this step is about. */
  screen: TourScreenId;
  /** The element to spotlight. Omit for a step that is just a card. */
  anchor?: TourAnchor;
  placement?: TourPlacement;
  /**
   * Shown instead of the spotlight when the anchor isn't on screen — either
   * because the screen needs a job token, or because this contractor has
   * nothing in that list yet (no upcoming jobs means no job card to point at).
   *
   * Required whenever `anchor` is set, so no step can ever degrade into a
   * popover floating over nothing.
   */
  fallback?: string;
}

export type TourId =
  | "dashboard-basics"
  | "reading-a-job"
  | "working-the-checklist"
  | "photo-documentation"
  | "communication"
  | "pay-and-score"
  | "availability-and-offers";

export interface Tour {
  id: TourId;
  title: string;
  /** One line, shown in the Help menu and the admin completion table. */
  summary: string;
  /**
   * Bumped by hand when the underlying feature changes materially — a moved
   * button, a renamed screen, a new rule. Contractors who finished an older
   * version get it offered again; see `progress.ts`. Cosmetic copy edits
   * should NOT bump it, or the re-offer becomes noise people learn to dismiss.
   */
  version: number;
  /** Order in the Help menu, and the order of the first-login sequence. */
  order: number;
  /** Part of the automatic first-login sequence. */
  autoStart: boolean;
  /** Rough length, shown up front so nobody starts one blind. */
  estimatedSeconds: number;
  steps: TourStep[];
}

// The copy below deliberately states rules, not just locations. "Here is the
// checklist button" teaches nothing a contractor couldn't find by tapping
// around; "the checklist is the scope of the job, and it's what you answer the
// client from" is the part that gets repeated back to us in disputes.

export const TOURS: Tour[] = [
  {
    id: "dashboard-basics",
    title: "Your dashboard — the basics",
    summary: "What's on the screen and where to find everything else.",
    version: 1,
    order: 1,
    autoStart: true,
    estimatedSeconds: 75,
    steps: [
      {
        id: "welcome",
        title: "This is your dashboard",
        body: "Everything you need for a job lives on this screen or one tap from it. This walkthrough takes about a minute. You can stop at any point and pick it up later — nothing here blocks you from working.",
        screen: "dashboard",
      },
      {
        id: "stats",
        title: "Your numbers at a glance",
        body: "Lifetime pay, jobs completed, your client rating, and how many jobs you have coming up. These update on their own as jobs close out.",
        screen: "dashboard",
        anchor: TOUR.dashboardStats,
        fallback: "Four tiles across the top of your dashboard show lifetime pay, jobs completed, your rating, and upcoming job count.",
        placement: "bottom",
      },
      {
        id: "upcoming",
        title: "Upcoming jobs",
        body: "Your scheduled work, soonest first. Each card carries the date and time, the address, the pay, and the buttons for that job.",
        screen: "dashboard",
        anchor: TOUR.upcomingJobs,
        fallback: "Your scheduled work appears under \"Upcoming Jobs\", soonest first. It's empty right now — new assignments land here as they're offered and accepted.",
        placement: "top",
      },
      {
        id: "completed",
        title: "Completed jobs",
        body: "Finished work, with what you were paid for each one. Use it to check a past job before you call the office about it.",
        screen: "dashboard",
        anchor: TOUR.completedJobs,
        fallback: "Below your upcoming work, \"Completed Jobs\" lists finished jobs with the pay for each.",
        placement: "top",
      },
      {
        id: "nav",
        title: "Getting around",
        body: "Offers is where new work shows up. Job lookup has your full pay history and your Novara Score. Training has your playbooks and the screen recordings of these same walkthroughs.",
        screen: "dashboard",
        anchor: TOUR.navOffers,
        fallback: "The menu has Dashboard, Offers, Job lookup, Turnovers, Profile, and Training.",
        placement: "right",
      },
      {
        id: "help",
        title: "Re-run any of these",
        body: "All seven walkthroughs live behind this button, along with the recorded versions. Nothing is one-and-done — come back whenever you want a refresher.",
        screen: "dashboard",
        anchor: TOUR.helpButton,
        fallback: "The Help & training button in the menu re-opens any walkthrough.",
        placement: "right",
      },
    ],
  },

  {
    id: "reading-a-job",
    title: "Reading a job before you arrive",
    summary: "Find and read the full checklist before you're standing at the door.",
    version: 1,
    order: 2,
    autoStart: true,
    estimatedSeconds: 90,
    steps: [
      {
        id: "why",
        title: "Read the job before you drive to it",
        body: "Most bad visits start the same way: the contractor found out what the job included after they arrived. Everything you need is on the job card before you leave the house.",
        screen: "dashboard",
      },
      {
        id: "card",
        title: "Start with the job card",
        body: "One card per job. The client's name and the service type are at the top — a Standard, a Deep, and a Move-Out are very different days of work.",
        screen: "dashboard",
        anchor: TOUR.jobCard,
        fallback: "Each job on your dashboard is one card, with the client name and service type at the top.",
        placement: "top",
      },
      {
        id: "when-where",
        title: "When and where",
        body: "Confirm the date, the arrival window, and the address the night before. Get Directions opens the route so you can see the real drive time instead of guessing.",
        screen: "dashboard",
        anchor: TOUR.jobCardWhen,
        fallback: "The job card shows the date and arrival window, with the full address and a Get Directions button under it.",
        placement: "bottom",
      },
      {
        id: "details",
        title: "Job details and notes",
        body: "Square footage, beds and baths, pets, parking, entry instructions, and anything the office or the client added. Read the notes. They are where the surprises are.",
        screen: "dashboard",
        anchor: TOUR.jobCardDetails,
        fallback: "Expanding the job details on the card shows size, beds and baths, entry instructions, and any notes from the office or the client.",
        placement: "top",
      },
      {
        id: "checklist-button",
        title: "Open the checklist before you arrive",
        body: "This button opens the full checklist for this specific job. Open it the night before or in the car — not while the client is standing in front of you.",
        screen: "dashboard",
        anchor: TOUR.jobCardChecklist,
        fallback: "Each job card has a Job Checklist button. Dispatch also texts you the same link. Open it before you arrive.",
        placement: "top",
      },
      {
        id: "scope",
        title: "The checklist is the scope of the job",
        body: "Every line on it is included and expected. Nothing off it is included. If a client asks \"does this include the inside of the fridge?\", the checklist is your answer — you should be able to answer that question before you knock, without calling the office.",
        screen: "jobChecklist",
        anchor: TOUR.checklistProgress,
        fallback: "The checklist lists every area and every line item for this job. That list is the scope: on it is included, off it is not. Read it before you arrive so you can answer \"what does this include?\" yourself.",
        placement: "bottom",
      },
      {
        id: "extras",
        title: "Asked for something that isn't on it?",
        body: "Don't agree to it and don't refuse it. Tell the client you'll check with the office, then message dispatch. Work added off the books is work you don't get paid for.",
        screen: "jobChecklist",
      },
    ],
  },

  {
    id: "working-the-checklist",
    title: "Working the checklist",
    summary: "Check off as you go, and finish one area before you start the next.",
    version: 1,
    order: 3,
    autoStart: true,
    estimatedSeconds: 80,
    steps: [
      {
        id: "intro",
        title: "The checklist is live while you work",
        body: "It isn't paperwork you fill in at the end. The office sees your progress as it happens, and so does the rest of your crew.",
        screen: "jobChecklist",
      },
      {
        id: "progress",
        title: "Your progress bar",
        body: "Shows how much of the job is done. This is what dispatch looks at when a client calls asking how it's going, so keeping it current keeps them off your phone.",
        screen: "jobChecklist",
        anchor: TOUR.checklistProgress,
        fallback: "A progress bar at the top of the checklist shows how many items are done. Dispatch watches the same number.",
        placement: "bottom",
      },
      {
        id: "one-area",
        title: "One area at a time",
        body: "Finish a room completely before you open the next one. Half-done rooms are how things get missed, and a client walking through behind you sees an unfinished room as an unfinished job.",
        screen: "jobChecklist",
        anchor: TOUR.checklistSection,
        fallback: "The checklist is grouped by area — kitchen, bathrooms, bedrooms. Complete one area before starting another.",
        placement: "top",
      },
      {
        id: "as-you-go",
        title: "Check off as you go — not in bulk",
        body: "Tap each item as you finish it. Do not save them all up and tap through at the end. Bulk-checking a whole job in the last two minutes is visible on our side, it tells us nothing about the work, and it's treated as unverified.",
        screen: "jobChecklist",
        anchor: TOUR.checklistItem,
        fallback: "Tap each line as you finish that line. Checking everything off at once at the end is visible to the office and doesn't count as documentation.",
        placement: "right",
      },
      {
        id: "section-photos",
        title: "Photos for the areas that need them",
        body: "Some areas need a before and an after photo attached right here. Those areas can't be marked complete without both.",
        screen: "jobChecklist",
        anchor: TOUR.checklistSectionPhotos,
        fallback: "Areas that require documentation have their own before and after photo slots, and won't mark complete until both are attached.",
        placement: "top",
      },
      {
        id: "finish",
        title: "Finishing the job",
        body: "The finish button unlocks once every item is checked and every required photo is in. If it's still greyed out, something is unchecked — scroll back and find it rather than calling the office.",
        screen: "jobChecklist",
        anchor: TOUR.checklistFinish,
        fallback: "The finish button at the bottom stays locked until every item is checked and every required photo is attached.",
        placement: "top",
      },
    ],
  },

  {
    id: "photo-documentation",
    title: "Photo documentation",
    summary: "Before and after, what makes a photo usable, and why completion needs them.",
    version: 1,
    order: 4,
    autoStart: true,
    estimatedSeconds: 85,
    steps: [
      {
        id: "why",
        title: "Photos are what protect you",
        body: "When a client disputes a clean, your photos are the entire conversation. A job with good before-and-afters ends the dispute. A job without them becomes your word against theirs.",
        screen: "jobPhotos",
      },
      {
        id: "before",
        title: "Before photos — take them first",
        body: "Shoot before you touch anything, as soon as you walk in. A before photo taken after you've started isn't a before photo, and it's the one that proves the damage or the mess was already there.",
        screen: "jobPhotos",
        anchor: TOUR.photosBefore,
        fallback: "The photo page has a Before section. Shoot it the moment you arrive, before you start work.",
        placement: "top",
      },
      {
        id: "after",
        title: "After photos — same angle",
        body: "Stand where you stood for the before shot and take the same frame. Matched pairs are what make the difference obvious; two unrelated angles prove nothing.",
        screen: "jobPhotos",
        anchor: TOUR.photosAfter,
        fallback: "The After section takes the matching shots. Stand where you stood for the before photo and frame it the same way.",
        placement: "top",
      },
      {
        id: "usable",
        title: "What makes a photo usable",
        body: "Lights on. Whole surface in frame, not a close-up of one tile. Hold still — a blurred photo is a photo we can't use. If the room is dark, turn on the light rather than using the flash on a mirror or a window.",
        screen: "jobPhotos",
      },
      {
        id: "damage",
        title: "Anything already broken or stained",
        body: "Photograph it before you start and report it the same visit. Pre-existing damage you documented is a note on the file. The same damage found after you leave is yours to explain.",
        screen: "jobPhotos",
        anchor: TOUR.photosNotes,
        fallback: "Use the notes box on the photo page to describe anything already damaged or stained, and photograph it before you start work.",
        placement: "top",
      },
      {
        id: "submit",
        title: "Photos are required to complete a job",
        body: "Submit before you drive away. A job without its photos reads as incomplete on our side, which holds up the client's confirmation and your pay for it.",
        screen: "jobPhotos",
        anchor: TOUR.photosSubmit,
        fallback: "Submitting the photos is what completes the documentation. Do it before you leave the property — unsubmitted photos read as an incomplete job.",
        placement: "top",
      },
    ],
  },

  {
    id: "communication",
    title: "Communication from the field",
    summary: "Where the office reaches you, how you reach them, and flagging a problem.",
    version: 1,
    order: 5,
    autoStart: true,
    estimatedSeconds: 80,
    steps: [
      {
        id: "intro",
        title: "You are never expected to solve it alone",
        body: "Almost nothing that goes wrong on a job is something you have to handle by yourself. What matters is telling us while you're still standing there, not afterwards.",
        screen: "jobChecklist",
      },
      {
        id: "notes",
        title: "Where the office talks to you",
        body: "Access notes, office notes, and dispatch notes sit at the top of the job checklist. When we need you to know something about a specific job, that's where it goes — read it before you start.",
        screen: "jobChecklist",
        anchor: TOUR.checklistNotes,
        fallback: "Access notes, office notes, and dispatch notes appear at the top of each job's checklist. That's where job-specific instructions from the office land.",
        placement: "bottom",
      },
      {
        id: "report",
        title: "Flagging a problem or damage",
        body: "This sends a report straight to dispatch with the job attached. Use it for damage, a lock you can't get through, a client dispute, a pet you can't work around, anything unsafe. Then stay put unless it's unsafe — we'll come back to you.",
        screen: "jobChecklist",
        anchor: TOUR.checklistReportIssue,
        fallback: "The report button on the checklist sends dispatch a field report with the job attached. Use it for damage, access problems, or anything unsafe — then wait for us to respond.",
        placement: "top",
      },
      {
        id: "response-time",
        title: "The five-minute expectation",
        body: "During a scheduled job, answer a call or text from the office within five minutes. It's not surveillance — it's the window in which a problem is still fixable. If you can't answer because your hands are wet or you're on a ladder, call back as soon as they're free.",
        screen: "jobChecklist",
      },
      {
        id: "phone",
        title: "Your phone has to be reachable",
        body: "Charged, on you, and not on silent for the whole visit. An unreachable contractor mid-job is the single thing most likely to turn a small problem into a refund.",
        screen: "jobChecklist",
      },
      {
        id: "office",
        title: "Reaching the office",
        body: "For anything that isn't tied to a live job — schedule questions, pay questions, documents — use the support contact at the bottom of your dashboard. Job problems always go through the report button so they land attached to the job.",
        screen: "dashboard",
      },
    ],
  },

  {
    id: "pay-and-score",
    title: "Your pay and your score",
    summary: "What you earn per job, where your pay history lives, and what the Novara Score measures.",
    version: 1,
    order: 6,
    autoStart: true,
    estimatedSeconds: 85,
    steps: [
      {
        id: "per-job",
        title: "Pay is per job, and it's on the card",
        body: "Every job shows what it pays before you accept it. There's no hourly rate to work out and no surprise at the end of the week — the number on the card is the number.",
        screen: "dashboard",
        anchor: TOUR.jobCardPay,
        fallback: "Each job card shows what that job pays, and the line under it explains how the number was worked out — solo or a crew share.",
        placement: "left",
      },
      {
        id: "lifetime",
        title: "Lifetime earnings",
        body: "The running total of what you've actually been paid, not what was estimated. It reflects real payouts, including extras like supplies and mileage.",
        screen: "dashboard",
        anchor: TOUR.statEarnings,
        fallback: "The Total Earnings tile on your dashboard is the sum of what you've actually been paid.",
        placement: "bottom",
      },
      {
        id: "history",
        title: "Your full pay history",
        body: "Job lookup breaks it down: paid to you, still pending, and how many jobs have been paid. Every job pay and every extra is itemised, so you can check a specific job instead of asking us to.",
        screen: "jobLookup",
        anchor: TOUR.payTiles,
        fallback: "Job lookup shows paid-to-you, pending, and jobs-paid totals, with each job itemised underneath.",
        placement: "bottom",
      },
      {
        id: "tips",
        title: "Tips are yours",
        body: "One hundred percent of every tip goes to the crew — Novara takes none of it. Tips don't affect your pay rate or your scores, and they arrive with your payouts.",
        screen: "jobLookup",
        anchor: TOUR.tips,
        fallback: "Tips from clients appear in their own section in Job lookup. All of every tip goes to the crew and none of it affects your scores.",
        placement: "top",
      },
      {
        id: "score",
        title: "What the Novara Score measures",
        body: "Reliability, mostly: showing up, showing up on time, not dropping accepted work, and documenting what you did. Your Rating is separate — that's client feedback and QC. Both are shown here, and only ever yours.",
        screen: "jobLookup",
        anchor: TOUR.scoreTiles,
        fallback: "Your Novara Score and your Rating appear in Job lookup. The Score is about reliability — turning up, on time, and documenting the work. The Rating is client feedback and QC.",
        placement: "bottom",
      },
      {
        id: "explainable",
        title: "A score change is always explainable",
        body: "If QC cases are pulling your Rating down, the page says so and tells you how many. You should never have to guess why a number moved — if it isn't clear, ask the office.",
        screen: "jobLookup",
      },
      {
        id: "payouts",
        title: "Where the money arrives",
        body: "Payouts run through Stripe. Payments & Earnings on your dashboard opens your Stripe dashboard for payout dates and tax documents. If it says Pending, your payouts aren't set up yet and that's worth fixing today.",
        screen: "dashboard",
        anchor: TOUR.payments,
        fallback: "The Payments & Earnings card on your dashboard opens your Stripe dashboard, where payout dates and tax documents live.",
        placement: "top",
      },
    ],
  },

  {
    id: "availability-and-offers",
    title: "Availability and job offers",
    summary: "Accepting, declining, keeping your availability honest, and what an unanswered offer does.",
    version: 1,
    order: 7,
    autoStart: true,
    estimatedSeconds: 75,
    steps: [
      {
        id: "intro",
        title: "How work reaches you",
        body: "When a job near you needs someone, we offer it to the closest available contractors. You'll get a text, and the same offer is always here in the app in case the text doesn't land.",
        screen: "offers",
      },
      {
        id: "list",
        title: "Your open offers",
        body: "Every offer waiting on you, with the date, the area, and what it pays. If you ever think you missed an offer, look here first — this list is the truth, not your text history.",
        screen: "offers",
        anchor: TOUR.offersList,
        fallback: "The Offers page lists every offer waiting on you. Check here if you think a text didn't arrive — nothing is missed as long as the offer is still open.",
        placement: "top",
      },
      {
        id: "review",
        title: "Review before you decide",
        body: "Open the offer and read it properly — date, arrival window, area, pay, and how far it is. Accepting a job you then can't reach on time is worse for you than declining it.",
        screen: "offers",
        anchor: TOUR.offerReview,
        fallback: "Each offer has a review button that opens the full details — date, window, area, pay, and distance — before you decide.",
        placement: "left",
      },
      {
        id: "decide",
        title: "Accept or decline — both are fine",
        body: "Declining a job you can't do well is a normal, sensible answer and it isn't held against you. Accepting and then dropping it is the thing that hurts: it counts against your reliability, because by then we've told the client someone is coming.",
        screen: "offerDecision",
        anchor: TOUR.offerDecision,
        fallback: "The offer page has Accept and Decline. Declining is fine. Accepting and later dropping the job counts against your reliability, because the client has already been promised.",
        placement: "top",
      },
      {
        id: "expiry",
        title: "An offer you don't answer expires",
        body: "Offers hold for a short window, then expire on their own and go to the next contractor in line. Silence isn't a decline — it just means the job goes to someone else while you were deciding.",
        screen: "offers",
      },
      {
        id: "availability",
        title: "Keep your availability current",
        body: "This switch is what decides whether you get offered work at all. Turn it off when you're away and back on when you return. Leaving it on while you're unavailable means offers going to you and expiring — which quietly pushes you down the list.",
        screen: "profile",
        anchor: TOUR.profileAvailability,
        fallback: "The availability switch in your Profile controls whether you're offered work. Turn it off when you're away, and back on when you're free.",
        placement: "top",
      },
    ],
  },
];

// ── Lookups ────────────────────────────────────────────────────────────────

export const TOURS_BY_ID: Record<TourId, Tour> = TOURS.reduce(
  (acc, tour) => {
    acc[tour.id] = tour;
    return acc;
  },
  {} as Record<TourId, Tour>,
);

export const TOUR_IDS: TourId[] = TOURS.map((t) => t.id);

export function getTour(id: string): Tour | null {
  return TOURS_BY_ID[id as TourId] || null;
}

/** The first-login sequence, in order. */
export function autoStartTours(): Tour[] {
  return TOURS.filter((t) => t.autoStart).sort((a, b) => a.order - b.order);
}

/** Catalog fingerprint, so the client can tell when its cached copy is old. */
export function tourCatalogSignature(): string {
  return TOURS.map((t) => `${t.id}@${t.version}`).join(",");
}

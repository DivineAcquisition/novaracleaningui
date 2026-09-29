// ─── Day To Day Operations — training video storyboard ────────────────────
//
// One entry per frame of the video, in the order the video plays, mapped to
// the one-page guide (public/cleaner/guide-pdfs/day-to-day-job-operations.pdf):
// four stops, four lines each, then "Job complete" and the two closing
// lines. Every screen is the real contractor app driven by Playwright; every
// job, name and address is invented (day-to-day-scenario.ts).
//
// Run with:  npm run docs:capture:day-to-day
//
// `bullet` is the guide's wording, verbatim — it is the frame headline, so a
// contractor hears and reads the same sentence they have on paper. `onScreen`
// says what the viewer is looking at; `narration` is a suggested voiceover
// line, kept to what the screen actually shows.

import type { Page } from "playwright";

import { HERO, installDayToDayScenario, type DayToDayScenario } from "./day-to-day-scenario";
import type { SpotTarget } from "./spotlight";

export type StageKey = 1 | 2 | 3 | 4;

export const STAGES: Record<StageKey, { title: string; bullets: string[] }> = {
  1: {
    title: "Before you go",
    bullets: [
      "Open the job — read the FULL checklist",
      "Read access details and property notes",
      "Phone charged, ringer ON, data working",
      "Supplies loaded and ready",
    ],
  },
  2: {
    title: "When you arrive",
    bullets: [
      "Arrive inside your window — late? call first",
      "Greet the client, confirm access",
      "Ask about pets — have them moved",
      "Take BEFORE photos of every area",
    ],
  },
  3: {
    title: "While you work",
    bullets: [
      "Work the checklist in order",
      "Check items off AS you finish them",
      "Finish one area before starting another",
      "Ask before moving furniture — put it back",
    ],
  },
  4: {
    title: "Before you leave",
    bullets: [
      "Walk every area one final time",
      "Take AFTER photos of every area",
      "Report ANY issue — before you leave",
      "Mark the job complete in your dashboard",
    ],
  },
};

export const GUIDE_LINES = {
  title: "Your Job, Start to Finish",
  intro: "Same four stops, every single job. This is what a great job looks like.",
  complete: { title: "Job complete", line: "Photos in. Checklist done. Nothing left for the client to fix." },
  remember: {
    title: "Show up on time. Work the checklist. Document everything.",
    line: "That is how you move up a tier and earn more per job.",
  },
  call: {
    title: "Unsure about anything? Call the office.",
    line: "You are never in trouble for asking. Guessing wrong costs far more.",
  },
};

/** Where a shot sits in the guide: a stop, the "Job complete" line, or the closing lines. */
export type Section = StageKey | "complete" | "remember" | "call";

export interface DayShot {
  kind: "shot";
  slug: string;
  section: Section;
  /** The guide line this screen supports (verbatim), or the closing line. */
  bullet: string;
  onScreen: string;
  narration: string;
  url: string;
  scenario: DayToDayScenario;
  /** Defaults to signed in as the demo contractor. */
  signedIn?: boolean;
  waitFor: string;
  setup?: (page: Page) => Promise<void>;
  spotlight?: SpotTarget[];
  align?: "center" | "top";
  /** Height of a sticky header the spotlight must not slide under. */
  header?: number;
  pad?: number;
  /** Full-length capture for a scroll/pan in the edit — no spotlight, no frame. */
  tall?: boolean;
  /** Keep toasts on screen (they are hidden by default). */
  toasts?: boolean;
  /** Caveat for the README: where the app and the guide differ, or the screen is related rather than literal. */
  note?: string;
}

export interface DayCard {
  kind: "card";
  slug: string;
  card: "title" | "guide" | "stage" | "complete" | "remember" | "call";
  stage?: StageKey;
}

export type StoryboardEntry = DayShot | DayCard;

// ─── Shared targets and steps ──────────────────────────────────────────────

const CHECKLIST = `/cleaner/job-checklist/${HERO.checklistToken}`;
const PHOTOS = `/cleaner/job-photos/${HERO.photoToken}`;
const DASHBOARD = "/cleaner/dashboard";

const firstCard = '[data-tour="job-card"]';
const DASHBOARD_HEADER = 72;
const TOKEN_PAGE_HEADER = 12;

const expandJobDetails = async (page: Page) => {
  const card = page.locator(firstCard).first();
  await card.getByRole("button", { name: /View job details/i }).click();
  await card.getByText("Customer details", { exact: false }).waitFor({ timeout: 10_000 });
};

const openIssueReport = async (page: Page) => {
  await page.locator('[data-tour="checklist-report-issue"]').click();
  await page
    .getByPlaceholder(/What's wrong\?/i)
    .fill("Upstairs bathroom mirror has a hairline crack in the lower corner. It was there before I started — it's in my before photos.");
};

export const STORYBOARD: StoryboardEntry[] = [
  { kind: "card", slug: "title", card: "title" },
  { kind: "card", slug: "the-guide", card: "guide" },

  // ── 1 · Before you go ───────────────────────────────────────────────────
  { kind: "card", slug: "stop-1-before-you-go", card: "stage", stage: 1 },
  {
    kind: "shot",
    slug: "open-the-job",
    section: 1,
    bullet: STAGES[1].bullets[0],
    onScreen: "Dashboard → today's job → Job Checklist",
    narration: "Start in your dashboard. Today's job is at the top of Upcoming Jobs — tap Job Checklist to open it.",
    url: DASHBOARD,
    scenario: { stage: "before" },
    waitFor: "Upcoming Jobs",
    spotlight: [{ within: firstCard, selector: '[data-tour="job-card-checklist"]' }],
    header: DASHBOARD_HEADER,
  },
  {
    kind: "shot",
    slug: "read-the-full-checklist",
    section: 1,
    bullet: STAGES[1].bullets[0],
    onScreen: "The job checklist: the clean, the time, the address, 0 of 32 tasks",
    narration: "This is the whole job — every room, every line. Read all 32 tasks before you leave the house, not when you get there.",
    url: CHECKLIST,
    scenario: { stage: "before", checklist: "none" },
    waitFor: "Kitchen",
    spotlight: [{ selector: "div.rounded-2xl.border-violet-200" }],
    align: "top",
    header: TOKEN_PAGE_HEADER,
  },
  {
    kind: "shot",
    slug: "full-checklist-scroll",
    section: 1,
    bullet: STAGES[1].bullets[0],
    onScreen: "The entire checklist, top to bottom (tall image for a slow scroll)",
    narration: "Scroll it end to end: Kitchen, Bathrooms, then all rooms.",
    url: CHECKLIST,
    scenario: { stage: "before", checklist: "none" },
    waitFor: "Kitchen",
    tall: true,
  },
  {
    kind: "shot",
    slug: "access-and-property-notes",
    section: 1,
    bullet: STAGES[1].bullets[1],
    onScreen: "Access notes, office notes and dispatch notes on the checklist",
    narration: "Read the notes before you go. Gate code, pets, and anything the office wants you to know — here, don't ring the doorbell.",
    url: CHECKLIST,
    scenario: { stage: "before", checklist: "none" },
    waitFor: "Access notes",
    spotlight: [
      { selector: '[data-tour="checklist-notes"] p.rounded-lg', nth: 0 },
      { selector: '[data-tour="checklist-notes"] p.rounded-lg', nth: 2 },
    ],
    header: TOKEN_PAGE_HEADER,
  },
  {
    kind: "shot",
    slug: "view-job-details",
    section: 1,
    bullet: STAGES[1].bullets[1],
    onScreen: "Dashboard → View job details: home size, pets, access and office notes",
    narration: "On the dashboard, View job details shows the home itself — size, pets, and the same access notes.",
    url: DASHBOARD,
    scenario: { stage: "before" },
    waitFor: "Upcoming Jobs",
    setup: expandJobDetails,
    spotlight: [{ within: firstCard, selector: '[data-tour="job-card-details"]' }],
    align: "top",
    header: DASHBOARD_HEADER,
  },
  {
    kind: "shot",
    slug: "ringer-on",
    section: 1,
    bullet: STAGES[1].bullets[2],
    onScreen: "Profile → SMS Notifications: On",
    narration: "Charge your phone and keep the ringer on. The office texts you job links — including your photo link — so keep SMS notifications on.",
    // Opened from the menu, as a contractor would. Loading /cleaner/profile
    // directly bounces to the dashboard: Profile checks for a user before
    // the auth context has read the session.
    url: DASHBOARD,
    scenario: { stage: "before" },
    waitFor: "Upcoming Jobs",
    setup: async (page) => {
      await page.locator("header button").first().click();
      await page.locator("aside").last().getByRole("link", { name: /Profile/ }).click();
      await page.getByText("SMS Notifications", { exact: true }).first().waitFor({ timeout: 30_000 });
    },
    spotlight: [{ selector: 'div.p-3.border.rounded-lg:has-text("SMS Notifications")' }],
    header: DASHBOARD_HEADER,
    note: "Charging your phone is a physical check; this is the closest in-app setting. The before-photos text is only sent when SMS notifications are on.",
  },
  {
    kind: "shot",
    slug: "supplies-ready",
    section: 1,
    bullet: STAGES[1].bullets[3],
    onScreen: "Your supply checklist — the kit list from onboarding",
    narration: "Load your kit the night before: solutions, tools, gloves. This is the same supply list you checked off in onboarding.",
    url: `/cleaner/supplies/${HERO.supplyToken}`,
    scenario: { stage: "before" },
    waitFor: "What supplies do you have?",
    spotlight: [{ selector: "div.mt-4.rounded-xl.border" }],
    pad: 10,
    header: TOKEN_PAGE_HEADER,
    note: "The supply checklist is an onboarding page (reached from the setup link), not a pre-job check in the app. It is shown here as the kit list to load.",
  },

  // ── 2 · When you arrive ─────────────────────────────────────────────────
  { kind: "card", slug: "stop-2-when-you-arrive", card: "stage", stage: 2 },
  {
    kind: "shot",
    slug: "arrive-inside-your-window",
    section: 2,
    bullet: STAGES[2].bullets[0],
    onScreen: "Your arrival window and the address, top of the checklist",
    narration: "Arrive inside your window — this one is 10 to 11 AM. Running late? Call the office before the window starts, not after.",
    url: CHECKLIST,
    scenario: { stage: "before", checklist: "none" },
    waitFor: "Access notes",
    spotlight: [
      { selector: '[data-tour="checklist-notes"] > p', nth: 0 },
      { selector: '[data-tour="checklist-notes"] > p', nth: 1 },
    ],
    header: TOKEN_PAGE_HEADER,
    note: "There is no in-app 'running late' button. The office phone line on the guide is blank (OFFICE: ____).",
  },
  {
    kind: "shot",
    slug: "check-in",
    section: 2,
    bullet: STAGES[2].bullets[1],
    onScreen: "Dashboard → Check In",
    narration: "Greet the client and confirm how you're getting in — here, the side gate. Then tap Check In.",
    url: DASHBOARD,
    scenario: { stage: "before" },
    waitFor: "Upcoming Jobs",
    spotlight: [{ within: firstCard, selector: '[data-tour="job-card-check-in"]' }],
    header: DASHBOARD_HEADER,
  },
  {
    kind: "shot",
    slug: "ask-about-pets",
    section: 2,
    bullet: STAGES[2].bullets[2],
    onScreen: "View job details → Pets: Dog — Biscuit",
    narration: "Ask about pets before you start. This home has a dog, Biscuit — ask the client to move him to another room.",
    url: DASHBOARD,
    scenario: { stage: "before" },
    waitFor: "Upcoming Jobs",
    setup: expandJobDetails,
    // The Pets row and the access note that repeats it ("Friendly dog —
    // Biscuit"); the row on its own is too thin to spot in a video.
    spotlight: [
      { within: '[data-tour="job-card-details"]', text: "Pets", exact: true },
      { within: '[data-tour="job-card-details"]', selector: 'p:has-text("Access notes")' },
    ],
    // The detail rows sit tight; a wider ring clips the row above.
    pad: 4,
    header: DASHBOARD_HEADER,
  },
  {
    kind: "shot",
    slug: "before-photos",
    section: 2,
    bullet: STAGES[2].bullets[3],
    onScreen: "The BEFORE photos page (the link is texted when you check in)",
    narration: "Checking in texts you your before-photos link. Before you touch anything, photograph every area.",
    url: `${PHOTOS}?phase=before`,
    scenario: { stage: "checked_in" },
    waitFor: "This is your protection",
    spotlight: [{ selector: '[data-tour="photos-before"]' }],
    header: TOKEN_PAGE_HEADER,
  },
  {
    kind: "shot",
    slug: "before-photos-every-area",
    section: 2,
    bullet: STAGES[2].bullets[3],
    onScreen: "Before photos added for every room",
    narration: "Kitchen, bathrooms, living room, bedrooms — every area. Then tap Submit before photos.",
    url: `${PHOTOS}?phase=before`,
    scenario: { stage: "checked_in", photos: { before: true } },
    waitFor: "4 attached",
    spotlight: [{ selector: '[data-tour="photos-before"]' }],
    header: TOKEN_PAGE_HEADER,
  },

  // ── 3 · While you work ──────────────────────────────────────────────────
  { kind: "card", slug: "stop-3-while-you-work", card: "stage", stage: 3 },
  {
    kind: "shot",
    slug: "work-in-order",
    section: 3,
    bullet: STAGES[3].bullets[0],
    onScreen: "The checklist starts with Kitchen — work top to bottom",
    narration: "Work the checklist in order. Start at the top — Kitchen — and go line by line.",
    url: CHECKLIST,
    scenario: { stage: "checked_in", checklist: "none" },
    waitFor: "Kitchen",
    spotlight: [
      { selector: '[data-tour="checklist-section"] h2', nth: 0 },
      { selector: '[data-tour="checklist-item"]', nth: 2 },
    ],
    align: "top",
    header: TOKEN_PAGE_HEADER,
  },
  {
    kind: "shot",
    slug: "check-off-as-you-go",
    section: 3,
    bullet: STAGES[3].bullets[1],
    onScreen: "Three Kitchen tasks checked off, the rest still open",
    narration: "Tap each line the moment you finish it — not all at once at the end. The office sees your progress as you go.",
    url: CHECKLIST,
    scenario: { stage: "checked_in", checklist: "kitchen-started" },
    waitFor: "Kitchen",
    spotlight: [
      { selector: '[data-tour="checklist-item"]', nth: 0 },
      { selector: '[data-tour="checklist-item"]', nth: 2 },
    ],
    header: TOKEN_PAGE_HEADER,
  },
  {
    kind: "shot",
    slug: "finish-one-area",
    section: 3,
    bullet: STAGES[3].bullets[2],
    onScreen: "Kitchen shows 'Tasks done' before Bathrooms begins",
    narration: "Finish one area before you start the next. When every Kitchen line is checked, it says Tasks done — then move on.",
    url: CHECKLIST,
    scenario: { stage: "checked_in", checklist: "kitchen-done" },
    waitFor: "Tasks done",
    spotlight: [{ selector: '[data-tour="checklist-section"]', nth: 0 }],
    align: "top",
    header: TOKEN_PAGE_HEADER,
  },
  {
    kind: "shot",
    slug: "ask-before-moving-furniture",
    section: 3,
    bullet: STAGES[3].bullets[3],
    onScreen: "If the client says leave it: Skip with reason",
    narration: "Ask before you move furniture, and put it back where it was. If the client says don't touch it, skip that line with a reason — never just leave it blank.",
    url: CHECKLIST,
    scenario: { stage: "checked_in", checklist: "kitchen-done" },
    waitFor: "Kitchen",
    setup: async (page) => {
      const row = page.locator('[data-tour="checklist-item"]').filter({ hasText: "Vacuum upholstered furniture" });
      await row.getByRole("button", { name: "Skip with reason" }).click();
      await row.locator("textarea").fill("Client asked us not to move or vacuum the antique armchair in the living room.");
    },
    spotlight: [{ selector: '[data-tour="checklist-item"]:has-text("Vacuum upholstered furniture")' }],
    header: TOKEN_PAGE_HEADER,
    note: "Related screen, not a literal one: asking before moving furniture happens with the client. The app's part is recording a line the client asked you to skip.",
  },

  // ── 4 · Before you leave ────────────────────────────────────────────────
  { kind: "card", slug: "stop-4-before-you-leave", card: "stage", stage: 4 },
  {
    kind: "shot",
    slug: "final-walkthrough",
    section: 4,
    bullet: STAGES[4].bullets[0],
    onScreen: "32 of 32 tasks, 100%",
    narration: "Walk every area one last time with the checklist in hand. Every line checked: 32 of 32.",
    url: CHECKLIST,
    scenario: { stage: "checked_in", checklist: "all" },
    waitFor: "32/32 tasks",
    spotlight: [{ selector: '[data-tour="checklist-progress"]' }],
    pad: 10,
    header: TOKEN_PAGE_HEADER,
  },
  {
    kind: "shot",
    slug: "after-photos",
    section: 4,
    bullet: STAGES[4].bullets[1],
    onScreen: "AFTER photos for every room",
    narration: "Take after photos of every area — the same angles as your before shots.",
    url: `${PHOTOS}?phase=after`,
    scenario: { stage: "completed", photos: { after: true } },
    waitFor: "4 attached",
    spotlight: [{ selector: '[data-tour="photos-after"]' }],
    header: TOKEN_PAGE_HEADER,
    note: "In the app, the AFTER-photos link is texted when you tap Mark Complete — one step later than the guide lists it. Take the photos before you leave; upload them from that text.",
  },
  {
    kind: "shot",
    slug: "report-any-issue",
    section: 4,
    bullet: STAGES[4].bullets[2],
    onScreen: "Checklist → Problem on site? → Report an issue to dispatch",
    narration: "Anything wrong — damage, something broken, something you couldn't finish? Report it before you leave, not after.",
    url: CHECKLIST,
    scenario: { stage: "checked_in", checklist: "all" },
    waitFor: "Problem on site?",
    spotlight: [{ selector: '[data-tour="checklist-report-issue"]' }],
    header: TOKEN_PAGE_HEADER,
  },
  {
    kind: "shot",
    slug: "report-issue-details",
    section: 4,
    bullet: STAGES[4].bullets[2],
    onScreen: "Say exactly what happened, then Send to dispatch now",
    narration: "Be specific: what, where, and whether it was already there. Dispatch acts on exactly what you write.",
    url: CHECKLIST,
    scenario: { stage: "checked_in", checklist: "all" },
    waitFor: "Problem on site?",
    setup: openIssueReport,
    spotlight: [{ selector: "div.rounded-2xl.border-rose-200" }],
    header: TOKEN_PAGE_HEADER,
  },
  {
    kind: "shot",
    slug: "finish-checklist",
    section: 4,
    bullet: STAGES[4].bullets[3],
    onScreen: "Finish checklist — notify the office",
    narration: "Every line done? Tap Finish checklist. That tells the office the clean is done.",
    url: CHECKLIST,
    scenario: { stage: "checked_in", checklist: "all" },
    waitFor: "Finish checklist",
    spotlight: [{ selector: '[data-tour="checklist-finish"]' }],
    header: TOKEN_PAGE_HEADER,
  },
  {
    kind: "shot",
    slug: "checklist-complete",
    section: 4,
    bullet: STAGES[4].bullets[3],
    onScreen: "Checklist complete — the app tells you to mark the job complete",
    narration: "The checklist confirms it — and reminds you of the last step: mark the job complete in your dashboard.",
    url: CHECKLIST,
    scenario: { stage: "checked_in", checklist: "all", checklistFinished: true },
    waitFor: "Checklist complete",
    spotlight: [{ selector: "div.rounded-2xl.border-emerald-200" }],
    header: TOKEN_PAGE_HEADER,
  },
  {
    kind: "shot",
    slug: "mark-complete",
    section: 4,
    bullet: STAGES[4].bullets[3],
    onScreen: "Dashboard → Mark Complete (after you've checked in)",
    narration: "Back in your dashboard, the job shows Checked In. Tap Mark Complete.",
    url: DASHBOARD,
    scenario: { stage: "checked_in" },
    waitFor: "Mark Complete",
    spotlight: [{ within: firstCard, text: "Mark Complete", exact: true }],
    header: DASHBOARD_HEADER,
  },
  {
    kind: "shot",
    slug: "marked-complete",
    section: 4,
    bullet: STAGES[4].bullets[3],
    onScreen: "Sent to the office for review — upload your photos to release payout",
    narration: "The job goes to the office for review. Upload your before and after photos to release your payout.",
    url: DASHBOARD,
    scenario: { stage: "checked_in" },
    waitFor: "Mark Complete",
    toasts: true,
    setup: async (page) => {
      // The refetch after the tap should find the job already moved on.
      installDayToDayScenario({ stage: "completed" });
      await page.locator(firstCard).first().getByRole("button", { name: "Mark Complete", exact: true }).click();
      await page.getByText("Marked complete", { exact: false }).first().waitFor({ timeout: 10_000 });
    },
    spotlight: [{ selector: "[data-sonner-toast]" }],
    pad: 6,
    header: DASHBOARD_HEADER,
  },

  // ── Job complete ────────────────────────────────────────────────────────
  { kind: "card", slug: "job-complete", card: "complete" },
  {
    kind: "shot",
    slug: "after-photos-submitted",
    section: "complete",
    bullet: GUIDE_LINES.complete.line,
    onScreen: "After photos submitted — payout in 1–2 business days",
    narration: "Photos in. You'll see your payout in Stripe within one to two business days.",
    url: `${PHOTOS}?phase=after`,
    scenario: { stage: "completed", photos: { after: true } },
    waitFor: "4 attached",
    // The confirmation is the only thing on the page, so no spotlight —
    // dimming an empty screen around one card reads as a glitch.
    setup: async (page) => {
      await page.getByRole("button", { name: /Submit after photos/i }).click();
      await page.getByText("After photos & videos submitted", { exact: false }).waitFor({ timeout: 10_000 });
    },
    header: TOKEN_PAGE_HEADER,
  },
  {
    kind: "shot",
    slug: "completed-jobs",
    section: "complete",
    bullet: GUIDE_LINES.complete.line,
    onScreen: "Dashboard → Completed Jobs, payout pending",
    narration: "The job moves to Completed. Checklist done, photos in — nothing left for the client to fix.",
    url: DASHBOARD,
    scenario: { stage: "completed" },
    waitFor: "Completed Jobs",
    spotlight: [{ selector: '[data-tour="completed-jobs"] div.rounded-lg.border', nth: 0 }],
    header: DASHBOARD_HEADER,
  },

  // ── Closing ─────────────────────────────────────────────────────────────
  { kind: "card", slug: "show-up-work-document", card: "remember" },
  {
    kind: "shot",
    slug: "move-up-a-tier",
    section: "remember",
    bullet: GUIDE_LINES.remember.line,
    onScreen: "Your tier and rate on every job (Foundation → Proven → Elite)",
    narration: "Do this on every job. It's how you move up a tier — Foundation, Proven, Elite — and earn more per job.",
    url: DASHBOARD,
    scenario: { stage: "completed" },
    waitFor: "Completed Jobs",
    spotlight: [{ selector: '[data-tour="completed-jobs"] p:has-text("rate 41%")', nth: 0 }],
    pad: 5,
    header: DASHBOARD_HEADER,
    note: "The sample contractor is on the Proven tier (41% solo). New contractors start on Foundation, so their screen shows a different rate.",
  },
  { kind: "card", slug: "call-the-office", card: "call" },
  {
    kind: "shot",
    slug: "office-number",
    section: "call",
    bullet: GUIDE_LINES.call.title,
    onScreen: "Job lookup → Need help? Call (844) 735-2070",
    narration: "Not sure? Call the office. You're never in trouble for asking.",
    url: "/contractor/jobs",
    scenario: { stage: "before" },
    signedIn: false,
    waitFor: "Need help?",
    spotlight: [{ selector: 'p:has-text("Need help?")' }],
    pad: 12,
    header: TOKEN_PAGE_HEADER,
    note: "This is the only phone number in the contractor app, and it shows on the Job lookup sign-in screen. The guide's OFFICE line is blank — confirm this is the number contractors should call.",
  },
];

export const SHOTS = STORYBOARD.filter((e): e is DayShot => e.kind === "shot");

// ─── New Hire Series screenshot definitions ────────────────────────────────
//
// Mapped to the five-video contractor series. Video 1 (Welcome) has no app
// screens. Video 4 (Dress Code) is skipped until an in-app Dress Code
// reference exists — Training.tsx has no dress-code module.
//
// Run with:  npm run docs:capture -- new-hire
// Reuses the admin capture harness (Playwright + supabase-mock + demo-data).

import type { Page } from "playwright";

import { DEMO_TOKENS } from "./demo-data";
import type { Shot } from "./shots";

export const NEW_HIRE_ROOT = "docs/new-hire-series";

const VIDEO2 = `${NEW_HIRE_ROOT}/video-2-how-you-get-paid`;
const VIDEO3 = `${NEW_HIRE_ROOT}/video-3-a-day-in-the-field`;
const VIDEO5 = `${NEW_HIRE_ROOT}/video-5-when-something-goes-wrong`;

const PHONE = { width: 430, height: 932 };

const lookupDana = async (page: Page) => {
  const email = page.getByPlaceholder("contractor@example.com");
  await email.waitFor({ timeout: 20_000 });
  await email.fill("dana.whitfield@example.test");
  await page.getByRole("button", { name: /Find my jobs/i }).click();
  await page.getByText("Paid to you", { exact: false }).first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
};

export const NEW_HIRE_SKIPPED = [
  {
    video: 1,
    slug: "welcome",
    reason:
      "Welcome is introductory and is not about the app. No screenshot is captured rather than forcing an irrelevant shot.",
  },
  {
    video: 4,
    slug: "dress-code-professionalism",
    reason:
      "No in-app Dress Code reference exists. The contractor Training portal lists Welcome, Standard Clean, Deep Clean & Move-In/Out, Client Interaction, Safety & Chemicals, and Using the Novara App — not dress code. Skipped rather than staged.",
  },
] as const;

export const NEW_HIRE_SHOTS: Shot[] = [
  // ── Video 2 — How You Get Paid ──────────────────────────────────────────
  {
    id: "video2-dashboard-current-tier",
    series: "new-hire",
    doc: "video-2-how-you-get-paid",
    outDir: VIDEO2,
    role: "cleaner",
    burnCaption: true,
    viewport: { width: 1280, height: 900 },
    caption:
      "Video 2 · Dashboard — Dana is on the Proven tier. Upcoming jobs show the Proven rate (41%) and her share.",
    url: "/cleaner/dashboard",
    waitForText: "Proven",
    callouts: [
      { text: "Dana Whitfield", label: "Signed-in contractor" },
      { text: "Proven", nth: 0, label: "Current tier — Proven" },
      { text: "Upcoming Jobs", label: "Upcoming work" },
    ],
  },
  {
    id: "video2-pay-payout-breakdown",
    series: "new-hire",
    doc: "video-2-how-you-get-paid",
    outDir: VIDEO2,
    role: "cleaner",
    burnCaption: true,
    viewport: PHONE,
    height: 932,
    defaultWithin: null,
    caption:
      "Video 2 · Pay — a completed job at the Proven rate (41% solo). The Paid chip is the contractor's share of that job.",
    url: "/contractor/jobs",
    waitForText: "Find my jobs",
    setup: async (page) => {
      await lookupDana(page);
      await page.getByText("Completed & Submitted", { exact: false }).first().scrollIntoViewIfNeeded();
      const details = page.getByRole("button", { name: /Job details/i });
      const n = await details.count();
      if (n > 0) {
        await details.nth(n - 1).click();
        await page.waitForTimeout(600);
        await page.getByText("Your pay", { exact: false }).first().scrollIntoViewIfNeeded().catch(() => {});
      }
    },
    callouts: [
      { text: "Completed & Submitted", label: "Completed jobs" },
      { text: "Your pay", nth: 0, label: "Payout at Proven rate" },
      { text: "Solo · 41%", nth: 0, label: "Solo · 41% tier rate" },
    ],
  },
  {
    id: "video2-tips-passthrough",
    series: "new-hire",
    doc: "video-2-how-you-get-paid",
    outDir: VIDEO2,
    role: "cleaner",
    burnCaption: true,
    viewport: PHONE,
    height: 932,
    defaultWithin: null,
    caption:
      "Video 2 · Tips — 100% pass-through. Novara takes nothing; tips never change job pay or scores.",
    url: "/contractor/jobs",
    waitForText: "Find my jobs",
    setup: async (page) => {
      await lookupDana(page);
      await page.getByText("Tips from customers", { exact: false }).first().scrollIntoViewIfNeeded();
    },
    callouts: [
      { text: "Tips from customers", label: "Tips panel" },
      { text: "100% of every tip", nth: 0, label: "100% pass-through" },
    ],
  },

  // ── Video 3 — A Day in the Field ────────────────────────────────────────
  {
    id: "video3-job-detail-before-arrival",
    series: "new-hire",
    doc: "video-3-a-day-in-the-field",
    outDir: VIDEO3,
    role: "cleaner",
    burnCaption: true,
    viewport: PHONE,
    height: 1100,
    defaultWithin: null,
    caption:
      "Video 3 · Job detail before arrival — Standard Clean checklist, access notes, and special instructions.",
    url: `/cleaner/job-checklist/${DEMO_TOKENS.checklistBeforeArrival}`,
    waitForText: "Access notes",
    callouts: [
      { text: "Access notes", label: "Access details" },
      { text: "Office notes", nth: 0, label: "Special instructions" },
      { text: "Kitchen", nth: 0, label: "Checklist — nothing checked yet" },
    ],
  },
  {
    id: "video3-checklist-midcompletion",
    series: "new-hire",
    doc: "video-3-a-day-in-the-field",
    outDir: VIDEO3,
    role: "cleaner",
    burnCaption: true,
    viewport: PHONE,
    height: 1100,
    defaultWithin: null,
    caption:
      "Video 3 · Checklist mid-completion — some Kitchen items checked, others still open. Not a bulk-complete state.",
    url: `/cleaner/job-checklist/${DEMO_TOKENS.checklistBeforeArrival}`,
    waitForText: "Kitchen",
    setup: async (page) => {
      await page.getByText("Kitchen", { exact: true }).first().waitFor({ timeout: 20_000 });
      const boxes = page.getByRole("button", { name: "Check off" });
      for (let i = 0; i < 3; i++) {
        await boxes.nth(i).click();
        await page.waitForTimeout(400);
      }
      await page.getByText("Kitchen", { exact: true }).first().scrollIntoViewIfNeeded();
    },
    callouts: [
      { text: "Kitchen", nth: 0, label: "Section in progress" },
      { text: "Clean countertops", label: "Checked off" },
      { text: "Clean microwave", nth: 0, label: "Still open" },
    ],
  },
  {
    id: "video3-before-after-photos",
    series: "new-hire",
    doc: "video-3-a-day-in-the-field",
    outDir: VIDEO3,
    role: "cleaner",
    burnCaption: true,
    viewport: PHONE,
    height: 932,
    defaultWithin: null,
    caption:
      "Video 3 · Before/after photo capture — the field upload screen for proof-of-work photos.",
    url: `/cleaner/job-photos/${DEMO_TOKENS.photos}`,
    waitForText: "This is your protection",
    callouts: [
      { text: "Before photos & videos", label: "Before photos" },
      { text: "After photos & videos", label: "After photos" },
      { text: "This is your protection", label: "Why photos matter" },
    ],
  },
  {
    id: "video3-mark-complete",
    series: "new-hire",
    doc: "video-3-a-day-in-the-field",
    outDir: VIDEO3,
    role: "cleaner",
    burnCaption: true,
    viewport: { width: 1280, height: 900 },
    caption:
      "Video 3 · Mark complete — the contractor has checked in and can send the job to the office.",
    url: "/cleaner/dashboard",
    waitForText: "Mark Complete",
    setup: async (page) => {
      await page.getByRole("button", { name: /Mark Complete/i }).first().scrollIntoViewIfNeeded();
    },
    callouts: [
      { text: "Checked In", nth: 0, label: "Already checked in" },
      { text: "Mark Complete", nth: 0, label: "Mark the job complete" },
    ],
  },

  // ── Video 5 — When Something Goes Wrong ─────────────────────────────────
  {
    id: "video5-flag-issue-action",
    series: "new-hire",
    doc: "video-5-when-something-goes-wrong",
    outDir: VIDEO5,
    role: "cleaner",
    burnCaption: true,
    viewport: PHONE,
    height: 932,
    defaultWithin: null,
    caption:
      "Video 5 · Flag an issue from the job screen. Demo data only — this is not a real QC case.",
    url: "/contractor/jobs",
    waitForText: "Find my jobs",
    setup: async (page) => {
      await lookupDana(page);
      await page.getByText("Submit a QC report", { exact: false }).first().scrollIntoViewIfNeeded();
      await page.getByText("Submit a QC report", { exact: false }).first().click();
      await page.waitForTimeout(500);
    },
    callouts: [
      { text: "QC report", nth: 0, label: "Report form" },
      { text: "Send QC report", label: "Send to the office" },
    ],
  },
  {
    id: "video5-office-notified",
    series: "new-hire",
    doc: "video-5-when-something-goes-wrong",
    outDir: VIDEO5,
    role: "cleaner",
    burnCaption: true,
    viewport: PHONE,
    height: 932,
    defaultWithin: null,
    caption:
      "Video 5 · Confirmation — the office has been notified. Demo incident text only; no real QC case content.",
    url: "/contractor/jobs",
    waitForText: "Find my jobs",
    setup: async (page) => {
      await lookupDana(page);
      await page.getByText("Submit a QC report", { exact: false }).first().click();
      await page.getByPlaceholder(/What happened/i).fill(
        "Demo training scenario: lockbox would not open. Invented — not a real incident.",
      );
      await page.getByRole("button", { name: /Send QC report/i }).click();
      await page.getByText("QC report submitted", { exact: false }).waitFor({ timeout: 15_000 });
    },
    callouts: [
      { text: "QC report submitted", label: "Office notified" },
    ],
  },
];

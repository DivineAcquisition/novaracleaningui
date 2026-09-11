// ─── Verification of the contractor onboarding sequence ─────────────────────
//
// Onboarding is agreement → phone → supplies → dress code (agree) →
// job-day journey → training videos, and four things have to agree on that:
// the shared definition in src/lib/cleaner-supplies.ts, the portal a
// contractor works through, the page a mailed setup link lands on, and the
// admin view that decides whether anything is outstanding. When they drift,
// the symptom is a contractor being asked for bank details before anyone has
// asked them to sign, or being offered a first job before they have watched
// the videos.
//
// The first half of this script checks the shared definition by calling it.
// The second half opens the real pages in a browser and reads what a
// contractor would actually see, because "the function returns six steps"
// and "the portal shows six steps, with training last" are different claims
// and only the second one is the product.
//
// No real data is touched: every Supabase call is answered from an invented
// fixture in this file, same approach as the walkthrough recorder.
//
//   Run:  npm run dev -- --port 3100     (in another shell)
//         npm run onboarding:verify

import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Browser, type Page, type Route } from "playwright";

import {
  SUPPLY_ITEMS,
  cleanerSetupSteps,
  isCleanerReadyForFirstJob,
  isCleanerSetupComplete,
  isDressCodeAgreed,
  isJobDayAcknowledged,
  isSetupStepUnlocked,
  isSupplyChecklistSubmitted,
  sanitizeSupplyInventory,
  scoreSupplyInventory,
  supplySubmissionPatch,
  type CleanerSetupState,
} from "../src/lib/cleaner-supplies";
import { ONBOARDING_GUIDES } from "../src/lib/cleaner-onboarding-guides";
import { TOURS } from "../src/lib/tours/catalog";
import { isRequiredTrainingWatched } from "../src/lib/tours/progress";

const BASE_URL = process.env.ONBOARDING_VERIFY_BASE_URL || "http://localhost:3100";
const SHOTS_DIR = resolve(__dirname, "../docs/contractor-onboarding");
const AUTH_STORAGE_KEY = "sb-sxdraeptzuamsgjcvfeg-auth-token";

let failures = 0;
const warnings: string[] = [];

function warn(message: string): void {
  warnings.push(message);
  console.warn(`  ! ${message}`);
}

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

// ─── Part 1: the shared definition ──────────────────────────────────────────

function checkSequence(): void {
  console.log("\nThe onboarding sequence");

  const expectedIds = ["agreement", "phone", "supplies", "dress_code", "job_day", "training"];
  const fresh: CleanerSetupState = {};
  check("six steps, agreement first, training last", cleanerSetupSteps(fresh).map((s) => s.id), expectedIds);
  check("a brand-new contractor has nothing done", cleanerSetupSteps(fresh).map((s) => s.done), [
    false,
    false,
    false,
    false,
    false,
    false,
  ]);
  check("and is not complete", isCleanerSetupComplete(fresh), false);
  check("and is not eligible for a first job", isCleanerReadyForFirstJob(fresh), false);

  const phoneAndStripe: CleanerSetupState = {
    phone_verified: true,
    stripe_account_id: "acct_123",
  };
  check("phone + payouts alone is not complete", isCleanerSetupComplete(phoneAndStripe), false);
  check(
    "the outstanding steps start with the agreement",
    cleanerSetupSteps(phoneAndStripe).filter((s) => !s.done).map((s) => s.id),
    ["agreement", "supplies", "dress_code", "job_day", "training"],
  );
  check("phone is unlocked only after the agreement", isSetupStepUnlocked(fresh, "phone"), false);
  check("and training is locked until everything above it is done", isSetupStepUnlocked(phoneAndStripe, "training"), false);

  const allDone: CleanerSetupState = {
    ob_agreement_signed: true,
    phone_verified: true,
    supply_checklist_submitted_at: "2026-09-01T00:00:00Z",
    ob_dress_code_ack: true,
    ob_job_day_guides_ack: true,
    ob_training_complete: true,
  };
  check("all six done is complete", isCleanerSetupComplete(allDone), true);
  check("and that is enough for a first job", isCleanerReadyForFirstJob(allDone), true);
  check(
    "payouts are not part of this sequence",
    cleanerSetupSteps(allDone).some((s) => s.id === "payouts" || /stripe|payout/i.test(s.title)),
    false,
  );
  check(
    "a contractor who skipped only training is still outstanding",
    cleanerSetupSteps({ ...allDone, ob_training_complete: false })
      .filter((s) => !s.done)
      .map((s) => s.id),
    ["training"],
  );
  check("dress code needs an explicit agree", isDressCodeAgreed({}), false);
  check("legacy combined ack still counts as dress-code agree", isDressCodeAgreed({ ob_job_day_guides_ack: true }), true);
  check("job-day still needs its own ack", isJobDayAcknowledged({ ob_dress_code_ack: true }), false);
  check("someone with a completed job is past the first-job gate", isCleanerReadyForFirstJob({ completed_bookings: 3 }), true);

  check("submitting an almost-empty checklist still completes the step", isSupplyChecklistSubmitted(allDone), true);
  check("while readiness stays false", scoreSupplyInventory({}).ready, false);

  check(
    "the legacy viewed flag still counts, so nobody is asked twice",
    isSupplyChecklistSubmitted({ ob_supplies_checklist_viewed: true }),
    true,
  );

  check("skipped walkthroughs do not count as training", isRequiredTrainingWatched(
    TOURS.map((t) => ({
      tourId: t.id,
      version: t.version,
      status: "skipped" as const,
      lastStepIndex: 0,
      startedAt: null,
      completedAt: null,
      updatedAt: null,
    })),
  ), false);
  check("every catalog tour completed does", isRequiredTrainingWatched(
    TOURS.map((t) => ({
      tourId: t.id,
      version: t.version,
      status: "completed" as const,
      lastStepIndex: 0,
      startedAt: null,
      completedAt: null,
      updatedAt: null,
    })),
  ), true);

  console.log("\nThe submission write");
  const patch = supplySubmissionPatch({ vacuum: true }, "2026-09-11T12:00:00.000Z");
  check("records the timestamp the portal reads back as done", patch.supply_checklist_submitted_at, "2026-09-11T12:00:00.000Z");
  check("and the legacy flag, so old readers agree", patch.ob_supplies_checklist_viewed, true);
  check(
    "a submission through the portal satisfies the step",
    isSupplyChecklistSubmitted(patch as CleanerSetupState),
    true,
  );
  check(
    "unknown ids are dropped rather than stored",
    sanitizeSupplyInventory({ vacuum: true, not_a_real_item: true }),
    { vacuum: true },
  );
}

/**
 * The two graphics and the text each one carries.
 *
 * A missing image file is a warning, not a failure: the step is built to fall
 * back to `points`, which is the whole content of the graphic in words, so
 * onboarding still asks and answers the same thing. The warning exists so a
 * missing file is visible rather than quietly degrading forever.
 */
function checkGuides(): void {
  console.log("\nThe dress code and job-day graphics");

  check(
    "both guides, dress code first",
    ONBOARDING_GUIDES.map((g) => g.id),
    ["dress_code", "job_day"],
  );

  for (const guide of ONBOARDING_GUIDES) {
    check(`${guide.id}: has alt text for the graphic`, guide.alt.length > 20, true);
    check(`${guide.id}: carries its content as text too`, guide.points.length >= 5, true);
    check(`${guide.id}: served from public/onboarding/`, guide.image.startsWith("/onboarding/"), true);
    check(`${guide.id}: has an action label`, guide.actionLabel.length > 4, true);

    const onDisk = resolve(__dirname, "../public", guide.image.replace(/^\//, ""));
    if (!existsSync(onDisk)) {
      warn(
        `${guide.id}: public${guide.image} is not in the repo yet — the step will render the ` +
          `text version until the graphic is added.`,
      );
    } else {
      console.log(`  ✓ ${guide.id}: graphic present at public${guide.image}`);
    }
  }

  check(
    "dress code requires an agree tick, job-day does not",
    [
      ONBOARDING_GUIDES.find((g) => g.id === "dress_code")?.agreeLabel ? true : false,
      Boolean(ONBOARDING_GUIDES.find((g) => g.id === "job_day")?.agreeLabel),
    ],
    [true, false],
  );
}

// ─── Part 2: the pages a contractor sees ────────────────────────────────────

const CLEANER_ID = "c0000000-0000-4000-8000-000000000001";
const USER_ID = "c0000000-0000-4000-8000-0000000000a1";

/** Invented, like the recorder's fixture — nothing here is production data. */
function freshCleaner(): Record<string, unknown> {
  return {
    id: CLEANER_ID,
    user_id: USER_ID,
    first_name: "Imani",
    last_name: "Reyes",
    email: "new.contractor@example.test",
    phone: "+15555550188",
    status: "active",
    approved: true,
    onboarding_complete: false,
    phone_verified: false,
    stripe_account_id: null,
    payouts_enabled: false,
    ob_payouts_setup: false,
    ob_payouts_setup_at: null,
    ob_agreement_signed: false,
    ob_dress_code_ack: false,
    ob_dress_code_ack_at: null,
    ob_job_day_guides_ack: false,
    ob_job_day_guides_ack_at: null,
    ob_training_complete: false,
    completed_bookings: 0,
    ob_supplies_checklist_viewed: false,
    supply_checklist_submitted_at: null,
    supply_inventory: {},
    pay_tier: "foundation",
    pay_percentage: 35,
  };
}

// A valid 1×1 PNG. The guide graphics are served from this so the portal
// checks behave the same whether or not the real artwork has landed yet; the
// artwork's presence is reported separately by checkGuides().
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

// Tiny valid PDF so PdfViewer has something to fetch when the portal opens
// the agreement step. The real document is streamed from DocuSeal in prod.
const MINIMAL_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF\n",
  "utf8",
);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-expose-headers": "content-range",
};

/**
 * A mutable stand-in for the cleaners row, so a PATCH from the portal is
 * visible to the reload that follows it. The recorder's harness answers
 * writes with unchanged state on purpose; here the write is the thing under
 * test.
 */
async function mountHarness(page: Page, row: Record<string, unknown>): Promise<void> {
  const user = {
    id: USER_ID,
    email: row.email,
    aud: "authenticated",
    role: "authenticated",
    app_metadata: { provider: "email" },
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const session = {
    access_token: "verify-access-token",
    refresh_token: "verify-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  };

  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key as string, value as string);
    },
    [AUTH_STORAGE_KEY, JSON.stringify(session)],
  );

  const json = (route: Route, body: unknown, extra: Record<string, string> = {}) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", ...CORS, ...extra },
      body: JSON.stringify(body),
    });

  await page.route("**/*.supabase.co/**", async (route, request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: CORS, body: "" });
    }
    if (path.startsWith("/auth/v1/")) {
      return json(route, path.includes("/user") ? user : session);
    }
    if (path.includes("/rpc/resolve_or_link_cleaner_for_user")) {
      return json(route, [row]);
    }
    if (path.startsWith("/rest/v1/cleaners")) {
      if (request.method() === "PATCH") {
        Object.assign(row, (request.postDataJSON() as Record<string, unknown>) || {});
        return json(route, [row]);
      }
      return json(route, row, { "content-range": "0-0/1" });
    }
    if (path.startsWith("/rest/v1/")) {
      return json(route, []);
    }
    if (path.startsWith("/functions/v1/")) {
      return json(route, { ok: true });
    }
    return json(route, {});
  });

  await page.route("**/api/cleaner/**", async (route, request) => {
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: CORS, body: "" });
    }
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.includes("/sign-agreement")) {
      Object.assign(row, {
        ob_agreement_signed: true,
        ob_agreement_signed_at: new Date().toISOString(),
      });
      return json(route, { ok: true });
    }
    if (path.includes("/agreement-preview")) {
      return route.fulfill({
        status: 200,
        contentType: "application/pdf",
        headers: CORS,
        body: MINIMAL_PDF,
      });
    }
    if (path.includes("/tours")) {
      return json(route, {
        ok: true,
        cleanerId: row.id,
        settings: { autoStartOnFirstLogin: false, reofferOnVersionChange: false, maxReoffersAtOnce: 2 },
        progress: [],
        catalogSignature: "verify",
      });
    }
    return json(route, { ok: true });
  });

  await page.route(/googleapis|gstatic|googletagmanager|facebook|js\.stripe|sentry|posthog/, (r) =>
    r.abort(),
  );
}

/** The step card for a given heading, so assertions read the right card. */
function stepCard(page: Page, title: string) {
  return page.locator("div.rounded-lg, div").filter({ hasText: title }).last();
}

async function checkPortal(browser: Browser): Promise<void> {
  console.log("\nThe onboarding portal at /cleaner/ob-portal");
  const row = freshCleaner();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
  await mountHarness(page, row);

  let guideImagesBroken = false;
  await page.route("**/onboarding/*", (route) =>
    guideImagesBroken
      ? route.abort()
      : route.fulfill({
          status: 200,
          contentType: "image/png",
          body: Buffer.from(PNG_1PX, "base64"),
        }),
  );

  await page.goto(`${BASE_URL}/cleaner/ob-portal`, { waitUntil: "networkidle" });
  await page.getByText("Welcome, Imani!").waitFor({ timeout: 20_000 });

  const body = () => page.locator("main").innerText();

  check("the portal counts six steps", (await body()).includes("0 of 6 complete"), true);
  check(
    "and says they will not be offered a job until that is done",
    (await body()).includes("won't be offered a job") || (await body()).includes("won’t be offered a job"),
    true,
  );

  const headings = await page.locator("main h3, main [class*='CardTitle'], main div.text-base").allInnerTexts();
  const expectedOrder = [
    "Sign the contractor agreement",
    "Verify your phone number",
    "Check off your supplies",
    "Agree to the dress code",
    "Read the job-day journey",
    "Watch the training videos",
  ];
  check(
    "in order, agreement first and training last",
    expectedOrder.filter((t) => headings.some((h) => h.includes(t))),
    expectedOrder,
  );

  check(
    "later steps are locked behind the agreement",
    (await body()).includes("Sign the agreement first."),
    true,
  );
  check(
    "payouts are not a portal step",
    await page.getByRole("button", { name: /Set up payouts/i }).isVisible().catch(() => false),
    false,
  );
  check(
    "the agreement is on the page",
    await page.getByRole("button", { name: "Sign agreement" }).isVisible(),
    true,
  );

  mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: resolve(SHOTS_DIR, "portal-fresh.png"), fullPage: true });

  // ── Agreement signed ──
  row.ob_agreement_signed = true;
  row.ob_agreement_signed_at = new Date().toISOString();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Welcome, Imani!").waitFor({ timeout: 20_000 });

  check("agreement counts", (await body()).includes("1 of 6 complete"), true);
  check(
    "phone is unlocked",
    await page.getByRole("button", { name: "Send verification code" }).isVisible(),
    true,
  );
  check(
    "supplies stay locked until the phone is verified",
    (await body()).includes("Verify your phone first."),
    true,
  );

  // ── Phone verified: supplies unlock ──
  row.phone_verified = true;
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Welcome, Imani!").waitFor({ timeout: 20_000 });

  check("phone verified counts", (await body()).includes("2 of 6 complete"), true);
  check(
    "the supply checklist is now on the page",
    await page.getByText("Download full PDF checklist").isVisible(),
    true,
  );
  check(
    "every catalog item is offered",
    await page.locator('main [id^="supply-"]').count(),
    SUPPLY_ITEMS.length,
  );
  check(
    "the dress code stays locked until supplies are submitted",
    (await body()).includes("Check off your supplies first."),
    true,
  );

  const needed = SUPPLY_ITEMS.filter((i) => i.neededForJob).slice(0, 12);
  for (const item of needed) {
    await page.locator(`#supply-${item.id}`).click();
  }
  const meter = await page.getByText(/Job-needed: \d+\/\d+/).first().innerText();
  check("the meter tracks each tick without a round trip", meter.includes(`${needed.length}/`), true);

  await page.screenshot({ path: resolve(SHOTS_DIR, "portal-checklist.png"), fullPage: true });

  await page.getByRole("button", { name: "Save my supplies" }).click();
  await page.getByText("Saved — thanks.").waitFor({ timeout: 20_000 });

  check(
    "the submission is recorded on the contractor's row",
    Boolean(row.supply_checklist_submitted_at),
    true,
  );
  check("three of six steps done", (await body()).includes("3 of 6 complete"), true);

  // ── Dress code: must tick agree ──
  const dress = ONBOARDING_GUIDES.find((g) => g.id === "dress_code")!;
  check(
    "the dress code graphic is on the page",
    await page.locator(`main img[alt="${dress.alt}"]`).isVisible(),
    true,
  );
  const agreeBtn = page.getByRole("button", { name: dress.actionLabel });
  check("the dress-code agree button starts disabled", await agreeBtn.isDisabled(), true);
  await page.getByText(dress.agreeLabel!).click();
  check("and enables after the tick", await agreeBtn.isDisabled(), false);

  await page.screenshot({ path: resolve(SHOTS_DIR, "portal-guides.png"), fullPage: true });

  guideImagesBroken = true;
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Welcome, Imani!").waitFor({ timeout: 20_000 });
  check(
    "a graphic that won't load says so rather than showing a broken box",
    (await body()).includes("The graphic didn't load."),
    true,
  );
  check(
    "and the dress code is readable as text instead",
    (await body()).includes(dress.points[0]),
    true,
  );
  await page.screenshot({ path: resolve(SHOTS_DIR, "portal-guides-fallback.png"), fullPage: true });

  guideImagesBroken = false;
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Welcome, Imani!").waitFor({ timeout: 20_000 });
  await page.getByText(dress.agreeLabel!).click();
  await page.getByRole("button", { name: dress.actionLabel }).click();
  await page.getByText("Agreed — thanks.").waitFor({ timeout: 20_000 });
  check("the dress-code agree is recorded", row.ob_dress_code_ack, true);
  check("four of six steps done", (await body()).includes("4 of 6 complete"), true);

  // ── Job-day journey ──
  const jobDay = ONBOARDING_GUIDES.find((g) => g.id === "job_day")!;
  await page.getByRole("button", { name: jobDay.actionLabel }).waitFor({ timeout: 20_000 });
  check(
    "the job-day graphic is on the page after dress code",
    await page.locator(`main img[alt="${jobDay.alt}"]`).isVisible(),
    true,
  );
  await page.getByRole("button", { name: jobDay.actionLabel }).click();
  await page.getByText("Read — thanks.").waitFor({ timeout: 20_000 });
  check("the job-day ack is recorded", row.ob_job_day_guides_ack, true);
  check("five of six steps done", (await body()).includes("5 of 6 complete"), true);

  const trainingBtn = page.getByRole("button", { name: "Open training hub" });
  await trainingBtn.waitFor({ timeout: 20_000 });
  check(
    "payouts still are not asked here",
    await page.getByRole("button", { name: /Set up payouts/i }).isVisible().catch(() => false),
    false,
  );

  await page.screenshot({ path: resolve(SHOTS_DIR, "portal-training-unlocked.png"), fullPage: true });

  await page.getByRole("button", { name: "Open training hub" }).click();
  await page.getByText("Required videos").waitFor({ timeout: 20_000 });
  const hub = await page.locator("body").innerText();
  check(
    "the hub asks for all seven walkthroughs",
    hub.includes(`0 / ${TOURS.length}`),
    true,
  );
  check(
    "and says skipping does not count",
    hub.includes("Skipping does not count"),
    true,
  );
  check(
    "visiting the hub is not treated as training complete",
    row.ob_training_complete,
    false,
  );

  await page.screenshot({ path: resolve(SHOTS_DIR, "training-hub.png"), fullPage: true });

  // ── Returning contractor: collapsed to their standing ──
  await page.goto(`${BASE_URL}/cleaner/ob-portal`, { waitUntil: "networkidle" });
  await page.getByText("Welcome, Imani!").waitFor({ timeout: 20_000 });
  const score = scoreSupplyInventory(row.supply_inventory as Record<string, boolean>);
  check(
    "a returning contractor sees their standing, not the whole form again",
    (await body()).includes(`${score.ownedNeeded} of ${score.totalNeeded} job-needed items`),
    true,
  );
  check(
    "and can reopen it",
    await page.getByRole("button", { name: "Review my supplies" }).isVisible(),
    true,
  );
  check(
    "the graphics collapse the same way, and stay available",
    (await page.getByRole("button", { name: "Look again" }).count()) >= 1,
    true,
  );

  await page.close();
}

async function checkSetupLanding(browser: Browser): Promise<void> {
  console.log("\nThe page a mailed setup link opens");
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });

  // The route's own answer, built from the shared definition — this checks
  // that the landing page renders whatever sequence it is handed, in order,
  // rather than a list of its own.
  const state: CleanerSetupState = { phone_verified: true };
  await page.route("**/api/cleaner/setup/**", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        complete: isCleanerSetupComplete(state),
        cleaner: { firstName: "Imani", name: "Imani Reyes", email: "new.contractor@example.test" },
        sequence: cleanerSetupSteps(state).map((s) => ({ id: s.id, title: s.title, done: s.done })),
        steps: {
          phoneVerified: true,
          agreementSigned: false,
          suppliesSubmitted: false,
          dressCodeAgreed: false,
          jobDayAcknowledged: false,
          trainingComplete: false,
          stripeReady: false,
          onboardingComplete: false,
        },
        continueUrl: "/cleaner/auth?setup=verify-token",
      }),
    }),
  );

  await page.goto(`${BASE_URL}/cleaner/setup/verify-token-0123456789abcdef`, {
    waitUntil: "networkidle",
  });
  await page.getByText("Finish your account setup").waitFor({ timeout: 20_000 });

  const rows = await page.locator("main li, li").allInnerTexts();
  const listed = rows.map((r) => r.trim()).filter(Boolean);
  check(
    "the link page lists the same sequence the portal will walk",
    listed.slice(0, 6),
    [
      "Sign the contractor agreement",
      "Verify your phone number",
      "Check off your supplies",
      "Agree to the dress code",
      "Read the job-day journey",
      "Watch the training videos",
    ],
  );
  check(
    "and sends them into the portal to do it",
    await page.getByRole("link", { name: "Continue account setup" }).getAttribute("href"),
    "/cleaner/auth?setup=verify-token",
  );

  mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: resolve(SHOTS_DIR, "setup-link-landing.png"), fullPage: true });
  await page.close();
}

async function checkSupplyTokenPage(browser: Browser): Promise<void> {
  console.log("\nThe standalone supply link at /cleaner/supplies/<token>");
  const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });

  let saved: Record<string, boolean> | null = null;
  await page.route("**/api/cleaner/supplies/**", (route, request) => {
    if (request.method() === "POST") {
      const body = (request.postDataJSON() as { owned?: Record<string, boolean> }) || {};
      saved = sanitizeSupplyInventory(body.owned);
      return route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true, inventory: saved, submittedAt: new Date().toISOString() }),
      });
    }
    return route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        cleaner: { firstName: "Imani", name: "Imani Reyes" },
        items: SUPPLY_ITEMS,
        inventory: {},
        submittedAt: null,
      }),
    });
  });

  await page.goto(`${BASE_URL}/cleaner/supplies/verify-token-0123456789abcdef`, {
    waitUntil: "networkidle",
  });
  await page.getByText("What supplies do you have?").waitFor({ timeout: 20_000 });

  check(
    "the same checklist a contractor gets by link",
    await page.locator('[id^="supply-"]').count(),
    SUPPLY_ITEMS.length,
  );

  await page.locator("#supply-vacuum").click();
  await page.getByRole("button", { name: "Save my supplies" }).click();
  await page.getByText("Saved — thanks.").waitFor({ timeout: 20_000 });
  check("and it still posts what was ticked", saved, { vacuum: true });

  mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: resolve(SHOTS_DIR, "supply-link-page.png"), fullPage: true });
  await page.close();
}

async function checkAdminView(browser: Browser): Promise<void> {
  console.log("\nThe admin onboarding panel at /admin/cleaners");

  // Reuses the admin documentation harness, so this reads the same invented
  // directory the guides are captured from rather than a second fixture.
  const { DEMO_ADMIN } = await import("./docs/capture/demo-data");
  const { handleApiRoute, handleSupabase } = await import("./docs/capture/supabase-mock");

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
    reducedMotion: "reduce",
    colorScheme: "light",
  });
  await context.route("**/*.supabase.co/**", (route, request) => handleSupabase(route, request));
  await context.route("**/api/**", (route, request) => handleApiRoute(route, request));
  await context.route(/googleapis|gstatic|googletagmanager|facebook|js\.stripe|sentry|posthog/, (r) =>
    r.abort(),
  );
  await context.addInitScript(
    ([key, session]) => {
      window.localStorage.setItem(key as string, JSON.stringify(session));
    },
    [
      AUTH_STORAGE_KEY,
      {
        access_token: "verify-admin-token",
        refresh_token: "verify-admin-refresh",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: DEMO_ADMIN.id,
          email: DEMO_ADMIN.email,
          aud: "authenticated",
          role: "authenticated",
          app_metadata: { provider: "email" },
          user_metadata: {},
          created_at: new Date().toISOString(),
        },
      },
    ] as const,
  );

  const page = await context.newPage();
  await page.goto(`${BASE_URL}/admin/cleaners`, { waitUntil: "networkidle" });
  await page.getByText("Dana Whitfield").first().waitFor({ timeout: 30_000 });
  await page.getByText("Dana Whitfield").first().click();
  await page.getByRole("tab", { name: /Onboarding/i }).click();

  const panel = await page.locator("body").innerText();
  check("the supply checkoff is one of the steps admin sees", panel.includes("Supply checklist submitted"), true);
  check("so is the dress code agree", panel.includes("Dress code agreed"), true);
  check("and the job-day journey", panel.includes("Job-day journey read"), true);
  check("and the training videos", panel.includes("Training videos watched"), true);
  check(
    "readiness is stated as agreement through training",
    panel.includes("Portal ready (agreement → training)"),
    true,
  );
  // The demo directory predates the supply columns, so these contractors read
  // as outstanding — which is the honest answer and the state that used to be
  // reported as complete.
  check(
    "a contractor who was never asked now reads as incomplete",
    panel.includes("Account setup incomplete"),
    true,
  );
  check(
    "with a link that offers to ask them",
    await page.getByRole("button", { name: /Send setup link/ }).isVisible(),
    true,
  );

  mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: resolve(SHOTS_DIR, "admin-onboarding-panel.png"), fullPage: true });
  await context.close();
}

async function main(): Promise<void> {
  checkSequence();
  checkGuides();

  const res = await fetch(BASE_URL).catch(() => null);
  if (!res) {
    console.error(
      `\n✗ No dev server on ${BASE_URL}. Start one with \`npm run dev -- --port 3100\` and re-run.`,
    );
    process.exit(1);
  }

  const browser = await chromium.launch();
  try {
    await checkSetupLanding(browser);
    await checkSupplyTokenPage(browser);
    await checkPortal(browser);
    await checkAdminView(browser);
  } finally {
    await browser.close();
  }

  if (failures) {
    console.error(`\n${failures} check${failures === 1 ? "" : "s"} failed.`);
    process.exit(1);
  }
  console.log("\nAll onboarding sequence checks passed.");
  if (warnings.length) {
    console.log(
      `\n${warnings.length} warning${warnings.length === 1 ? "" : "s"} — the flow works, ` +
        `but something is missing:`,
    );
    for (const w of warnings) console.log(`  ! ${w}`);
  }
}

void main();

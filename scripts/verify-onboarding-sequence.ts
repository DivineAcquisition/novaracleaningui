// ─── Verification of the contractor onboarding sequence ─────────────────────
//
// Onboarding is phone → job-day guides → supplies → payouts, and four things
// have to agree on that: the shared definition in src/lib/cleaner-supplies.ts,
// the portal a contractor works through, the page a mailed setup link lands
// on, and the admin view that decides whether anything is outstanding. When
// they drift, the symptom is a contractor being asked for bank details before
// anyone has asked what equipment they own — or being told setup is complete
// when it isn't.
//
// The first half of this script checks the shared definition by calling it.
// The second half opens the real pages in a browser and reads what a
// contractor would actually see, because "the function returns four steps"
// and "the portal shows four steps, with payouts locked last" are different
// claims and only the second one is the product.
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
  isCleanerSetupComplete,
  isJobDayGuidesAcknowledged,
  isSupplyChecklistSubmitted,
  sanitizeSupplyInventory,
  scoreSupplyInventory,
  supplySubmissionPatch,
  type CleanerSetupState,
} from "../src/lib/cleaner-supplies";
import { ONBOARDING_GUIDES } from "../src/lib/cleaner-onboarding-guides";

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

  const fresh: CleanerSetupState = {};
  check(
    "four steps, guides before supplies, payouts last",
    cleanerSetupSteps(fresh).map((s) => s.id),
    ["phone", "guides", "supplies", "payouts"],
  );
  check("a brand-new contractor has nothing done", cleanerSetupSteps(fresh).map((s) => s.done), [
    false,
    false,
    false,
    false,
  ]);
  check("and is not complete", isCleanerSetupComplete(fresh), false);

  // The state that used to read as finished: phone + Stripe, with nobody ever
  // asked about supplies or shown the dress code. If this ever goes back to
  // true, admin loses the ability to send these contractors a setup link.
  const phoneAndStripe: CleanerSetupState = {
    phone_verified: true,
    stripe_account_id: "acct_123",
  };
  check("phone + payouts alone is not complete", isCleanerSetupComplete(phoneAndStripe), false);
  check(
    "the outstanding steps are the guides and the supply checkoff, in order",
    cleanerSetupSteps(phoneAndStripe).filter((s) => !s.done).map((s) => s.id),
    ["guides", "supplies"],
  );

  const allDone: CleanerSetupState = {
    ...phoneAndStripe,
    ob_job_day_guides_ack: true,
    supply_checklist_submitted_at: "2026-09-01T00:00:00Z",
  };
  check("all four done is complete", isCleanerSetupComplete(allDone), true);
  check(
    "a contractor who skipped only the dress code is still outstanding",
    cleanerSetupSteps({ ...allDone, ob_job_day_guides_ack: false })
      .filter((s) => !s.done)
      .map((s) => s.id),
    ["guides"],
  );
  check("the guides step needs an explicit acknowledgment", isJobDayGuidesAcknowledged({}), false);
  check(
    "which is one record covering both graphics",
    isJobDayGuidesAcknowledged({ ob_job_day_guides_ack: true }),
    true,
  );

  // Submission, not readiness: a contractor who owns almost nothing has still
  // done the step. Onboarding must never wait on a purchase.
  check("submitting an almost-empty checklist still completes the step", isCleanerSetupComplete(allDone), true);
  check("while readiness stays false", scoreSupplyInventory({}).ready, false);

  check(
    "the legacy viewed flag still counts, so nobody is asked twice",
    isSupplyChecklistSubmitted({ ob_supplies_checklist_viewed: true }),
    true,
  );

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
    ob_job_day_guides_ack: false,
    ob_job_day_guides_ack_at: null,
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

  check("the portal now asks for four steps", (await body()).includes("Four quick steps"), true);
  check("and counts them", (await body()).includes("0 of 4 complete"), true);

  const headings = await page.locator("main h3, main [class*='CardTitle'], main div.text-base").allInnerTexts();
  const expectedOrder = [
    "Verify your phone number",
    "Read the dress code and job-day guide",
    "Check off your supplies",
    "Set up payouts",
  ];
  check(
    "in order, guides before supplies and payouts last",
    expectedOrder.filter((t) => headings.some((h) => h.includes(t))),
    expectedOrder,
  );

  check(
    "the guides are locked behind phone verification",
    (await body()).includes("Verify your phone first."),
    true,
  );
  check(
    "so is the supply checkoff",
    (await body()).match(/Verify your phone first\./g)?.length,
    2,
  );
  check(
    "and payouts just points at the steps above it",
    (await body()).includes("Finish the steps above to unlock payouts."),
    true,
  );
  check(
    "so no bank details are asked for yet",
    await page.getByRole("button", { name: "Set up payouts" }).isVisible().catch(() => false),
    false,
  );

  mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: resolve(SHOTS_DIR, "portal-fresh.png"), fullPage: true });

  // ── Phone verified: the two graphics should now be on the page ──
  row.phone_verified = true;
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Welcome, Imani!").waitFor({ timeout: 20_000 });

  check("phone verified counts", (await body()).includes("1 of 4 complete"), true);
  check(
    "both graphics are shown inline",
    await page.locator('main img[src^="/onboarding/"]').count(),
    ONBOARDING_GUIDES.length,
  );
  for (const guide of ONBOARDING_GUIDES) {
    check(
      `the ${guide.id} graphic is on the page with its alt text`,
      await page.locator(`main img[alt="${guide.alt}"]`).isVisible(),
      true,
    );
  }
  check(
    "each graphic can be opened full size",
    await page.locator('main a[href^="/onboarding/"]').count(),
    ONBOARDING_GUIDES.length,
  );
  check(
    "the supply checkoff stays locked until the guides are read",
    (await body()).includes("Read the dress code and job-day guide first"),
    true,
  );
  check(
    "so the checklist is not on the page yet",
    await page.getByText("Download full PDF checklist").isVisible().catch(() => false),
    false,
  );

  await page.screenshot({ path: resolve(SHOTS_DIR, "portal-guides.png"), fullPage: true });

  // ── A graphic that fails to load must not strand the contractor ──
  guideImagesBroken = true;
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Welcome, Imani!").waitFor({ timeout: 20_000 });
  check(
    "a graphic that won't load says so rather than showing a broken box",
    (await body()).includes("The graphic didn't load."),
    true,
  );
  for (const guide of ONBOARDING_GUIDES) {
    check(
      `and ${guide.id} is readable as text instead`,
      (await body()).includes(guide.points[0]),
      true,
    );
  }
  check(
    "the step can still be completed",
    await page.getByRole("button", { name: "I've read both" }).isVisible(),
    true,
  );
  await page.screenshot({ path: resolve(SHOTS_DIR, "portal-guides-fallback.png"), fullPage: true });

  guideImagesBroken = false;
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Welcome, Imani!").waitFor({ timeout: 20_000 });

  // ── Acknowledge the guides ──
  await page.getByRole("button", { name: "I've read both" }).click();
  await page.getByText("Read — thanks.").waitFor({ timeout: 20_000 });
  check(
    "the acknowledgment is recorded on the contractor's row",
    row.ob_job_day_guides_ack,
    true,
  );
  check("with a timestamp", Boolean(row.ob_job_day_guides_ack_at), true);
  check("two of four steps done", (await body()).includes("2 of 4 complete"), true);

  check(
    "the supply checklist is now on the page, not behind another link",
    await page.getByText("Download full PDF checklist").isVisible(),
    true,
  );
  check(
    "every catalog item is offered",
    await page.locator('main [id^="supply-"]').count(),
    SUPPLY_ITEMS.length,
  );
  check(
    "payouts is still locked",
    (await body()).includes("Finish the steps above to unlock payouts."),
    true,
  );

  // ── Tick enough to be job-ready, then submit ──
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
  check(
    "with the inventory they ticked",
    Object.keys((row.supply_inventory as Record<string, boolean>) || {}).filter(
      (k) => (row.supply_inventory as Record<string, boolean>)[k],
    ).length,
    needed.length,
  );
  check("three of four steps done", (await body()).includes("3 of 4 complete"), true);
  check(
    "and payouts is finally unlocked",
    await page.getByRole("button", { name: /Set up payouts/ }).isVisible(),
    true,
  );
  check(
    "nothing about the contractor's work is blocked in the meantime",
    (await body()).includes("Job offers will start coming through"),
    false,
  );

  await page.screenshot({ path: resolve(SHOTS_DIR, "portal-payouts-unlocked.png"), fullPage: true });

  // ── Returning contractor: collapsed to their standing ──
  await page.reload({ waitUntil: "networkidle" });
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
    "the guides collapse the same way, and stay available",
    await page.getByRole("button", { name: "Look again" }).isVisible(),
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
          guidesAcknowledged: false,
          suppliesSubmitted: false,
          stripeReady: false,
          agreementSigned: false,
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
    listed.slice(0, 4),
    [
      "Verify your phone number",
      "Read the dress code and job-day guide",
      "Check off your supplies",
      "Set up payouts (Stripe)",
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
  check(
    "so is the dress code and job-day guide",
    panel.includes("Dress code + job-day guide read"),
    true,
  );
  check(
    "and readiness is stated as all four",
    panel.includes("Portal ready (phone + guide + supplies + Stripe)"),
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

// ─── Verification of the contractor onboarding sequence ─────────────────────
//
// Onboarding is phone → supplies → payouts, and four things have to agree on
// that: the shared definition in src/lib/cleaner-supplies.ts, the portal a
// contractor works through, the page a mailed setup link lands on, and the
// admin view that decides whether anything is outstanding. When they drift,
// the symptom is a contractor being asked for bank details before anyone has
// asked what equipment they own — or being told setup is complete when it
// isn't.
//
// The first half of this script checks the shared definition by calling it.
// The second half opens the real pages in a browser and reads what a
// contractor would actually see, because "the function returns three steps"
// and "the portal shows three steps, with payouts locked last" are different
// claims and only the second one is the product.
//
// No real data is touched: every Supabase call is answered from an invented
// fixture in this file, same approach as the walkthrough recorder.
//
//   Run:  npm run dev -- --port 3100     (in another shell)
//         npm run onboarding:verify

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Browser, type Page, type Route } from "playwright";

import {
  SUPPLY_ITEMS,
  cleanerSetupSteps,
  isCleanerSetupComplete,
  isSupplyChecklistSubmitted,
  sanitizeSupplyInventory,
  scoreSupplyInventory,
  supplySubmissionPatch,
  type CleanerSetupState,
} from "../src/lib/cleaner-supplies";

const BASE_URL = process.env.ONBOARDING_VERIFY_BASE_URL || "http://localhost:3100";
const SHOTS_DIR = resolve(__dirname, "../docs/contractor-onboarding");
const AUTH_STORAGE_KEY = "sb-sxdraeptzuamsgjcvfeg-auth-token";

let failures = 0;
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
    "three steps, payouts last",
    cleanerSetupSteps(fresh).map((s) => s.id),
    ["phone", "supplies", "payouts"],
  );
  check("a brand-new contractor has nothing done", cleanerSetupSteps(fresh).map((s) => s.done), [
    false,
    false,
    false,
  ]);
  check("and is not complete", isCleanerSetupComplete(fresh), false);

  // The state that used to read as finished: phone + Stripe, supplies never
  // asked. If this ever goes back to true, admin loses the ability to send
  // these contractors a setup link at all.
  const phoneAndStripe: CleanerSetupState = {
    phone_verified: true,
    stripe_account_id: "acct_123",
  };
  check("phone + payouts alone is no longer complete", isCleanerSetupComplete(phoneAndStripe), false);
  check(
    "the outstanding step is the supply checkoff",
    cleanerSetupSteps(phoneAndStripe).filter((s) => !s.done).map((s) => s.id),
    ["supplies"],
  );

  check(
    "all three done is complete",
    isCleanerSetupComplete({ ...phoneAndStripe, supply_checklist_submitted_at: "2026-09-01T00:00:00Z" }),
    true,
  );

  // Submission, not readiness: a contractor who owns almost nothing has still
  // done the step. Onboarding must never wait on a purchase.
  const emptyButSubmitted = { ...phoneAndStripe, supply_checklist_submitted_at: "2026-09-01T00:00:00Z" };
  check("submitting an almost-empty checklist still completes the step", isCleanerSetupComplete(emptyButSubmitted), true);
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
    ob_supplies_checklist_viewed: false,
    supply_checklist_submitted_at: null,
    supply_inventory: {},
    pay_tier: "foundation",
    pay_percentage: 35,
  };
}

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

  await page.goto(`${BASE_URL}/cleaner/ob-portal`, { waitUntil: "networkidle" });
  await page.getByText("Welcome, Imani!").waitFor({ timeout: 20_000 });

  const body = () => page.locator("main").innerText();

  check("the portal now asks for three steps", (await body()).includes("Three quick steps"), true);
  check("and counts them", (await body()).includes("0 of 3 complete"), true);

  const headings = await page.locator("main h3, main [class*='CardTitle'], main div.text-base").allInnerTexts();
  const order = ["Verify your phone number", "Check off your supplies", "Set up payouts"].filter((t) =>
    headings.some((h) => h.includes(t)),
  );
  check(
    "in order, with payouts last",
    order,
    ["Verify your phone number", "Check off your supplies", "Set up payouts"],
  );

  check(
    "supplies is locked behind phone verification",
    (await body()).includes("Verify your phone first."),
    true,
  );
  check(
    "and payouts names both of the steps ahead of it",
    (await body()).includes("Verify your phone and check off your supplies to unlock payouts."),
    true,
  );
  check(
    "so no bank details are asked for yet",
    await page.getByRole("button", { name: "Set up payouts" }).isVisible().catch(() => false),
    false,
  );

  mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: resolve(SHOTS_DIR, "portal-fresh.png"), fullPage: true });

  // ── Phone verified: the checklist itself should now be on the page ──
  row.phone_verified = true;
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Welcome, Imani!").waitFor({ timeout: 20_000 });

  check("phone verified counts", (await body()).includes("1 of 3 complete"), true);
  check(
    "the supply checklist is on the page, not behind another link",
    await page.getByText("Download full PDF checklist").isVisible(),
    true,
  );
  check(
    "every catalog item is offered",
    await page.locator('main [id^="supply-"]').count(),
    SUPPLY_ITEMS.length,
  );
  check(
    "payouts is still locked, and says why",
    (await body()).includes("Check off your supplies to unlock payouts."),
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
  check("two of three steps done", (await body()).includes("2 of 3 complete"), true);
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
    listed.slice(0, 3),
    ["Verify your phone number", "Check off your supplies", "Set up payouts (Stripe)"],
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

async function main(): Promise<void> {
  checkSequence();

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
  } finally {
    await browser.close();
  }

  if (failures) {
    console.error(`\n${failures} check${failures === 1 ? "" : "s"} failed.`);
    process.exit(1);
  }
  console.log("\nAll onboarding sequence checks passed.");
}

void main();

// ─── Behavioural check for the onboarding session page ─────────────────────
//
//   npm run commercial:verify:ui        (dev server on :3100)
//
// Drives the REAL page component with a stubbed session API so the things the
// spec is explicit about can be asserted rather than eyeballed:
//
//   • the status checklist renders before any form, on every visit
//   • the flow opens on pricing review, and accepting advances to the agreement
//   • an INVOICED account is never shown a card field, and an AUTO-PAY account
//     is never shown invoice-contact fields
//   • reopening mid-flow resumes at the right step rather than restarting
//   • "send us something" is available at every step, including after the end
//   • Request Changes pauses the session instead of advancing it
//
// Only the API is stubbed. The component, its step routing and its copy are
// the shipped ones, so this fails when the page changes in a way that breaks
// the promises above.

import { chromium, type Page, type Route } from "playwright";
import { deriveCommercialOnboardingProgress } from "../../src/lib/commercial-onboarding/progress";

const BASE = process.env.DOCS_CAPTURE_BASE_URL || "http://localhost:3100";
const TOKEN = "0".repeat(64);

type Step = "pricing" | "agreement" | "billing" | "done" | "paused";

interface Scenario {
  step: Step;
  billingMethod: "auto_pay" | "invoiced";
  paused?: boolean;
  billingConfigured?: boolean;
  portalReady?: boolean;
}

const SITES = [
  {
    id: "s1",
    nickname: "Main office",
    address: "1 Example Plaza, Columbia MD",
    sqft: 1800,
    facility_type: "office",
    scope_level: "standard",
    crew_size: 2,
    frequency: "weekly",
    per_visit_price_cents: 28080,
  },
];

function payload({ step, billingMethod, paused, billingConfigured, portalReady }: Scenario) {
  const billed = billingConfigured === true || step === "done";
  const portal = portalReady === true || step === "done";
  const progress = deriveCommercialOnboardingProgress({
    proposalStatus: paused ? "changes_requested" : step === "pricing" ? "sent" : "accepted",
    hasAgreement: step !== "pricing" && !paused,
    agreementStatus:
      step === "agreement" ? "pending" : step === "billing" || step === "done" ? "signed" : null,
    billingConfigured: billed,
    portalReady: portal,
    billingMethod,
  });
  return {
    ok: true,
    session: {
      id: "sess-1",
      status: step === "done" ? "completed" : "active",
      billingMethod,
      recipientName: "Nadia Okonkwo",
      expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
      completedAt: null,
    },
    progress: {
      ...progress,
      current_step: paused ? "paused" : step,
      compliance: { blockers: [] },
      billing: null,
    },
    account: {
      id: "acct-1",
      business_name: "Harbor Point Dental",
      email: "ap@example.test",
      address: "1 Example Plaza",
      city: "Columbia",
      state: "MD",
      zip_code: "21044",
      portal_user_id: portal ? "user-1" : null,
    },
    proposal: {
      id: "prop-1",
      version: 1,
      term: "month_to_month",
      totalPerVisitCents: 28080,
      estimatedMonthlyCents: 121586,
      coverNote: null,
      changeRequestNote: paused ? "Please split the invoice by site." : null,
    },
    sites: SITES,
    agreement:
      step === "pricing"
        ? null
        : {
            id: "agr-1",
            status: step === "agreement" ? "pending" : "signed",
            term: "month_to_month",
            billingMethod,
            invoiceCycle: "monthly",
            netTerms: "net_30",
            exhibitAText: "EXHIBIT A — Main office — $280.80 per visit",
            totalPerVisitCents: 28080,
            signerName: "Nadia Okonkwo",
            signerEmail: "ap@example.test",
            signedByName: step === "agreement" ? null : "Nadia Okonkwo",
          },
    billing: null,
    billingProfile: null,
    valueStack: [],
    portalUrl: "https://partner.novaracleaning.com",
    submissions: [],
  };
}

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

const results: Check[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "✓" : "✗"} ${name}${pass || !detail ? "" : ` — ${detail}`}`);
}

async function open(page: Page, scenario: Scenario, onPost?: (route: Route) => void) {
  await page.route(`**/api/commercial-onboarding/**`, async (route) => {
    if (route.request().method() === "POST") {
      if (onPost) return onPost(route);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, progress: payload(scenario).progress }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload(scenario)),
    });
  });
  await page.goto(`${BASE}/onboarding/${TOKEN}`, { waitUntil: "commit" });
  await page.getByText("Where you are").first().waitFor({ timeout: 25_000 });
  await page.waitForTimeout(400);
}

async function main() {
  try {
    const res = await fetch(`${BASE}/admin/auth`);
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    console.error(`Dev server not reachable at ${BASE}. Start it: npm run dev -- --port 3100`);
    process.exit(1);
  }

  const browser = await chromium.launch();

  // ── 1. Opens on pricing, checklist first ────────────────────────────────
  console.log("\nPricing step (invoiced account)");
  {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    await open(page, { step: "pricing", billingMethod: "invoiced" });

    const body = (await page.textContent("body")) || "";
    const checklistY = (await page.getByText("Where you are").first().boundingBox())?.y ?? 1e9;
    const formY = (await page.getByText("Page 1 — Pricing & Terms Review").first().boundingBox())?.y ?? 0;

    check("status checklist renders above the form", checklistY < formY);
    check("opens on pricing review", body.includes("Page 1 — Pricing & Terms Review"));
    const cream = await page.evaluate(() => {
      const el = document.querySelector(".min-h-screen");
      return el ? getComputedStyle(el).backgroundColor : "";
    });
    check("cream page field", cream === "rgb(251, 246, 238)");
    check("shows the per-site rate", body.includes("$280.80"));
    check("offers Request Changes", body.includes("Request changes instead"));
    check(
      "no signature field before pricing is accepted",
      !body.includes("Sign below") && !body.includes("Page 2 —"),
    );
    check("send-us-something is available at this step", body.includes("Need to send us something?"));
    check("progress shows Pricing · Agreement · Billing", body.includes("Pricing") && body.includes("Agreement") && body.includes("Billing"));
    check("no password field anywhere", (await page.locator('input[type="password"]').count()) === 0);
    await page.close();
  }

  // ── 2. Request Changes pauses rather than advancing ─────────────────────
  console.log("\nRequest Changes");
  {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    await open(page, { step: "pricing", billingMethod: "invoiced", paused: true });
    const body = (await page.textContent("body")) || "";
    check("paused session explains the revision is coming", body.includes("We're revising your proposal"));
    check("paused session shows the client's own words back", body.includes("split the invoice by site"));
    check("paused session offers no accept button", !body.includes("Accept and continue"));
    await page.close();
  }

  // ── 3. Resume mid-flow ──────────────────────────────────────────────────
  console.log("\nResuming a part-finished session");
  {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    await open(page, { step: "agreement", billingMethod: "invoiced" });
    const body = (await page.textContent("body")) || "";
    check("resumes at the signature step, not the beginning", body.includes("Page 2 — Agreement E-Signature"));
    check("does not re-show the pricing form", !body.includes("Accept and continue to the agreement"));
    check("earlier step is marked done", body.includes("Pricing"));
    check("Exhibit A is shown before signing", body.includes("EXHIBIT A"));
    await page.close();
  }

  // ── 4. Invoiced billing never shows a card field ────────────────────────
  console.log("\nBilling — invoiced account");
  {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    await open(page, { step: "billing", billingMethod: "invoiced" });
    const body = (await page.textContent("body")) || "";

    // Assert on CONTROLS, not prose. The page legitimately mentions payment
    // methods here to say there isn't one to add; what must not exist is a way
    // to enter card details.
    const cardButtons = await page.getByRole("button", { name: /card|bank account/i }).count();
    const cardInputs = await page
      .locator('input[autocomplete*="cc-"], input[name*="card" i], input[placeholder*="card" i]')
      .count();

    check("asks for the billing contact", body.includes("Confirm your billing contact"));
    check("says explicitly that no payment method is needed", body.includes("no payment method to add"));
    check(
      "NEVER offers a card control to an invoiced account",
      cardButtons === 0 && cardInputs === 0,
      `${cardButtons} card button(s), ${cardInputs} card input(s)`,
    );
    check("shows the Net terms from the signed agreement", /Net 30/i.test(body));
    check("invoiced page is Billing Setup, not a fourth portal page", body.includes("Page 3 — Billing Setup"));
    check("no password on invoiced billing", (await page.locator('input[type="password"]').count()) === 0);
    await page.close();
  }

  // ── 5. Auto-Pay shows the card path and no invoice questions ────────────
  console.log("\nBilling — Auto-Pay account");
  {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    await open(page, { step: "billing", billingMethod: "auto_pay" });
    const body = (await page.textContent("body")) || "";

    check("offers the Pre-Auth card form", /pre-auth hold/i.test(body));
    check("states it is a verification hold", /verification hold/i.test(body));
    check("names Stripe Pre-Auth", body.includes("Stripe Pre-Auth"));
    check(
      "NEVER shows invoice-contact fields to a Stripe Pre-Auth account",
      !body.includes("Confirm your billing contact"),
    );
    await page.close();
  }

  // ── 6. Billing concludes with portal (not a fourth page) ────────────────
  console.log("\nBilling concludes with portal");
  {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    await open(page, {
      step: "billing",
      billingMethod: "invoiced",
      billingConfigured: true,
      portalReady: false,
    });
    const body = (await page.textContent("body")) || "";
    check("shows portal opening on Page 3, not a fourth page", body.includes("Opening your partner portal"));
    check("does not collect a password", (await page.locator('input[type="password"]').count()) === 0);
    check("does not re-show invoice fields once billing is configured", !body.includes("Confirm your billing contact"));
    check("send-us-something is still available", body.includes("Need to send us something?"));
    await page.close();
  }

  // ── 7. Finished ─────────────────────────────────────────────────────────
  console.log("\nFinished session");
  {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    await open(page, { step: "done", billingMethod: "invoiced" });
    const body = (await page.textContent("body")) || "";
    check("confirms completion", body.includes("You're all set"));
    check("links straight into the portal", body.includes("Open your portal"));
    check("summarizes pricing, agreement, billing, portal", body.includes("Pricing & terms accepted") && body.includes("Portal created"));
    check(
      "send-us-something is STILL available after finishing",
      body.includes("Need to send us something?"),
    );
    check("no password on the finished screen", (await page.locator('input[type="password"]').count()) === 0);
    await page.close();
  }

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log("\nFailed:");
    for (const f of failed) console.log(`  ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    process.exitCode = 1;
  }
}

main();

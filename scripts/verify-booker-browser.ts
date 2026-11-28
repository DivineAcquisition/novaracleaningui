// ─── Internal booker browser checks ───────────────────────────────────────
//
//   npm run dev -- --port 3100
//   npm run booker:verify:browser
//
// Drives /admin/csr against the docs capture mock. quote-dynamic-price runs
// the REAL engine inside the mock; only the "lock" call is answered here so
// a save can be exercised (and failed on purpose).

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { handleApiRoute, handleSupabase } from "./docs/capture/supabase-mock";
import { DEMO_ADMIN } from "./docs/capture/demo-data";

const BASE = process.env.DOCS_CAPTURE_BASE_URL || "http://localhost:3100";
const OUT = resolve(process.env.ADMIN_VERIFY_OUT || "reports/admin-verify");
mkdirSync(OUT, { recursive: true });
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ""}`);
}

async function open(browser: Browser, opts: { width?: number; height?: number; role?: "admin" | "va"; lock?: "ok" | "fail" } = {}) {
  const context = await browser.newContext({ viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 }, reducedMotion: "reduce" });
  await context.route("**/*.supabase.co/**", (r, q) => handleSupabase(r, q));
  let lockCalls = 0;
  await context.route("**/*.supabase.co/functions/v1/quote-dynamic-price", async (route, req) => {
    const body = JSON.parse(req.postData() || "{}");
    if (body.action !== "lock") return handleSupabase(route, req);
    lockCalls++;
    if (opts.lock === "fail") return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "lock store unavailable" }) });
    const res = await route.fetch().catch(() => null);
    void res;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, breakdown: null, lock: { quoteId: "11111111-2222-3333-4444-555555555555", lockedUntil: new Date(Date.now() + 48 * 3600e3).toISOString(), quotedPriceCents: 32500 } }),
    });
  });
  if (opts.role === "va") {
    await context.route("**/*.supabase.co/rest/v1/rpc/has_role", async (route, req) => {
      const body = JSON.parse(req.postData() || "{}");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body?._role === "va") });
    });
  }
  await context.route("**/api/**", (r, q) => handleApiRoute(r, q));
  await context.route(/googleapis|gstatic|google\.com|googletagmanager|facebook|stripe\.com|js\.stripe/, (r) => r.abort());
  const now = Math.floor(Date.now() / 1000);
  await context.addInitScript(([k, v]) => window.localStorage.setItem(k as string, v as string), [
    "sb-sxdraeptzuamsgjcvfeg-auth-token",
    JSON.stringify({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, user: { id: DEMO_ADMIN.id, email: DEMO_ADMIN.email, aud: "authenticated", role: "authenticated" } }),
  ] as const);
  const page = await context.newPage();
  return { page, lockCalls: () => lockCalls };
}

async function gotoBooker(page: Page, qs = "") {
  await page.goto(`${BASE}/admin/csr${qs}`, { waitUntil: "domcontentloaded" });
  await page.locator("#bk-extras").waitFor({ timeout: 90_000 });
  await page.waitForTimeout(800);
}

async function railText(page: Page) {
  return (await page.locator("[data-testid=booker-quote-lines]").innerText()) + "\n" + (await page.locator("[data-testid=booker-totals]").innerText());
}

async function main() {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

  // ── One-time clean: picker, rail, requirements, save → reopen ──
  {
    const { page, lockCalls } = await open(browser, { lock: "ok" });
    await gotoBooker(page);
    check("existing-customer search is open first on a fresh call", (await page.getByText("Close search").count()) > 0);
    await page.locator("#bk-zip").fill("21044");
    await page.locator("#bk-extras").click();
    const input = page.getByPlaceholder("Search extras — fridge, laundry, baseboards…");
    await input.waitFor();
    const groups = await page.locator("[cmdk-group-heading]").allInnerTexts();
    check("picker grouped: kitchen, laundry & linens, detail, spaces", groups.join("|").toLowerCase() === "kitchen|laundry & linens|detail cleaning|additional spaces", groups);
    const laundryRow = await page.locator("[cmdk-item]", { hasText: "Laundry" }).first().innerText();
    check("laundry shows price and per-load unit before selection", /\+\$35 per load/.test(laundryRow), laundryRow);
    check("pest / mold findings are not offered", (await page.locator("[cmdk-item]", { hasText: /Pest|Mold/ }).count()) === 0);
    await input.fill("windows");
    await page.keyboard.press("Enter");
    await input.fill("laun");
    await page.keyboard.press("Enter");
    check("picker stays open after choosing", await input.isVisible());
    const sel = await page.locator("[cmdk-item][data-checked=true]").count();
    await input.fill("");
    check("two items checked (keyboard: type + Enter)", (await page.locator("[cmdk-item][data-checked=true]").count()) === 2, sel);
    await page.screenshot({ path: `${OUT}/booker-picker-open.png` });
    await page.keyboard.press("Escape");
    const chips = await page.locator("ul[aria-label='Selected extras'] li").allInnerTexts();
    check("selected extras shown outside the field", chips.length === 2, chips);
    await page.waitForTimeout(1200);
    let rail = await railText(page);
    check("rail lists add-ons separately with count", /Add-ons · 2/i.test(rail) && /Laundry.*per load/.test(rail), rail);
    check("rail shows Total / Due today / Remaining balance", /Total/i.test(rail) && /Due today/i.test(rail) && /Remaining balance/i.test(rail));
    // accessible removal
    await page.getByRole("button", { name: /Remove Interior Windows/ }).click();
    await page.waitForTimeout(900);
    rail = await railText(page);
    check("chip removal updates rail", /Add-ons · 1/i.test(rail), rail);
    // requirements focus their input
    const firstNeed = page.locator("button", { hasText: "First name" }).first();
    await firstNeed.click();
    await page.waitForTimeout(500);
    check("'Still needed: First name' focuses the first-name input", (await page.evaluate(() => document.activeElement?.id)) === "bk-first-name");
    await page.locator("#bk-first-name").fill("Avery");
    await page.locator("#bk-email").fill("avery.test@example.com");
    await page.screenshot({ path: `${OUT}/booker-one-time-rail.png`, fullPage: false });
    // save → reopen
    const save = page.getByRole("button", { name: "Save as quote" });
    await save.dblclick();
    await page.getByText("Quote saved ·").waitFor({ timeout: 15_000 });
    check("double-click on save sends one lock request", lockCalls() === 1, lockCalls());
    const reopen = await page.getByRole("link", { name: "Reopen quote" }).getAttribute("href");
    check("save offers a Reopen quote link to the booker (not the Quotes index)", reopen === "/admin/csr?quoteId=11111111-2222-3333-4444-555555555555", reopen);
    check("lock expiry shown", (await page.getByText(/Price locked until/).count()) > 0);
    await page.screenshot({ path: `${OUT}/booker-saved-quote.png` });
  }

  // ── Failed save keeps values ──
  {
    const { page } = await open(browser, { lock: "fail" });
    await gotoBooker(page);
    await page.locator("#bk-zip").fill("21044");
    await page.locator("#bk-first-name").fill("Jordan");
    await page.locator("#bk-email").fill("jordan.test@example.com");
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Save as quote" }).click();
    await page.waitForTimeout(1500);
    check("failed save shows no saved panel", (await page.getByText("Quote saved ·").count()) === 0);
    check("failed save keeps entered values", (await page.locator("#bk-first-name").inputValue()) === "Jordan" && (await page.locator("#bk-zip").inputValue()) === "21044");
  }

  // ── Move-out with oven and fridge ──
  {
    const { page } = await open(browser);
    await gotoBooker(page);
    await page.locator("#bk-zip").fill("21044");
    await page.getByRole("button", { name: /Move-In \/ Out/ }).first().click();
    await page.locator("#bk-extras").click();
    const ovenRow = await page.locator("[cmdk-item]", { hasText: "Inside Oven" }).first().innerText();
    check("oven reads Included on move-in/out before selection", /Included/.test(ovenRow), ovenRow);
    await page.locator("[cmdk-item]", { hasText: "Inside Oven" }).first().click();
    await page.locator("[cmdk-item]", { hasText: "Inside Fridge" }).first().click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
    const rail = await railText(page);
    check("rail: fridge and oven under Included, no add-on charge", /Included · 2/i.test(rail) && !/Add-ons ·/i.test(rail), rail);
    await page.screenshot({ path: `${OUT}/booker-move-out.png` });
  }

  // ── Recurring with first-visit deep ──
  {
    const { page } = await open(browser);
    await gotoBooker(page, "?type=recurring&cadence=biweekly");
    await page.locator("#bk-zip").fill("21044");
    await page.waitForTimeout(1500);
    const rail = await railText(page);
    check("recurring rail shows First visit / Later visits / Cadence", /First visit/i.test(rail) && /Later visits/i.test(rail) && /Cadence/i.test(rail), rail);
    await page.screenshot({ path: `${OUT}/booker-recurring.png` });
  }

  // ── Phone: compact quote bar; laptop with assistant open ──
  {
    const { page } = await open(browser, { width: 390, height: 844 });
    await gotoBooker(page);
    check("phone: compact quote bar visible", await page.locator("[data-testid=compact-quote-bar]").isVisible());
    await page.locator("#bk-extras").click();
    await page.waitForTimeout(500);
    check("phone: picker opens as a bottom sheet", (await page.locator("[role=dialog]", { hasText: "Extras" }).count()) > 0);
    await page.screenshot({ path: `${OUT}/booker-phone-sheet.png` });
  }
  {
    const { page } = await open(browser, { width: 1280, height: 800 });
    await gotoBooker(page);
    await page.getByRole("button", { name: "Open Ask Novara" }).click();
    await page.waitForTimeout(800);
    const box = await page.locator("#bk-first-name").boundingBox();
    const panel = await page.locator("aside, div").filter({ has: page.getByRole("button", { name: "Close Ask Novara" }) }).last().boundingBox().catch(() => null);
    const width = await page.evaluate(() => document.querySelector("main")!.getBoundingClientRect().width);
    check("laptop + assistant: form keeps ≥ 560px and first-name input is clickable", width >= 560 && !!box && box.width > 120, { width, input: box?.width });
    await page.locator("#bk-first-name").click();
    check("laptop + assistant: input receives focus", (await page.evaluate(() => document.activeElement?.id)) === "bk-first-name");
    void panel;
    await page.screenshot({ path: `${OUT}/booker-laptop-assistant.png` });
  }

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nall booker browser checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

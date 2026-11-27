// ─── Admin workspace browser checks ───────────────────────────────────────
//
//   npm run dev -- --port 3100
//   npm run admin-workspace:verify
//
// Drives the real admin shell against the docs capture Supabase mock (no
// production data) and checks typography, navigation and role visibility.
// Writes screenshots to ADMIN_VERIFY_OUT (default: ./reports/admin-verify).

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

function session() {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: "demo-access-token",
    refresh_token: "demo-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user: { id: DEMO_ADMIN.id, email: DEMO_ADMIN.email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} },
  };
}

async function open(browser: Browser, opts: { role?: "admin" | "va"; width?: number; height?: number; signedIn?: boolean } = {}) {
  const context = await browser.newContext({
    viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  await context.route("**/*.supabase.co/**", (route, req) => handleSupabase(route, req));
  if (opts.role === "va") {
    await context.route("**/*.supabase.co/rest/v1/rpc/has_role", async (route, req) => {
      const body = JSON.parse(req.postData() || "{}");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body?._role === "va") });
    });
  }
  await context.route("**/api/**", (route, req) => handleApiRoute(route, req));
  await context.route(/googleapis|gstatic|google\.com|googletagmanager|facebook|stripe\.com|js\.stripe/, (r) => r.abort());
  if (opts.signedIn !== false) {
    await context.addInitScript(([k, v]) => window.localStorage.setItem(k as string, v as string), [
      "sb-sxdraeptzuamsgjcvfeg-auth-token",
      JSON.stringify(session()),
    ] as const);
  }
  const page = await context.newPage();
  const fontRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes(".woff2")) fontRequests.push(r.url());
  });
  return { page, context, fontRequests };
}

async function preloads(page: Page) {
  return page.$$eval('link[rel="preload"][as="font"]', (ls) => ls.map((l) => (l as HTMLLinkElement).href));
}

async function typography(page: Page, selector: string) {
  return page.$eval(selector, (el) => {
    const cs = getComputedStyle(el);
    return {
      family: cs.fontFamily.split(",")[0],
      weight: cs.fontWeight,
      opsz: cs.fontVariationSettings,
      optical: (cs as any).fontOpticalSizing,
      features: cs.fontFeatureSettings,
    };
  });
}

const adminFontFiles: string[] = [];

async function main() {
  const browser = await chromium.launch(
    process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  );

  // ── Admin: typography ──
  {
    const { page, fontRequests } = await open(browser);
    await page.goto(`${BASE}/admin/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-admin-text] nav[aria-label=Workspace]", { timeout: 60_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    const body = await typography(page, "body");
    check("admin body uses the local admin Inter", /adminInter/i.test(body.family), body.family);
    check("admin body weight 450", body.weight === "450", body.weight);
    check("admin opsz locked to 32, auto optical sizing off", body.opsz.includes("32") && body.optical === "none", body);
    const h1 = await typography(page, "header h1");
    check("header title (font-semibold) resolves to 650", h1.weight === "650", h1.weight);
    const fonts = await page.evaluate(() =>
      Array.from(document.fonts).map((f) => ({ family: f.family, style: f.style, weight: f.weight, status: f.status })),
    );
    const loaded = fonts.filter((f) => /adminInter/i.test(f.family) && f.status === "loaded");
    check("admin Inter upright file loaded", loaded.some((f) => f.style === "normal"), loaded);
    // Which files back the admin @font-face rules, and were they fetched?
    const faceSrcs = await page.evaluate(() => {
      const out: { style: string; src: string }[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try { rules = sheet.cssRules; } catch { continue; }
        for (const r of Array.from(rules)) {
          if (r instanceof CSSFontFaceRule && /adminInter/.test(r.style.getPropertyValue("font-family"))) {
            out.push({ style: r.style.getPropertyValue("font-style"), src: r.style.getPropertyValue("src") });
          }
        }
      }
      return out;
    });
    for (const f of faceSrcs) {
      const u = f.src.match(/url\("?([^")]+)/)?.[1];
      if (u) adminFontFiles.push(u.split("/").pop()!);
    }
    const uprightUrl = faceSrcs.find((f) => f.style === "normal")?.src.match(/url\("?([^")]+)/)?.[1] || "";
    check("upright admin face file served locally and fetched", !!uprightUrl && fontRequests.some((u) => u.endsWith(uprightUrl.split("/").pop()!)), { faces: faceSrcs.length, uprightUrl });
    // Italic: render a probe and make sure the italic face is the one used.
    const italic = await page.evaluate(async () => {
      const em = document.createElement("em");
      em.textContent = "Italic probe";
      document.querySelector("main")!.appendChild(em);
      await document.fonts.ready;
      await new Promise((r) => setTimeout(r, 300));
      const faces = Array.from(document.fonts).filter((f) => /adminInter/i.test(f.family) && f.style === "italic");
      return { style: getComputedStyle(em).fontStyle, italicStatus: faces.map((f) => f.status) };
    });
    check("italic uses the Inter italic face", italic.style === "italic" && italic.italicStatus.includes("loaded"), italic);
    // Portaled command dialog under <body>
    await page.keyboard.press("Control+k");
    const dlg = page.locator("[role=dialog]:has([cmdk-input])").first();
    await dlg.waitFor();
    const portaled = await dlg.evaluate((el) => {
      const cs = getComputedStyle(el.querySelector("input") || el);
      return { insideShell: !!el.closest("[data-admin-text]"), family: cs.fontFamily.split(",")[0], weight: cs.fontWeight };
    });
    check("command dialog is portaled outside the shell and inherits admin font", !portaled.insideShell && /adminInter/i.test(portaled.family), portaled);
    await page.keyboard.type("internal booking");
    const hit = await page.locator("[cmdk-item]").first().innerText();
    check("command search finds former label 'Internal Booking' → New booking", /New booking/.test(hit), hit);
    await page.screenshot({ path: `${OUT}/admin-command-alias.png` });
    await page.keyboard.press("Escape");
    // Radix select portal (if any on the page)
    console.log("      admin preloads:", (await preloads(page)).map((u) => u.split("/").pop()));
  }

  // ── Today: exceptions first, then schedule, then metrics; honest labels ──
  {
    const { page } = await open(browser);
    await page.goto(`${BASE}/admin/dashboard`, { waitUntil: "domcontentloaded" });
    await page.getByText("Needs a decision").first().waitFor({ timeout: 60_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1500);
    const top = async (t: RegExp) => (await page.locator("main").getByText(t).first().boundingBox())?.y ?? -1;
    const order = { exceptions: await top(/^Needs a decision/), schedule: await top(/^Coming up this week$/), metrics: await top(/^Metrics$/) };
    check("Today order: exceptions → schedule → metrics", order.exceptions > 0 && order.exceptions < order.schedule && order.schedule < order.metrics, order);
    const text = await page.locator("main").innerText();
    check("Today labels booked job value, not revenue/collected", /Booked value today/i.test(text) && !/Revenue today/i.test(text) && !/collected MTD/i.test(text));
    const items = await page.locator("[data-testid=today-exceptions] li").count();
    console.log(`      exceptions listed from demo data: ${items}`);
    await page.screenshot({ path: `${OUT}/today.png`, fullPage: true });
  }

  // ── Radix Select portal ──
  {
    const { page } = await open(browser);
    await page.goto(`${BASE}/admin/bookings`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-admin-text] nav[aria-label=Workspace]", { timeout: 60_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    const trigger = page.locator("main button[role=combobox]").first();
    if (await trigger.count()) {
      await trigger.click();
      const lb = page.locator("[role=listbox]").first();
      await lb.waitFor({ timeout: 10_000 });
      const t = await lb.evaluate((el) => {
        const opt = el.querySelector("[role=option]") || el;
        const cs = getComputedStyle(opt);
        return { insideShell: !!el.closest("[data-admin-text]"), family: cs.fontFamily.split(",")[0], weight: cs.fontWeight };
      });
      check("Radix Select listbox (portaled) inherits admin font", !t.insideShell && /adminInter/i.test(t.family), t);
      await page.screenshot({ path: `${OUT}/admin-select-portal.png` });
    } else {
      check("Radix Select trigger present on /admin/bookings", false);
    }
  }

  // ── Navigation: admin groups, VA visibility, restricted URL ──
  {
    const { page } = await open(browser);
    await page.goto(`${BASE}/admin/dashboard`, { waitUntil: "domcontentloaded" });
    const nav = page.locator("aside nav[aria-label=Workspace]");
    await nav.waitFor({ timeout: 60_000 });
    await page.waitForFunction(() => document.querySelectorAll("aside nav[aria-label=Workspace] button[aria-expanded]").length >= 5, null, { timeout: 20_000 }).catch(() => {});
    const groups = await nav.locator("button[aria-expanded]").allInnerTexts();
    check("admin sees all five groups in order", groups.map((g) => g.trim()).join("|").toLowerCase() === "daily work|sales & clients|workforce|finance & reports|settings", groups);
    const labels = await nav.locator("a").allInnerTexts();
    check("admin sidebar labels in order", labels.map((l) => l.trim()).join(" · ") ===
      "Today · Bookings · Dispatch & coverage · Quality control · Quotes · Proposals · Customers · Business accounts · Recurring plans · Cleaners & crews · Hiring & onboarding · Cleaner pay · Profit & loss · VA performance · Weekly report · Pricing rules · Team access · Email settings & delivery · Booking compliance · Assistant settings", labels);
    check("Today is the current page", (await nav.locator("a[aria-current=page]").innerText()).trim() === "Today");
    // Collapse memory
    await nav.locator("button", { hasText: "Settings" }).click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await nav.waitFor();
    await page.waitForTimeout(500);
    check("manual collapse is remembered", (await nav.locator("button", { hasText: "Settings" }).getAttribute("aria-expanded")) === "false");
    await page.goto(`${BASE}/admin/pricing`, { waitUntil: "domcontentloaded" });
    await nav.waitFor();
    await page.waitForFunction(() => document.querySelector("aside nav a[aria-current=page]")?.textContent?.includes("Pricing rules"), null, { timeout: 30_000 }).catch(() => {});
    check("navigating into a collapsed group expands it", (await nav.locator("button", { hasText: "Settings" }).getAttribute("aria-expanded")) === "true");
    await page.screenshot({ path: `${OUT}/admin-sidebar-desktop.png` });
    await page.goto(`${BASE}/admin/operations?tab=dispatch`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("aside nav a[aria-current=page]")?.textContent?.includes("Dispatch"), null, { timeout: 30_000 }).catch(() => {});
    check("query-tab URL lights Dispatch & coverage", ((await nav.locator("a[aria-current=page]").innerText().catch(() => "")) || "").includes("Dispatch & coverage"));
  }
  {
    const { page } = await open(browser, { role: "va" });
    await page.goto(`${BASE}/admin/dashboard`, { waitUntil: "domcontentloaded" });
    const nav = page.locator("aside nav[aria-label=Workspace]");
    await nav.waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    const groups = (await nav.locator("button[aria-expanded]").allInnerTexts()).map((g) => g.trim().toLowerCase());
    check("VA: finance and settings groups hidden", groups.join("|") === "daily work|sales & clients|workforce", groups);
    const labels = (await nav.locator("a").allInnerTexts()).map((l) => l.trim());
    check("VA: admin-only items hidden", !labels.some((l) => ["Quotes", "Business accounts", "Cleaner pay", "Pricing rules"].includes(l)), labels);
    const hiring = await nav.locator("a", { hasText: "Hiring & onboarding" }).getAttribute("href");
    check("VA: Hiring routes to the applicant pipeline in Cleaners", hiring === "/admin/cleaners?section=applicants", hiring);
    await page.keyboard.press("Control+k");
    await page.locator("[cmdk-input]").waitFor();
    await page.keyboard.type("payroll");
    await page.waitForTimeout(300);
    const items = await page.locator("[cmdk-group-heading]").allInnerTexts();
    check("VA: command search does not offer admin-only pages", !items.includes("Pages"), items);
    await page.keyboard.press("Escape");
    await page.goto(`${BASE}/admin/payroll`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    check("VA: restricted URL /admin/payroll does not render the page", !page.url().endsWith("/admin/payroll") || (await page.locator("aside nav[aria-label=Workspace]").count()) === 0, page.url());
    await page.goto(`${BASE}/admin/cleaners?section=applicants`, { waitUntil: "domcontentloaded" });
    await nav.waitFor({ timeout: 60_000 });
    await page.waitForFunction(() => document.querySelector("aside nav a[aria-current=page]")?.textContent?.includes("Hiring"), null, { timeout: 30_000 }).catch(() => {});
    check("VA: applicants URL lights Hiring & onboarding", ((await nav.locator("a[aria-current=page]").innerText().catch(() => "")) || "").includes("Hiring"));
    await page.screenshot({ path: `${OUT}/va-sidebar.png` });
  }

  // ── Mobile menu: focus, close on navigation, out of tab order ──
  {
    const { page } = await open(browser, { width: 390, height: 844 });
    await page.goto(`${BASE}/admin/dashboard`, { waitUntil: "domcontentloaded" });
    const menuBtn = page.getByRole("button", { name: "Open navigation" });
    await menuBtn.waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1000);
    const hiddenLinks = await page.evaluate(() => {
      const panel = document.getElementById("admin-mobile-nav")!;
      return getComputedStyle(panel).visibility;
    });
    check("mobile: closed menu is hidden from tab order (visibility hidden)", hiddenLinks === "hidden", hiddenLinks);
    await menuBtn.click();
    await page.waitForTimeout(400);
    const focus = await page.evaluate(() => ({
      inside: !!document.activeElement?.closest("#admin-mobile-nav"),
      el: `${document.activeElement?.tagName} ${document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.slice(0, 20)}`,
      vis: getComputedStyle(document.getElementById("admin-mobile-nav")!).visibility,
    }));
    check("mobile: opening moves focus into the menu", focus.inside, focus);
    await page.screenshot({ path: `${OUT}/mobile-menu-open.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const restored = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    check("mobile: Escape closes and restores focus to the menu button", restored === "Open navigation", restored);
    await menuBtn.click();
    await page.waitForTimeout(300);
    await page.locator("#admin-mobile-nav a", { hasText: "Bookings" }).click();
    await page.waitForURL(/\/admin\/bookings/, { timeout: 60_000 });
    await page.waitForTimeout(800);
    const vis = await page.evaluate(() => getComputedStyle(document.getElementById("admin-mobile-nav")!).visibility);
    check("mobile: menu closes on navigation", vis === "hidden", vis);
  }

  // ── Public pages: no admin fonts, unchanged public Inter ──
  for (const path of ["/", "/book"]) {
    const { page, fontRequests } = await open(browser, { signedIn: false });
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    const body = await typography(page, "body");
    const pre = await preloads(page);
    check(`${path}: body font is public Inter`, /__Inter_/i.test(body.family) && !/adminInter/i.test(body.family), body.family);
    check(`${path}: body weight 400`, body.weight === "400", body.weight);
    check(`${path}: no admin font preloaded or fetched`, adminFontFiles.length > 0 && !pre.concat(fontRequests).some((u) => adminFontFiles.includes(u.split("/").pop()!)), { pre: pre.map((u) => u.split("/").pop()), fetched: fontRequests.map((u) => u.split("/").pop()) });
    await page.screenshot({ path: `${OUT}/public${path === "/" ? "-home" : path.replace(/\//g, "-")}.png` });
  }

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

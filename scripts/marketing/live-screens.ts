// ─── Live screens for the X architecture thread ────────────────────────────
//
//   npm run dev -- --port 3100                     # in one terminal
//   npx tsx scripts/marketing/live-screens.ts      # capture + compose
//   npx tsx scripts/marketing/live-screens.ts --cards   # re-compose only
//
// The diagram cards (architecture-cards.ts) say what each part of the
// platform does. These show it: the REAL screens from this repo — booking
// flow, booking desk, dispatch board, QC case file, payroll, host portal,
// commercial proposal — rendered with invented data and framed as
// 1600×900 cards (2×) in the same style, one per area.
//
// Output, in docs/architecture-cards/live/:
//   NN-<area>.png    the cards, in thread order
//   screens/*.png    every raw capture, unframed (desktop 2880 wide, phone 860)
//
// Same rules as the docs capture series: every Supabase call and API route
// is answered from scripts/docs/capture + live-screens-data.ts, nothing
// reaches production, and anything unanswered gets an empty 404 rather than
// falling through to a real server route.
//
// Environment (same as the other capture scripts):
//   DOCS_CAPTURE_BASE_URL   dev server (default http://localhost:3100)
//   DOCS_CAPTURE_CHROMIUM   Chromium binary when Playwright's build is absent
//   DOCS_CAPTURE_FONT_DIR   folder with @fontsource Inter, Plus Jakarta Sans and
//                           JetBrains Mono — without it, system fonts are used

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

import { handleApiRoute, handleSupabase, setCaptureOverlay, type CaptureOverlay } from "../docs/capture/supabase-mock";
import { DEMO_ADMIN, DEMO_CLEANER, DEMO_TOUR_PROGRESS } from "../docs/capture/demo-data";
import { CAPTURE_TIMEZONE } from "../docs/capture/day-to-day-scenario";
import { crop, encodePng, loadGuideImage } from "../docs/capture/guide-artwork";
import { JOB_OFFER_TOKEN, MANAGE_TOKEN, OVERLAYS, PROPOSAL_TOKEN } from "./live-screens-data";

const ROOT = resolve(__dirname, "../..");
const OUT = resolve(ROOT, "docs/architecture-cards/live");
const SCREENS = join(OUT, "screens");
const BASE_URL = process.env.DOCS_CAPTURE_BASE_URL || "http://localhost:3100";
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 430, height: 932 };
const FONT_HOST = "https://capture-fonts.local/";

// ─── Shots ─────────────────────────────────────────────────────────────────

type Role = "admin" | "cleaner" | "anon";

interface LiveShot {
  id: string;
  device: "desktop" | "phone";
  role: Role;
  url: string;
  /** Text that proves the screen has loaded its data. */
  waitFor: string;
  overlay?: CaptureOverlay;
  /** JS run before the app boots (seed localStorage). */
  seed?: string;
  setup?: (page: Page) => Promise<void>;
  /** Viewport height override (desktop shots that need more room). */
  height?: number;
  /** What the screen shows, for the README. */
  caption: string;
}

const BOOKING_SEED = `localStorage.setItem("bookingData", ${JSON.stringify(
  JSON.stringify({
    zipCode: "20814",
    homeSizeId: "2001_2500",
    serviceType: "",
    addOns: [],
    membershipPlan: "none",
    useCredit: false,
    serviceDate: "",
    timeSlot: "",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    serviceDuration: 0,
    paymentOption: "deposit",
    focusedAreas: [],
    conditionLevel: "normal",
  }),
)});`;

/** Scroll so the element holding `text` sits `offset` px below the top. */
async function scrollToText(page: Page, text: string, offset = 16) {
  const target = page.getByText(text, { exact: false }).first();
  await target.waitFor({ timeout: 15_000 });
  const box = await target.boundingBox();
  if (!box) return;
  await page.evaluate(
    ([y]) => window.scrollTo({ top: Math.max(0, window.scrollY + y), behavior: "instant" as ScrollBehavior }),
    [box.y - offset],
  );
  await page.waitForTimeout(300);
}

/** A VA's booking for the demo lead, so the form isn't showing placeholders. */
async function fillCustomer(page: Page) {
  await page.locator('input[placeholder="Anthony"]').first().fill("Rachel");
  await page.locator('input[placeholder="Sannie"]').first().fill("Amari");
  await page.locator('input[placeholder="customer@email.com"]').first().fill("rachel.amari@example.test");
  await page.locator('input[placeholder="+1 301-555-0199"]').first().fill("(555) 010-0121");
}

const SHOTS: LiveShot[] = [
  {
    id: "booking-zip",
    device: "phone",
    role: "anon",
    url: "/book/zip",
    waitFor: "Enter Your ZIP Code",
    setup: async (page) => {
      await page.locator('input[placeholder="12345"]').first().fill("20814");
      // Past the promo headline, which sits under the sticky header.
      await scrollToText(page, "Premium cleaning service", 132);
      // The before/after gallery hides itself when its photos aren't
      // deployed; let the lazy images fail so the shot shows the real state.
      await page
        .waitForFunction(() => !document.querySelector('img[alt="Novara cleaning result"]'), null, { timeout: 8_000 })
        .catch(() => {});
    },
    caption: "Customer booking, step 1: ZIP code.",
  },
  {
    id: "booking-size",
    device: "phone",
    role: "anon",
    url: "/book/sqft",
    waitFor: "How big is your home?",
    seed: BOOKING_SEED,
    caption: "Customer booking, step 2: home size.",
  },
  {
    id: "booking-price",
    device: "phone",
    role: "anon",
    url: "/book/offer",
    waitFor: "Deep Clean",
    seed: BOOKING_SEED,
    // The Deep Clean card: its "25% off" label matches the price. (The
    // Standard card's label says 25% while the price applies 15%.)
    setup: (page) => scrollToText(page, "MOST POPULAR", 150),
    caption: "Customer booking, step 3: an exact price for this home, deposit due today.",
  },
  {
    id: "booking-desk-quote",
    device: "desktop",
    role: "admin",
    url: "/admin/csr",
    waitFor: "Live quote",
    overlay: OVERLAYS.desk,
    height: 1300,
    setup: async (page) => {
      await fillCustomer(page);
      const zip = page.locator('input[placeholder="22201"]').first();
      await zip.fill("20814");
      await zip.blur().catch(() => {});
      await page.waitForTimeout(2500);
    },
    caption: "The booking desk's live quote: base rate, condition, zone and demand, each on its own line.",
  },
  {
    id: "recurring-manage",
    device: "phone",
    role: "anon",
    url: `/manage-recurring/${MANAGE_TOKEN}`,
    waitFor: "Priya",
    overlay: OVERLAYS.manageRecurring,
    caption: "The self-serve link members get by text: next visit, upcoming dates, skip, reschedule or pause.",
  },
  {
    id: "memberships-hub",
    device: "desktop",
    role: "admin",
    url: "/admin/recurring",
    waitFor: "Memberships & recurring",
    overlay: OVERLAYS.recurring,
    height: 1000,
    caption: "Memberships hub: MRR, ARR, lifetime value, at-risk members and each member's regular cleaner.",
  },
  {
    id: "booking-desk-lead",
    device: "desktop",
    role: "admin",
    url: "/admin/csr",
    waitFor: "Novara Internal Booking",
    overlay: OVERLAYS.leads,
    height: 1000,
    setup: async (page) => {
      // Load the lead (fills the form and closes the search), then search
      // again so the shot shows the results above the filled-in booking.
      const search = async () => {
        await page.getByRole("button", { name: /Search existing customer or lead/i }).click();
        await page.getByPlaceholder("Search by name, email, or phone…").fill("Ra");
        await page.getByText("Rachel", { exact: false }).first().waitFor({ timeout: 10_000 });
      };
      await search();
      await page.getByRole("button", { name: /Rachel Amari/ }).first().click();
      await page.waitForTimeout(2500);
      await search();
      await page.waitForTimeout(800);
    },
    caption: "The booking desk: a VA pulls up a new Facebook lead, scored hot, and books it from here.",
  },
  {
    id: "dispatch-board",
    device: "desktop",
    role: "admin",
    url: "/admin/operations?tab=dispatch",
    waitFor: "Awaiting your approval",
    overlay: OVERLAYS.dispatch,
    height: 1500,
    caption: "Dispatch board: jobs waiting for approval, offers out, crews confirmed and a live checklist.",
  },
  {
    id: "job-offer",
    device: "phone",
    role: "anon",
    url: `/cleaner/job-offer/${JOB_OFFER_TOKEN}`,
    waitFor: "we've got a job for you",
    overlay: OVERLAYS.jobOffer,
    caption: "The offer a cleaner opens from the text: pay, time, place, accept or decline.",
  },
  {
    id: "qc-issues",
    device: "desktop",
    role: "admin",
    url: "/admin/qc",
    waitFor: "Scratch on dining table",
    overlay: OVERLAYS.qc,
    caption: "Quality control: every complaint is a case with a severity, a status and its re-clean.",
  },
  {
    id: "qc-documentation",
    device: "desktop",
    role: "admin",
    url: "/admin/qc",
    waitFor: "Scratch on dining table",
    overlay: OVERLAYS.qc,
    setup: async (page) => {
      await page.locator("main").getByText("Documentation", { exact: true }).first().click();
      await page.getByText("STR-2207", { exact: false }).first().waitFor({ timeout: 15_000 });
    },
    caption: "Job documentation: every finished job's photos and checklist, archived to Drive with a dispute packet.",
  },
  {
    id: "qc-case-file",
    device: "desktop",
    role: "admin",
    url: "/admin/qc",
    waitFor: "Quality Control",
    overlay: OVERLAYS.qc,
    height: 1100,
    setup: async (page) => {
      await page.locator("main").getByText("Documentation", { exact: true }).first().click();
      await page.getByRole("button", { name: /Case file/i }).first().click();
      await page.getByText("Payment record", { exact: false }).first().waitFor({ timeout: 15_000 });
      await page.waitForTimeout(1200);
    },
    caption: "A live case file: signed agreement, Stripe payments, before/after photos, checklist and the dispute packet.",
  },
  {
    id: "payroll",
    device: "desktop",
    role: "admin",
    url: "/admin/payroll",
    waitFor: "Hannah Delacroix",
    overlay: OVERLAYS.payroll,
    height: 1250,
    setup: async (page) => {
      await page.getByRole("button", { name: /Hannah Delacroix/ }).first().click();
      await page.waitForTimeout(800);
    },
    caption: "Payroll: pick a finished job and the crew's pay is suggested from the job value and their rate.",
  },
  {
    id: "host-portal",
    device: "phone",
    role: "anon",
    url: "/partner/dashboard",
    waitFor: "Harbor Loft",
    overlay: OVERLAYS.host,
    caption: "The host portal: properties, upcoming turnovers and the card on file.",
  },
  {
    id: "commercial-proposal",
    device: "desktop",
    role: "anon",
    url: `/proposal/${PROPOSAL_TOKEN}`,
    waitFor: "Wrenfield Dental Group",
    overlay: OVERLAYS.proposal,
    height: 1200,
    caption: "A commercial proposal: per-site pricing from the walkthrough, monthly estimate and terms.",
  },
];

// ─── Fonts ─────────────────────────────────────────────────────────────────

const FONT_FILES = [
  ...[400, 500, 600, 700, 800].map((w) => `inter-latin-${w}-normal.woff2`),
  ...[500, 600, 700, 800].map((w) => `plus-jakarta-sans-latin-${w}-normal.woff2`),
  ...[400, 500, 600].map((w) => `jetbrains-mono-latin-${w}-normal.woff2`),
];

function loadFonts(): Map<string, Buffer> | null {
  const dir = process.env.DOCS_CAPTURE_FONT_DIR;
  if (!dir) return null;
  const fonts = new Map<string, Buffer>();
  for (const file of FONT_FILES) {
    const family = file.startsWith("inter") ? "inter" : file.startsWith("plus") ? "plus-jakarta-sans" : "jetbrains-mono";
    const hit = [join(dir, file), join(dir, `node_modules/@fontsource/${family}/files`, file), join(dir, `@fontsource/${family}/files`, file)].find(
      (p) => existsSync(p),
    );
    if (hit) fonts.set(file, readFileSync(hit));
  }
  if (fonts.size < FONT_FILES.length) {
    console.warn(`DOCS_CAPTURE_FONT_DIR is missing ${FONT_FILES.length - fonts.size} of ${FONT_FILES.length} font files.`);
  }
  return fonts.size ? fonts : null;
}

const FAMILY: Record<string, string> = { inter: "Inter", "plus-jakarta-sans": "Plus Jakarta Sans", "jetbrains-mono": "JetBrains Mono" };

function fontFaces(fonts: Map<string, Buffer> | null): string {
  if (!fonts) return "";
  return [...fonts.keys()]
    .map((file) => {
      const m = file.match(/^(inter|plus-jakarta-sans|jetbrains-mono)-latin-(\d+)-normal\.woff2$/)!;
      return `@font-face{font-family:"${FAMILY[m[1]]}";font-weight:${m[2]};font-style:normal;src:url(${FONT_HOST}${file}) format("woff2")}`;
    })
    .join("");
}

// ─── Browser ───────────────────────────────────────────────────────────────

function session(role: Role) {
  if (role === "anon") return null;
  const now = Math.floor(Date.now() / 1000);
  const cleaner = role === "cleaner";
  return {
    access_token: cleaner ? "demo-cleaner-access-token" : "demo-access-token",
    refresh_token: cleaner ? "demo-cleaner-refresh-token" : "demo-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user: {
      id: cleaner ? DEMO_CLEANER.id : DEMO_ADMIN.id,
      email: cleaner ? DEMO_CLEANER.email : DEMO_ADMIN.email,
      aud: "authenticated",
      role: "authenticated",
      app_metadata: { provider: "email" },
      user_metadata: cleaner ? { first_name: "Dana", last_name: "Whitfield" } : { first_name: "Demo", last_name: "Admin" },
      created_at: new Date(Date.now() - 86_400_000 * 120).toISOString(),
    },
  };
}

async function newPage(browser: Browser, shot: LiveShot, fonts: Map<string, Buffer> | null): Promise<{ page: Page; css: string }> {
  const viewport = shot.device === "phone" ? PHONE : { width: DESKTOP.width, height: shot.height ?? DESKTOP.height };
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    timezoneId: CAPTURE_TIMEZONE,
    locale: "en-US",
    reducedMotion: "reduce",
    colorScheme: "light",
  });
  // Registered first so it only answers what nothing else did: an API route
  // without a fixture gets an empty 404 instead of the real server route.
  await context.route("**/api/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await context.route("**/*.supabase.co/**", (route, request) => handleSupabase(route, request));
  await context.route("**/api/**", (route, request) => handleApiRoute(route, request));
  await context.route(`${FONT_HOST}**`, (route) => {
    const body = fonts?.get(route.request().url().slice(FONT_HOST.length));
    return body ? route.fulfill({ status: 200, contentType: "font/woff2", body }) : route.fulfill({ status: 404, body: "" });
  });
  await context.route(/googleapis|gstatic|google\.com|googletagmanager|facebook|stripe\.com|js\.stripe|maps\./, (route) => route.abort());

  const css = [
    "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;caret-color:transparent!important}",
    "html,body{scroll-behavior:auto!important}",
    // Not part of any screen being shown: the dev-mode overlay, toasts and
    // the floating help pill.
    'nextjs-portal,[data-sonner-toaster],[data-sonner-toast],button.fixed[data-tour="help-button"]{display:none!important}',
    fonts
      ? `${fontFaces(fonts)}html,body{--font-inter:"Inter",system-ui,sans-serif!important;--font-jakarta:"Plus Jakarta Sans","Inter",sans-serif!important}`
      : "",
  ].join("");

  // A string, not a function: tsx's __name() helper doesn't exist in the page.
  await context.addInitScript({
    content: `(function () {
      var s = ${JSON.stringify(session(shot.role))};
      if (s) localStorage.setItem("sb-sxdraeptzuamsgjcvfeg-auth-token", JSON.stringify(s));
      localStorage.setItem("novara.tours.progress.v1.anon", ${JSON.stringify(JSON.stringify(DEMO_TOUR_PROGRESS))});
      ${shot.seed ?? ""}
      var el = document.createElement("style");
      el.textContent = ${JSON.stringify(css)};
      function attach() { var root = document.head || document.documentElement; if (!root) return false; root.appendChild(el); return true; }
      if (!attach()) new MutationObserver(function (_, o) { if (attach()) o.disconnect(); }).observe(document, { childList: true, subtree: true });
    })();`,
  });

  const page = await context.newPage();
  page.on("pageerror", (err) => {
    const msg = err.message.split("\n")[0];
    if (!/server-rendered HTML|Hydration/i.test(msg)) console.log(`      [page error] ${msg}`);
  });
  return { page, css };
}

async function capture(browser: Browser, shot: LiveShot, fonts: Map<string, Buffer> | null): Promise<string | null> {
  setCaptureOverlay(shot.overlay ?? null);
  const { page, css } = await newPage(browser, shot, fonts);
  try {
    await page.goto(`${BASE_URL}${shot.url}`, { waitUntil: "commit", timeout: 120_000 });
    await page.getByText(shot.waitFor, { exact: false }).first().waitFor({ timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.addStyleTag({ content: css });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(900);
    if (shot.setup) {
      await shot.setup(page);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(700);
    }
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    const file = join(SCREENS, `${shot.id}.png`);
    await page.screenshot({ path: file });
    return file;
  } catch (err) {
    const debug = join(SCREENS, `_failed-${shot.id}.png`);
    await page.screenshot({ path: debug, fullPage: true }).catch(() => {});
    console.log(`      FAILED: ${err instanceof Error ? err.message.split("\n")[0] : String(err)} (page saved to ${debug})`);
    return null;
  } finally {
    await page.context().close();
    setCaptureOverlay(null);
  }
}

// ─── Cards ─────────────────────────────────────────────────────────────────
//
// 1600×900 like the diagram cards: text on the left, the real screens on the
// right in a browser or phone frame. Crops are in CSS pixels of the capture
// (desktop 1440 wide, phone 430), so they survive a recapture as long as the
// screen's layout doesn't move.

const CARD = { width: 1600, height: 900 };
const ASSET = "https://card-assets.local/";
const C = {
  bg: "#0B0817",
  panel: "#151129",
  line: "#2C2550",
  ink: "#F4F1FF",
  muted: "#A9A2CB",
  dim: "#6F6894",
  violet: "#7C4DFF",
  lav: "#C4B5FD",
  gold: "#E2B94B",
};

interface Crop {
  shot: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A visual placed on the right-hand stage (984×788, origin at its top-left). */
type Visual =
  | { kind: "browser"; crop: Crop; url: string; left: number; top: number; width: number }
  | { kind: "panel"; crop: Crop; left: number; top: number; width: number }
  | {
      kind: "phone";
      shot: string;
      left: number;
      top: number;
      height: number;
      label?: string;
      /** CSS px of the phone viewport to show, from the top (default: all 932). */
      screenHeight?: number;
    };

interface LiveCard {
  slug: string;
  /** The diagram card this one follows in the thread. */
  pairs: string;
  title: string;
  line: string;
  shows: Array<{ t: string; c: string }>;
  visuals: Visual[];
  post: string;
}

const STAGE = { left: 560, top: 56, width: 984, height: 788 };

const LIVE_CARDS: LiveCard[] = [
  {
    slug: "customer-booking",
    pairs: "01-customer-booking.png",
    title: "Booking, start to\nfinish on a phone",
    line: "ZIP, home size, then an exact price with the deposit due today. No call, no quote request.",
    shows: [
      { t: "ZIP checked against the service area", c: "service_coverage_zones" },
      { t: "Price from the shared price list", c: "_shared/pricing.ts" },
      { t: "Deposit now, balance after the clean", c: "create-payment-intent" },
    ],
    visuals: [
      // 800 of the 932 px: the Deep Clean card ends there, before the next
      // card's discount label (which overstates the bundle's saving).
      { kind: "phone", shot: "booking-zip", left: 0, top: 136, height: 570, screenHeight: 800, label: "1 · ZIP code" },
      { kind: "phone", shot: "booking-size", left: 334, top: 136, height: 570, screenHeight: 800, label: "2 · Home size" },
      { kind: "phone", shot: "booking-price", left: 668, top: 136, height: 570, screenHeight: 800, label: "3 · Exact price" },
    ],
    post: "What the customer actually sees: ZIP → home size → an exact price with the deposit due today. Three screens, no phone call.",
  },
  {
    slug: "pricing-engine",
    pairs: "02-pricing-engine.png",
    title: "Every quote\nshows its math",
    line: "The booking desk's live quote. Type a ZIP and the zone lands; every layer gets its own line.",
    shows: [
      { t: "Base rate by home size", c: "dynamic_pricing_config_versions" },
      { t: "× condition, × zone by ZIP", c: "pricing_zone_zips" },
      { t: "Demand runs in shadow mode", c: "quote-dynamic-price" },
    ],
    visuals: [
      {
        kind: "browser",
        crop: { shot: "booking-desk-quote", x: 280, y: 268, w: 1136, h: 596 },
        url: "admin.novaracleaning.com/admin/csr",
        left: 0,
        top: 104,
        width: 984,
      },
    ],
    post: "Here's the engine in the app. Type a ZIP on the booking desk and the quote rebuilds itself: base rate, condition, zone, demand, each on its own line.",
  },
  {
    slug: "recurring-revenue",
    pairs: "03-recurring-revenue.png",
    title: "Memberships that\nrun themselves",
    line: "One hub for MRR, lifetime value and who's slipping. Members manage their own plan from a link we text them.",
    shows: [
      { t: "MRR, ARR, LTV and at-risk", c: "admin-memberships" },
      { t: "Next visit booked, same cleaner", c: "customer-recurring-generate" },
      { t: "Skip, reschedule or pause by link", c: "manage-recurring-schedule" },
    ],
    visuals: [
      {
        kind: "browser",
        crop: { shot: "memberships-hub", x: 297, y: 205, w: 1103, h: 772 },
        url: "admin.novaracleaning.com/admin/recurring",
        left: 0,
        top: 40,
        width: 780,
      },
      { kind: "phone", shot: "recurring-manage", left: 700, top: 168, height: 600 },
    ],
    post: "Members get a link by text to skip, reschedule or pause on their own. We get one screen with MRR, lifetime value and who's at risk.",
  },
  {
    slug: "speed-to-lead",
    pairs: "04-speed-to-lead.png",
    title: "Every lead is\none search away",
    line: "Leads arrive scored and tagged by source. A VA pulls one up on the booking desk and books it with a live price.",
    shows: [
      { t: "Facebook, Google LSA, website", c: "lead-intake" },
      { t: "Scored hot, warm or cold", c: "leads.lead_score" },
      { t: "Booked from the same screen", c: "book-as-va" },
    ],
    visuals: [
      {
        kind: "browser",
        crop: { shot: "booking-desk-lead", x: 262, y: 66, w: 1160, h: 700 },
        url: "admin.novaracleaning.com/admin/csr",
        left: 0,
        top: 78,
        width: 984,
      },
    ],
    post: "Leads arrive scored and tagged by source: Facebook, Google, the website. Our VAs pull them up on the booking desk and quote them live.",
  },
  {
    slug: "dispatch",
    pairs: "05-dispatch.png",
    title: "One approval,\nthen offers go out",
    line: "Jobs wait on the board until someone approves. Then ranked cleaners get a text, and the first to accept gets the job.",
    shows: [
      { t: "Approval queue", c: "Dispatch console" },
      { t: "Ranked SMS offers", c: "dispatch-job" },
      { t: "Accept or decline in one tap", c: "accept-job-offer" },
    ],
    visuals: [
      {
        kind: "browser",
        crop: { shot: "dispatch-board", x: 274, y: 261, w: 1114, h: 905 },
        url: "admin.novaracleaning.com/admin/operations?tab=dispatch",
        left: 0,
        top: 46,
        width: 770,
      },
      { kind: "phone", shot: "job-offer", left: 678, top: 120, height: 640 },
    ],
    post: "Dispatch, live: the board on the left, the text a cleaner opens on the right. One approval, then the first to accept gets the job.",
  },
  {
    slug: "quality-control",
    pairs: "06-quality-control.png",
    title: "Every complaint\nbecomes a case file",
    line: "Issues tracked by severity and status. The case file pulls the signed agreement, Stripe payments, photos and checklist when it opens.",
    shows: [
      { t: "Issues, severity, re-cleans", c: "qc-issues" },
      { t: "Case file built live", c: "qc-case-file" },
      { t: "Photos archived to Drive", c: "job_documentation" },
    ],
    visuals: [
      {
        kind: "browser",
        crop: { shot: "qc-issues", x: 305, y: 228, w: 1087, h: 576 },
        url: "admin.novaracleaning.com/admin/qc",
        left: 0,
        top: 38,
        width: 600,
      },
      {
        kind: "browser",
        crop: { shot: "qc-documentation", x: 305, y: 444, w: 1087, h: 444 },
        url: "admin.novaracleaning.com/admin/qc · Documentation",
        left: 0,
        top: 420,
        width: 600,
      },
      { kind: "panel", crop: { shot: "qc-case-file", x: 769, y: 22, w: 671, h: 1076 }, left: 522, top: 44, width: 462 },
    ],
    post: "When something goes wrong, nobody digs through old texts. The case file pulls the agreement, the Stripe payments, the photos and the checklist on its own.",
  },
  {
    slug: "back-office",
    pairs: "07-back-office.png",
    title: "Payroll starts\nfrom the job",
    line: "Pick a finished job: pay is suggested from its value and the cleaner's rate, with our margin right beside it.",
    shows: [
      { t: "Suggested pay per crew member", c: "/api/payroll/custom" },
      { t: "Contractor texted and emailed", c: "Confirm & notify" },
      { t: "Every payout in one ledger", c: "manual_payouts" },
    ],
    visuals: [
      {
        kind: "browser",
        crop: { shot: "payroll", x: 280, y: 370, w: 1136, h: 832 },
        url: "admin.novaracleaning.com/admin/payroll",
        left: 0,
        top: 44,
        width: 984,
      },
    ],
    post: "Payroll starts from the finished job. Pay is suggested from the job's value and the cleaner's rate, and our margin sits right next to it.",
  },
  {
    slug: "other-channels",
    pairs: "08-other-channels.png",
    title: "Hosts and offices\nget a front door",
    line: "Airbnb hosts request turnovers and see their card on file. Offices get a proposal priced from the walkthrough.",
    shows: [
      { t: "Host portal", c: "partner.novaracleaning.com" },
      { t: "Walkthrough-priced proposal", c: "commercial.novaracleaning.com" },
      { t: "Signed after it's accepted", c: "DocuSeal" },
    ],
    visuals: [
      {
        kind: "browser",
        crop: { shot: "commercial-proposal", x: 350, y: 140, w: 740, h: 800 },
        url: "commercial.novaracleaning.com/proposal/…",
        left: 0,
        top: 40,
        width: 640,
      },
      { kind: "phone", shot: "host-portal", left: 678, top: 104, height: 640 },
    ],
    post: "Same rails, different front doors: Airbnb hosts get a portal for their turnovers, offices get a proposal priced from the walkthrough.",
  },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The crop of a capture, scaled to `width` CSS px. */
function cropHtml(crop: Crop, width: number): { html: string; height: number } {
  const full = SHOTS.find((s) => s.id === crop.shot)?.device === "phone" ? PHONE.width : DESKTOP.width;
  const scale = width / crop.w;
  const height = Math.round(crop.h * scale);
  const img = `<img src="${ASSET}screens/${crop.shot}.png" style="width:${full * scale}px;left:${-crop.x * scale}px;top:${-crop.y * scale}px">`;
  return { html: `<div class="shot" style="width:${width}px;height:${height}px">${img}</div>`, height };
}

function visualHtml(v: Visual): string {
  if (v.kind === "phone") {
    const shown = v.screenHeight ?? PHONE.height;
    const screenH = v.height - 20;
    const screenW = Math.round((screenH * PHONE.width) / shown);
    const label = v.label ? `<div class="plabel">${esc(v.label)}</div>` : "";
    return `<div class="phone" style="left:${v.left}px;top:${v.top}px;width:${screenW + 20}px">${label}<div class="screen" style="width:${screenW}px;height:${screenH}px"><img src="${ASSET}screens/${v.shot}.png"></div></div>`;
  }
  const { html } = cropHtml(v.crop, v.width);
  if (v.kind === "panel") return `<div class="panel" style="left:${v.left}px;top:${v.top}px">${html}</div>`;
  return `<div class="browser" style="left:${v.left}px;top:${v.top}px;width:${v.width}px"><div class="bar"><i></i><i></i><i></i><span class="url">${esc(v.url)}</span></div>${html}</div>`;
}

function cardHtml(card: LiveCard, index: number, fonts: Map<string, Buffer> | null): string {
  const n = String(index + 1).padStart(2, "0");
  const total = String(LIVE_CARDS.length).padStart(2, "0");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaces(fonts).replaceAll(FONT_HOST, `${ASSET}fonts/`)}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${CARD.width}px;height:${CARD.height}px;overflow:hidden}
body{background:${C.bg};color:${C.ink};font-family:"Inter",system-ui,sans-serif;position:relative;-webkit-font-smoothing:antialiased}
body::before{content:"";position:absolute;inset:0;background-image:radial-gradient(rgba(196,181,253,.10) 1.2px,transparent 1.2px);background-size:28px 28px;mask-image:linear-gradient(180deg,rgba(0,0,0,.9),rgba(0,0,0,.25))}
body::after{content:"";position:absolute;right:-160px;top:-200px;width:980px;height:980px;border-radius:50%;background:radial-gradient(closest-side,rgba(92,15,254,.30),rgba(92,15,254,0))}
.left{position:absolute;left:72px;top:64px;bottom:56px;width:460px;z-index:2;display:flex;flex-direction:column}
.top{font:500 15px/1 "JetBrains Mono",monospace;letter-spacing:.14em;color:${C.dim}}
.top b{color:${C.lav};font-weight:500}
.live{display:inline-flex;align-items:center;gap:8px;margin-top:40px;font:500 14px/1 "JetBrains Mono",monospace;letter-spacing:.16em;color:${C.gold}}
.live::before{content:"";width:9px;height:9px;border-radius:50%;background:#34D399;box-shadow:0 0 0 4px rgba(52,211,153,.18)}
h1{margin-top:18px;font:800 46px/1.08 "Plus Jakarta Sans",sans-serif;letter-spacing:-.02em;white-space:nowrap}
.line{margin-top:20px;font-size:21px;line-height:1.45;color:${C.muted}}
.shows{margin-top:30px;display:flex;flex-direction:column;gap:16px}
.shows div{border-left:2px solid ${C.violet};padding-left:16px}
.shows b{display:block;font:600 18px/1.3 "Inter",sans-serif}
.shows code{display:block;margin-top:5px;font:500 14px/1.2 "JetBrains Mono",monospace;color:${C.lav};overflow-wrap:anywhere}
.foot{margin-top:auto;display:flex;flex-direction:column;gap:12px}
.brand{display:flex;align-items:center;gap:12px;font:800 20px/1 "Plus Jakarta Sans",sans-serif;letter-spacing:.04em}
.brand img{width:36px;height:36px;border-radius:9px}
.brand span{color:${C.dim};font:500 15px/1 "JetBrains Mono",monospace;letter-spacing:.06em;margin-left:4px}
.demo{font:500 13px/1.4 "JetBrains Mono",monospace;letter-spacing:.06em;color:${C.dim}}
.pager{position:absolute;right:56px;top:64px;font:500 15px/1 "JetBrains Mono",monospace;letter-spacing:.12em;color:${C.dim};z-index:2}
.stage{position:absolute;left:${STAGE.left}px;top:${STAGE.top}px;width:${STAGE.width}px;height:${STAGE.height}px;z-index:1}
.shot{position:relative;overflow:hidden;background:#fff}
.shot img{position:absolute;max-width:none}
.browser{position:absolute;border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 0 0 1px rgba(196,181,253,.22),0 40px 90px -30px rgba(0,0,0,.85),0 0 80px -20px rgba(124,77,255,.35)}
.bar{height:34px;background:#1B1535;display:flex;align-items:center;gap:7px;padding:0 14px}
.bar i{width:11px;height:11px;border-radius:50%;background:#3A3264}
.bar .url{margin-left:12px;flex:1;height:22px;border-radius:7px;background:#100C22;color:${C.muted};font:500 12px/22px "JetBrains Mono",monospace;padding:0 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.panel{position:absolute;border-radius:16px;overflow:hidden;box-shadow:0 0 0 1px rgba(196,181,253,.28),0 40px 90px -24px rgba(0,0,0,.9),0 0 90px -20px rgba(124,77,255,.45)}
.phone{position:absolute;padding:10px;border-radius:44px;background:#100C20;box-shadow:0 0 0 1.5px rgba(196,181,253,.30),0 40px 90px -24px rgba(0,0,0,.9),0 0 90px -24px rgba(124,77,255,.5)}
.phone .screen{position:relative;border-radius:34px;overflow:hidden;background:#fff}
.phone .screen img{width:100%;display:block}
.plabel{position:absolute;left:0;right:0;top:-40px;text-align:center;font:500 15px/1 "JetBrains Mono",monospace;letter-spacing:.1em;color:${C.lav}}
</style></head><body>
<div class="left">
  <div class="top"><b>NOVARA OS</b> · IN THE APP</div>
  <div class="live">LIVE SCREENS</div>
  <h1>${card.title.split("\n").map(esc).join("<br>")}</h1>
  <p class="line">${esc(card.line)}</p>
  <div class="shows">${card.shows.map((s) => `<div><b>${esc(s.t)}</b><code>${esc(s.c)}</code></div>`).join("")}</div>
  <div class="foot"><div class="brand"><img src="${ASSET}logo.png" alt="">NOVARA<span>novaracleaning.com</span></div><div class="demo">Real screens · demo data</div></div>
</div>
<div class="pager">${n} / ${total}</div>
<div class="stage">${card.visuals.map(visualHtml).join("")}</div>
</body></html>`;
}

async function renderCards(browser: Browser, fonts: Map<string, Buffer> | null) {
  const guide = await loadGuideImage(resolve(ROOT, "public/cleaner/guide-pdfs/day-to-day-job-operations.pdf"));
  const logo = encodePng(crop(guide, 140, 82, 164, 164));
  for (const name of existsSync(OUT) ? readdirSync(OUT) : []) {
    if (/^\d\d-.*\.png$/.test(name)) rmSync(join(OUT, name));
  }

  for (const [i, card] of LIVE_CARDS.entries()) {
    const file = `${String(i + 1).padStart(2, "0")}-${card.slug}.png`;
    const missing = card.visuals
      .map((v) => (v.kind === "phone" ? v.shot : v.crop.shot))
      .filter((shot) => !existsSync(join(SCREENS, `${shot}.png`)));
    if (missing.length) {
      console.log(`  ${file.padEnd(28)} SKIPPED (missing ${missing.join(", ")})`);
      continue;
    }
    const context = await browser.newContext({ viewport: CARD, deviceScaleFactor: 2 });
    await context.route(`${ASSET}**`, (route) => {
      const name = route.request().url().slice(ASSET.length);
      if (name === "logo.png") return route.fulfill({ status: 200, contentType: "image/png", body: logo });
      if (name.startsWith("screens/")) {
        const path = join(SCREENS, name.slice("screens/".length));
        return existsSync(path)
          ? route.fulfill({ status: 200, contentType: "image/png", body: readFileSync(path) })
          : route.fulfill({ status: 404, body: "" });
      }
      const font = name.startsWith("fonts/") ? fonts?.get(name.slice(6)) : undefined;
      return font ? route.fulfill({ status: 200, contentType: "font/woff2", body: font }) : route.fulfill({ status: 404, body: "" });
    });
    const page = await context.newPage();
    await page.setContent(cardHtml(card, i, fonts), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    // Anything that leaves the card, or a left column that runs into the footer.
    const problems = await page.evaluate(
      ([w, h]) => {
        const out: string[] = [];
        for (const el of document.querySelectorAll(".browser, .panel, .phone")) {
          const r = el.getBoundingClientRect();
          if (r.right > w - 24 || r.bottom > h - 24 || r.left < 0 || r.top < 0) out.push(`${el.className} off-card`);
        }
        const shows = document.querySelector(".shows")!.getBoundingClientRect();
        const foot = document.querySelector(".foot")!.getBoundingClientRect();
        if (shows.bottom > foot.top - 16) out.push("left column runs into the footer");
        const h1 = document.querySelector("h1")!;
        if (h1.scrollWidth > (document.querySelector(".left") as HTMLElement).clientWidth) out.push("title wider than its column");
        const pager = document.querySelector(".pager")!.getBoundingClientRect();
        for (const el of document.querySelectorAll(".browser, .panel, .phone")) {
          const r = el.getBoundingClientRect();
          if (r.top < pager.bottom + 8 && r.right > pager.left) out.push(`${el.className} under the page number`);
        }
        return out;
      },
      [CARD.width, CARD.height],
    );
    await page.screenshot({ path: join(OUT, file) });
    await context.close();
    console.log(`  ${file.padEnd(28)} ${problems.length ? problems.join("; ") : "ok"}`);
  }
}

function writeReadme() {
  const shotRows = SHOTS.map((s) => `| \`screens/${s.id}.png\` | ${s.device} | ${s.caption} |`);
  const lines = [
    "# Live screens for X",
    "",
    "The real app, one card per area of the platform breakdown. Each pairs with the diagram card of",
    "the same number in `../` — post the diagram, then the live card, so the thread goes",
    "*here's how it works* → *here it is running*. 1600×900 (X's in-feed size), rendered at 2×.",
    "",
    "Every screen is the real component from this repo. **The data is invented**: names, addresses,",
    "amounts and photos come from `scripts/marketing/live-screens-data.ts` and",
    "`scripts/docs/capture/demo-data.ts`, and the production database is never contacted. Each card",
    "says \"Real screens · demo data\" in the corner; keep that line if you crop.",
    "",
    "| Card | Follows | Draft post |",
    "| --- | --- | --- |",
    ...LIVE_CARDS.map(
      (c, i) => `| \`${String(i + 1).padStart(2, "0")}-${c.slug}.png\` | \`../${c.pairs}\` | ${c.post.replace(/\|/g, "\\|")} |`,
    ),
    "",
    "## Raw screens",
    "",
    "Unframed captures (desktop 2880 px wide, phone 860 px) for your own layouts or replies.",
    "",
    "| File | Device | What it shows |",
    "| --- | --- | --- |",
    ...shotRows,
    "",
    "## Before you post a raw screen",
    "",
    "The cards are cropped around three things on the real screens that you may not want public.",
    "If you post a raw screen instead, check these first:",
    "",
    "- `screens/booking-price.png` — the bottom edge shows the next card's \"25% off\" badge. On the",
    "  live site that label sits on the Deep + Standard combo, which is 20% off its list price (and",
    "  the Standard card says 25% while applying 15%). The card crops at the Deep Clean card, whose",
    "  25% is right.",
    "- `screens/dispatch-board.png` — the two header switches render half-styled (the HeroUI theme",
    "  package isn't in Tailwind's scan path in this install). The card starts below them.",
    "- `screens/payroll.png` — the page's own header says Stripe transfers for job payouts are",
    "  paused. The card starts at the totals row.",
    "",
    "## Regenerating",
    "",
    "```bash",
    "npm run dev -- --port 3100                          # in one terminal",
    "npx tsx scripts/marketing/live-screens.ts           # capture + cards",
    "npx tsx scripts/marketing/live-screens.ts --cards   # cards only, from the saved screens",
    "```",
    "",
    "Set `DOCS_CAPTURE_FONT_DIR` to a folder with the @fontsource Inter, Plus Jakarta Sans and JetBrains",
    "Mono files when Google Fonts can't be reached, so the screens use the real brand fonts.",
    "",
  ];
  writeFileSync(join(OUT, "README.md"), lines.join("\n"));
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const only = args.filter((a) => !a.startsWith("--"));
  const fonts = loadFonts();
  const browser = await chromium.launch({ executablePath: process.env.DOCS_CAPTURE_CHROMIUM || undefined });

  if (!args.includes("--cards")) {
    try {
      const res = await fetch(`${BASE_URL}/admin/auth`);
      if (!res.ok) throw new Error(`status ${res.status}`);
    } catch (err) {
      console.error(`Cannot reach the dev server at ${BASE_URL} (${err instanceof Error ? err.message : err}). Start it with: npm run dev -- --port 3100`);
      process.exit(1);
    }
    mkdirSync(SCREENS, { recursive: true });
    const shots = only.length ? SHOTS.filter((s) => only.includes(s.id)) : SHOTS;
    let failed = 0;
    for (const shot of shots) {
      process.stdout.write(`  ${shot.id.padEnd(24)} `);
      const file = await capture(browser, shot, fonts);
      if (file) console.log("ok");
      else failed++;
    }
    if (failed) process.exitCode = 1;
  }

  await renderCards(browser, fonts);
  writeReadme();
  await browser.close();
}

main();

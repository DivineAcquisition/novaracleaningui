// ─── Admin workspace screenshot capture ────────────────────────────────────
//
//   npm run docs:capture                 # everything
//   npm run docs:capture -- bookings     # one guide's shots
//
// Requires the dev server on http://localhost:3100 (npm run dev -- --port 3100).
//
// What this does and does not do:
//   • It renders the REAL admin components from this repo. Nothing is mocked
//     up, drawn, or reconstructed from a spec — if a label moved, the new
//     label is what lands in the image.
//   • It never contacts the production database. Every Supabase call is
//     intercepted and answered from scripts/docs/capture/demo-data.ts, so no
//     real customer, contractor or payment detail can reach a screenshot.
//   • Images are written to docs/admin-workspace/screenshots/, which is NOT
//     under public/ — they are served only through the authenticated docs
//     route, so they are no more reachable than the guides themselves.
//
// A manifest is written alongside the images recording what was captured,
// when, and which callouts could not be found. Missing callouts are a signal
// that the screen changed and the matching guide step needs a second look.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

import { drawCallouts, clearCallouts, redact } from "./capture/annotate";
import { SHOTS, type Shot } from "./capture/shots";
import { handleApiRoute, handleSupabase } from "./capture/supabase-mock";
import { DEMO_ADMIN } from "./capture/demo-data";

const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "docs/admin-workspace/screenshots");
const MANIFEST = resolve(OUT_DIR, "manifest.json");
const BASE_URL = process.env.DOCS_CAPTURE_BASE_URL || "http://localhost:3100";

const VIEWPORT = { width: 1440, height: 900 };

/** The session supabase-js expects to find in localStorage. */
function demoSession() {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: "demo-access-token",
    refresh_token: "demo-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user: {
      id: DEMO_ADMIN.id,
      email: DEMO_ADMIN.email,
      aud: "authenticated",
      role: "authenticated",
      app_metadata: { provider: "email" },
      user_metadata: { first_name: "Demo", last_name: "Admin" },
      created_at: new Date(Date.now() - 86_400_000 * 90).toISOString(),
    },
  };
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2, // retina-sharp text in the guides
    reducedMotion: "reduce",
    colorScheme: "light",
  });

  // Everything that would leave the machine is intercepted or blocked.
  await context.route("**/*.supabase.co/**", (route, request) => handleSupabase(route, request));
  await context.route("**/api/**", (route, request) => handleApiRoute(route, request));
  await context.route(
    /googleapis|gstatic|google\.com|googletagmanager|facebook|stripe\.com|js\.stripe|connect\.facebook/,
    (route) => route.abort(),
  );

  await context.addInitScript(
    ([key, session]) => {
      window.localStorage.setItem(key as string, JSON.stringify(session));
      // Freeze animations so repeat captures are pixel-stable.
      const style = document.createElement("style");
      style.textContent =
        "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important}";
      document.documentElement.appendChild(style);
    },
    [`sb-sxdraeptzuamsgjcvfeg-auth-token`, demoSession()] as const,
  );

  return context.newPage();
}

async function settle(page: Page, shot: Shot) {
  await page.waitForLoadState("domcontentloaded");
  if (shot.waitForText) {
    await page
      .getByText(shot.waitForText, { exact: false })
      .first()
      .waitFor({ timeout: 25_000 })
      .catch(() => {});
  }
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  // Let debounced quote fetches (350 ms) and chart mounts land.
  await page.waitForTimeout(1500);
}

async function capture(browser: Browser, shot: Shot) {
  const page = await newPage(browser);
  const problems: string[] = [];
  try {
    await page.setViewportSize({ width: VIEWPORT.width, height: shot.height ?? VIEWPORT.height });
    await page.goto(`${BASE_URL}${shot.url}`, { waitUntil: "commit", timeout: 45_000 });
    await settle(page, shot);

    if (shot.setup) {
      await shot.setup(page);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(800);
    }

    // Belt and braces: the harness already serves invented data, but blur the
    // signed-in identity chrome so an image can never carry a real operator.
    await redact(page, []);

    await clearCallouts(page);
    // When the shot is cropped, badges must stay inside the crop or they get
    // sliced off the edge of the image.
    const cropBounds = shot.clipSelector
      ? await page
          .locator(shot.clipSelector)
          .first()
          .boundingBox()
          .catch(() => null)
      : null;
    const { drawn, missing } = await drawCallouts(
      page,
      shot.callouts,
      cropBounds ? { x: cropBounds.x, width: cropBounds.width } : undefined,
    );
    if (missing.length) {
      problems.push(...missing.map((m) => `callout not found: ${m}`));
    }

    const path = resolve(OUT_DIR, `${shot.id}.png`);
    if (shot.clipSelector) {
      const target = page.locator(shot.clipSelector).first();
      if ((await target.count()) === 0) {
        throw new Error(`clipSelector matched nothing: ${shot.clipSelector}`);
      }
      await target.screenshot({ path });
    } else {
      await page.screenshot({ path, fullPage: Boolean(shot.fullPage) });
    }

    return {
      id: shot.id,
      doc: shot.doc,
      caption: shot.caption,
      url: shot.url,
      file: `${shot.id}.png`,
      callouts: drawn.map((d) => ({ n: d.n, label: d.label })),
      problems,
      capturedAt: new Date().toISOString(),
    };
  } catch (err) {
    problems.push(`capture failed: ${err instanceof Error ? err.message : String(err)}`);
    return {
      id: shot.id,
      doc: shot.doc,
      caption: shot.caption,
      url: shot.url,
      file: null,
      callouts: [],
      problems,
      capturedAt: new Date().toISOString(),
    };
  } finally {
    await page.context().close();
  }
}

async function main() {
  const filter = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const shots = filter.length
    ? SHOTS.filter((s) => filter.includes(s.doc) || filter.includes(s.id))
    : SHOTS;

  if (shots.length === 0) {
    console.error(`No shots matched ${filter.join(", ")}`);
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  // Fail loudly if the dev server isn't up — a silent run producing blank
  // images would be worse than no images.
  try {
    const res = await fetch(`${BASE_URL}/admin/auth`, { method: "GET" });
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (err) {
    console.error(
      `Cannot reach the dev server at ${BASE_URL} (${err instanceof Error ? err.message : err}).\n` +
        `Start it first:  npm run dev -- --port 3100`,
    );
    process.exit(1);
  }

  const browser = await chromium.launch();
  const results = [];
  for (const shot of shots) {
    process.stdout.write(`  ${shot.id.padEnd(34)} `);
    const result = await capture(browser, shot);
    if (!result.file) console.log("FAILED");
    else if (result.problems.length) console.log(`ok (${result.problems.length} callout(s) not found)`);
    else console.log(`ok (${result.callouts.length} callouts)`);
    results.push(result);
  }
  await browser.close();

  const manifest = {
    _readme:
      "GENERATED by npm run docs:capture. Captured against the real admin components with invented data only — the production database is never contacted. Recapture whenever a guide is re-verified.",
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    viewport: VIEWPORT,
    shots: results,
  };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

  const failed = results.filter((r) => !r.file);
  const partial = results.filter((r) => r.file && r.problems.length);
  console.log(`\n${results.length - failed.length}/${results.length} captured → ${OUT_DIR}`);
  if (partial.length) {
    console.log(`\n${partial.length} shot(s) had callouts that could not be located:`);
    for (const p of partial) console.log(`  ${p.id}: ${p.problems.join("; ")}`);
  }
  if (failed.length) {
    console.log(`\n${failed.length} shot(s) failed:`);
    for (const f of failed) console.log(`  ${f.id}: ${f.problems.join("; ")}`);
    process.exitCode = 1;
  }
}

main();

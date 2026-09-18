// ─── Admin workspace screenshot capture ────────────────────────────────────
//
//   npm run docs:capture                 # admin workspace shots
//   npm run docs:capture -- bookings     # one guide's shots
//   npm run docs:capture -- new-hire     # New Hire Series contractor shots
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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

import { drawCallouts, clearCallouts, redact, drawCaption } from "./capture/annotate";
import { SHOTS, type Shot } from "./capture/shots";
import { NEW_HIRE_SHOTS, NEW_HIRE_SKIPPED, NEW_HIRE_ROOT } from "./capture/new-hire-shots";
import { handleApiRoute, handleSupabase, resetNewHireCaptureState } from "./capture/supabase-mock";
import { DEMO_ADMIN, DEMO_CLEANER, DEMO_TOKENS, DEMO_TOUR_PROGRESS } from "./capture/demo-data";

const ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(ROOT, "docs/admin-workspace/screenshots");
const MANIFEST = resolve(OUT_DIR, "manifest.json");
const BASE_URL = process.env.DOCS_CAPTURE_BASE_URL || "http://localhost:3100";

const VIEWPORT = { width: 1440, height: 900 };

/** The session supabase-js expects to find in localStorage. */
function demoSession(role: Shot["role"] = "admin") {
  const now = Math.floor(Date.now() / 1000);
  if (role === "cleaner") {
    return {
      access_token: "demo-cleaner-access-token",
      refresh_token: "demo-cleaner-refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: now + 3600,
      user: {
        id: DEMO_CLEANER.id,
        email: DEMO_CLEANER.email,
        aud: "authenticated",
        role: "authenticated",
        app_metadata: { provider: "email" },
        user_metadata: { first_name: "Dana", last_name: "Whitfield" },
        created_at: new Date(Date.now() - 86_400_000 * 200).toISOString(),
      },
    };
  }
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

async function newPage(browser: Browser, shot?: Shot): Promise<Page> {
  const viewport = shot?.viewport ?? VIEWPORT;
  const context = await browser.newContext({
    viewport,
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
    ([key, session, tourProgress]) => {
      window.localStorage.setItem(key as string, JSON.stringify(session));
      // Dana has already finished the walkthroughs — capture the working
      // screens, not the first-login overlay.
      window.localStorage.setItem(
        "novara.tours.progress.v1.anon",
        JSON.stringify(tourProgress),
      );
      // Freeze animations so repeat captures are pixel-stable. Hide toasts
      // so a transient "sent" chip can't cover the screen being documented.
      const style = document.createElement("style");
      style.textContent =
        "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important}[data-sonner-toaster],[data-sonner-toast]{display:none!important}";
      document.documentElement.appendChild(style);
    },
    [`sb-sxdraeptzuamsgjcvfeg-auth-token`, demoSession(shot?.role), DEMO_TOUR_PROGRESS] as const,
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
  if (shot.series === "new-hire") {
    const token = shot.url.includes(DEMO_TOKENS.checklistCheckedIn)
      ? DEMO_TOKENS.checklistCheckedIn
      : DEMO_TOKENS.checklistBeforeArrival;
    resetNewHireCaptureState(token);
  }

  const page = await newPage(browser, shot);
  const problems: string[] = [];
  const outDir = shot.outDir ? resolve(ROOT, shot.outDir) : OUT_DIR;
  mkdirSync(outDir, { recursive: true });
  try {
    await page.setViewportSize({
      width: shot.viewport?.width ?? VIEWPORT.width,
      height: shot.height ?? shot.viewport?.height ?? VIEWPORT.height,
    });
    await page.goto(`${BASE_URL}${shot.url}`, { waitUntil: "commit", timeout: 45_000 });
    await settle(page, shot);

    if (shot.setup) {
      await shot.setup(page);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(800);
    }

    await page.evaluate(() => {
      document.querySelectorAll("[data-sonner-toaster], [data-sonner-toast]").forEach((n) => n.remove());
    });

    // Belt and braces: the harness already serves invented data, but blur the
    // signed-in identity chrome so an image can never carry a real operator.
    await redact(page, []);

    await clearCallouts(page);
    // Caption first so padding it adds is in the layout before callout
    // boxes are measured — otherwise badges sit 56px above their targets.
    if (shot.burnCaption) {
      await drawCaption(page, shot.caption);
      await page.waitForTimeout(100);
    }
    // When the shot is cropped, badges must stay inside the crop or they get
    // sliced off the edge of the image.
    const cropBounds = shot.clipSelector
      ? await page
          .locator(shot.clipSelector)
          .first()
          .boundingBox()
          .catch(() => null)
      : null;
    // Scope text matching to the content area unless a callout says
    // otherwise, so a filter button isn't matched against sidebar copy.
    const scope = shot.defaultWithin === null ? undefined : (shot.defaultWithin ?? "main");
    const callouts = shot.callouts.map((c) => ({
      ...c,
      within: c.within ?? (c.selector ? undefined : scope),
    }));

    const { drawn, missing } = await drawCallouts(
      page,
      callouts,
      cropBounds ? { x: cropBounds.x, width: cropBounds.width } : undefined,
    );
    if (missing.length) {
      problems.push(...missing.map((m) => `callout not found: ${m}`));
    }

    const path = resolve(outDir, `${shot.id}.png`);
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
  const newHireRun =
    filter.length > 0 &&
    filter.some((f) => f === "new-hire" || f === "new-hire-series" || NEW_HIRE_SHOTS.some((s) => s.id === f || s.doc === f));
  const pool = newHireRun ? NEW_HIRE_SHOTS : SHOTS;
  const shots = filter.length && !filter.every((f) => f === "new-hire" || f === "new-hire-series")
    ? pool.filter((s) => filter.includes(s.doc) || filter.includes(s.id) || filter.includes("new-hire") || filter.includes("new-hire-series"))
    : pool;

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

  if (newHireRun) {
    writeNewHireManifest(results);
  } else {
    writeAdminManifest(results);
  }

  const failed = results.filter((r) => !r.file);
  const partial = results.filter((r) => r.file && r.problems.length);
  const dest = newHireRun ? resolve(ROOT, NEW_HIRE_ROOT) : OUT_DIR;
  console.log(`\n${results.length - failed.length}/${results.length} captured → ${dest}`);
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

function writeAdminManifest(results: Array<Record<string, unknown> & { id: string }>) {
  const previous: Record<string, unknown>[] = existsSync(MANIFEST)
    ? (JSON.parse(readFileSync(MANIFEST, "utf8")).shots ?? [])
    : [];
  const merged = new Map<string, unknown>();
  for (const shot of previous) merged.set(String((shot as { id: string }).id), shot);
  for (const shot of results) merged.set(shot.id, shot);

  const order = new Map(SHOTS.map((s, i) => [s.id, i]));
  const manifestShots = [...merged.values()].sort(
    (a, b) =>
      (order.get(String((a as { id: string }).id)) ?? 999) -
      (order.get(String((b as { id: string }).id)) ?? 999),
  );

  const manifest = {
    _readme:
      "GENERATED by npm run docs:capture. Captured against the real admin components with invented data only — the production database is never contacted. Recapture whenever a guide is re-verified.",
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    viewport: VIEWPORT,
    shots: manifestShots,
  };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

function writeNewHireManifest(results: Array<{
  id: string;
  doc: string;
  caption: string;
  url: string;
  file: string | null;
  callouts: Array<{ n: number; label: string }>;
  problems: string[];
  capturedAt: string;
}>) {
  const root = resolve(ROOT, NEW_HIRE_ROOT);
  mkdirSync(root, { recursive: true });

  const byDoc = new Map<string, typeof results>();
  for (const shot of results) {
    const list = byDoc.get(shot.doc) ?? [];
    list.push(shot);
    byDoc.set(shot.doc, list);
  }

  for (const [doc, list] of byDoc) {
    const dir = resolve(root, doc);
    mkdirSync(dir, { recursive: true });
    const lines = [
      `# ${doc}`,
      "",
      "Captured from the live contractor app with invented demo data only.",
      "",
      ...list.map((s) => `- \`${s.file ?? "(missing)"}\` — ${s.caption}`),
      "",
    ];
    writeFileSync(resolve(dir, "captions.md"), `${lines.join("\n")}\n`);
  }

  const index = [
    "# New Hire Series — support screenshots",
    "",
    "Real app captures for the five-video New Hire Series. Regenerated with:",
    "",
    "```bash",
    "npm run dev -- --port 3100   # in one terminal",
    "npm run docs:capture -- new-hire",
    "```",
    "",
    "Every image is driven by Playwright against this repo's contractor screens.",
    "Supabase is intercepted and answered from `scripts/docs/capture/demo-data.ts`",
    "so no real client, contractor, or payment record can appear.",
    "",
    "## Skipped videos",
    "",
    ...NEW_HIRE_SKIPPED.map((s) => `- **Video ${s.video} (${s.slug}):** ${s.reason}`),
    "",
    "## Captured",
    "",
    ...results.map((s) => `- \`${s.doc}/${s.file ?? "(missing)"}\` — ${s.caption}`),
    "",
  ];
  writeFileSync(resolve(root, "README.md"), `${index.join("\n")}\n`);

  const manifest = {
    _readme:
      "GENERATED by npm run docs:capture -- new-hire. Real contractor screens, invented data only. Recapture when a screen changes.",
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    skipped: NEW_HIRE_SKIPPED,
    shots: results,
  };
  writeFileSync(resolve(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

main();

// ─── Day To Day Operations — training video screenshots ───────────────────
//
//   npm run dev -- --port 3100          # in another terminal
//   npm run docs:capture:day-to-day
//
// Produces, in docs/day-to-day-operations/:
//   frames/NN-*.png        1920×1080 frames in video order, ready for a timeline
//   phone/NN-*.png         the phone screen with the step spotlighted
//   phone/clean/NN-*.png   the same screen, no spotlight (for your own zooms)
//   guide/*.png            the one-page guide at full resolution
//   README.md              the storyboard: guide line, screen, suggested voiceover
//   manifest.json          what was captured, when, and any target not found
//
// Same rules as the other capture series: the REAL contractor screens from
// this repo, every Supabase call answered from invented data, nothing sent to
// production. The storyboard lives in capture/day-to-day-shots.ts.
//
// Environment:
//   DOCS_CAPTURE_BASE_URL   dev server (default http://localhost:3100)
//   DOCS_CAPTURE_CHROMIUM   Chromium binary, when Playwright's own build is
//                           not installed (e.g. /opt/pw-browsers/chromium)
//   DOCS_CAPTURE_FONT_DIR   folder holding Inter + Plus Jakarta Sans woff2
//                           files (@fontsource layout is fine). Needed when
//                           next/font could not download Google Fonts, or the
//                           screens fall back to a system font that is not
//                           what contractors see.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

import { handleApiRoute, handleSupabase } from "./capture/supabase-mock";
import { DEMO_CLEANER, DEMO_TOUR_PROGRESS } from "./capture/demo-data";
import { CAPTURE_TIMEZONE, clearDayToDayScenario, installDayToDayScenario } from "./capture/day-to-day-scenario";
import { GUIDE_LINES, STAGES, STORYBOARD, type DayCard, type DayShot, type StoryboardEntry } from "./capture/day-to-day-shots";
import { drawSpotlight, frameBox, locateTargets, type Box } from "./capture/spotlight";
import { loadGuideImage } from "./capture/guide-artwork";
import { buildAssets, cardFrameHtml, contactSheetHtml, renderFrame, shotFrameHtml } from "./capture/day-to-day-frames";

const ROOT = resolve(__dirname, "../..");
const OUT = resolve(ROOT, "docs/day-to-day-operations");
const DIRS = {
  frames: join(OUT, "frames"),
  phone: join(OUT, "phone"),
  clean: join(OUT, "phone/clean"),
  guide: join(OUT, "guide"),
};
const GUIDE_PDF = resolve(ROOT, "public/cleaner/guide-pdfs/day-to-day-job-operations.pdf");
const BASE_URL = process.env.DOCS_CAPTURE_BASE_URL || "http://localhost:3100";
const PHONE_VIEWPORT = { width: 430, height: 932 };
const FONT_HOST = "https://capture-fonts.local/";

// ─── Fonts ─────────────────────────────────────────────────────────────────

const FONT_FILES = [
  ...[400, 500, 600, 700, 800].map((w) => `inter-latin-${w}-normal.woff2`),
  ...[500, 600, 700, 800].map((w) => `plus-jakarta-sans-latin-${w}-normal.woff2`),
];

function loadFonts(): Map<string, Buffer> | null {
  const dir = process.env.DOCS_CAPTURE_FONT_DIR;
  if (!dir) return null;
  const candidates = (file: string) => [
    join(dir, file),
    join(dir, "node_modules/@fontsource/inter/files", file),
    join(dir, "node_modules/@fontsource/plus-jakarta-sans/files", file),
    join(dir, "@fontsource/inter/files", file),
    join(dir, "@fontsource/plus-jakarta-sans/files", file),
  ];
  const fonts = new Map<string, Buffer>();
  for (const file of FONT_FILES) {
    const hit = candidates(file).find((p) => existsSync(p));
    if (hit) fonts.set(file, readFileSync(hit));
  }
  if (fonts.size < FONT_FILES.length) {
    console.warn(`DOCS_CAPTURE_FONT_DIR is missing ${FONT_FILES.length - fonts.size} of ${FONT_FILES.length} font files.`);
  }
  return fonts.size ? fonts : null;
}

function appFontCss(fonts: Map<string, Buffer> | null): string {
  if (!fonts) return "";
  const faces = [...fonts.keys()]
    .map((file) => {
      const m = file.match(/^(inter|plus-jakarta-sans)-latin-(\d+)-normal\.woff2$/)!;
      const family = m[1] === "inter" ? "Inter" : "Plus Jakarta Sans";
      return `@font-face{font-family:"${family}";font-weight:${m[2]};font-style:normal;src:url(${FONT_HOST}${file}) format("woff2")}`;
    })
    .join("");
  // The app reads its fonts through these two variables (next/font).
  return `${faces}html,body{--font-inter:"Inter",system-ui,sans-serif!important;--font-jakarta:"Plus Jakarta Sans","Inter",sans-serif!important}`;
}

// ─── Browser ───────────────────────────────────────────────────────────────

function cleanerSession() {
  const now = Math.floor(Date.now() / 1000);
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

async function newPhonePage(
  browser: Browser,
  shot: DayShot,
  fonts: Map<string, Buffer> | null,
): Promise<{ page: Page; css: string }> {
  const context = await browser.newContext({
    viewport: PHONE_VIEWPORT,
    deviceScaleFactor: 2,
    timezoneId: CAPTURE_TIMEZONE,
    locale: "en-US",
    reducedMotion: "reduce",
    colorScheme: "light",
  });
  await context.route("**/*.supabase.co/**", (route, request) => handleSupabase(route, request));
  await context.route("**/api/**", (route, request) => handleApiRoute(route, request));
  await context.route(`${FONT_HOST}**`, (route) => {
    const body = fonts?.get(route.request().url().slice(FONT_HOST.length));
    return body ? route.fulfill({ status: 200, contentType: "font/woff2", body }) : route.fulfill({ status: 404, body: "" });
  });
  await context.route(/googleapis|gstatic|google\.com|googletagmanager|facebook|stripe\.com|js\.stripe/, (route) => route.abort());

  const css = [
    // Frozen animations and instant scrolling keep repeat captures identical
    // and keep the spotlight on the box that was measured.
    "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important}",
    "html,body{scroll-behavior:auto!important}",
    // The floating Help pill on the job pages sits on top of the Submit
    // button at phone width; it is not part of any step in the guide.
    'button.fixed[data-tour="help-button"],nextjs-portal{display:none!important}',
    shot.toasts ? "" : "[data-sonner-toaster],[data-sonner-toast]{display:none!important}",
    appFontCss(fonts),
  ].join("");

  // A string, not a function: tsx wraps named inner functions in a __name()
  // helper that doesn't exist once the source is shipped to the browser.
  // Init scripts can also run before <html> exists, so the style attaches as
  // soon as there is somewhere to put it.
  const session = shot.signedIn === false ? null : cleanerSession();
  await context.addInitScript({
    content: `(function () {
      var session = ${JSON.stringify(session)};
      if (session) localStorage.setItem("sb-sxdraeptzuamsgjcvfeg-auth-token", JSON.stringify(session));
      localStorage.setItem("novara.tours.progress.v1.anon", ${JSON.stringify(JSON.stringify(DEMO_TOUR_PROGRESS))});
      var el = document.createElement("style");
      el.setAttribute("data-capture-style", "1");
      el.textContent = ${JSON.stringify(css)};
      function attach() {
        var root = document.head || document.documentElement;
        if (!root) return false;
        root.appendChild(el);
        return true;
      }
      if (!attach()) {
        new MutationObserver(function (_, observer) { if (attach()) observer.disconnect(); })
          .observe(document, { childList: true, subtree: true });
      }
    })();`,
  });

  const page = await context.newPage();
  page.on("pageerror", (err) => console.log(`      [page error] ${err.message.split("\n")[0]}`));
  return { page, css };
}

// ─── Capture ───────────────────────────────────────────────────────────────

interface ShotResult {
  slug: string;
  file: string | null;
  cleanFile: string | null;
  tall: boolean;
  box: Box | null;
  problems: string[];
}

async function captureShot(browser: Browser, shot: DayShot, name: string, fonts: Map<string, Buffer> | null): Promise<ShotResult> {
  installDayToDayScenario(shot.scenario);
  const { page, css } = await newPhonePage(browser, shot, fonts);
  const problems: string[] = [];
  const file = `${name}.png`;
  try {
    await page.goto(`${BASE_URL}${shot.url}`, { waitUntil: "commit", timeout: 90_000 });
    await page.getByText(shot.waitFor, { exact: false }).first().waitFor({ timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    // Hydration can drop a tag it didn't render; make sure the capture CSS is on.
    await page.addStyleTag({ content: css });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(700);

    if (shot.setup) {
      await shot.setup(page);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(600);
    }

    if (shot.tall) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: join(DIRS.phone, file), fullPage: true });
      return { slug: shot.slug, file, cleanFile: null, tall: true, box: null, problems };
    }

    let box: Box | null = null;
    if (shot.spotlight?.length) {
      const first = await locateTargets(page, shot.spotlight);
      problems.push(...first.missing.map((m) => `spotlight target not found: ${m}`));
      if (first.box && !shot.toasts) await frameBox(page, first.box, shot.align ?? "center", shot.header ?? 12);
      box = (await locateTargets(page, shot.spotlight)).box;
    }

    await page.screenshot({ path: join(DIRS.clean, file) });
    if (box) {
      await drawSpotlight(page, box, shot.pad ?? 8);
      await page.waitForTimeout(100);
    }
    await page.screenshot({ path: join(DIRS.phone, file) });
    return { slug: shot.slug, file, cleanFile: file, tall: false, box, problems };
  } catch (err) {
    problems.push(`capture failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    // Keep what the page looked like when it gave up, outside the repo.
    const debug = join(tmpdir(), `day-to-day-failed-${name}.png`);
    if (await page.screenshot({ path: debug, fullPage: true }).then(() => true, () => false)) {
      problems.push(`page at failure: ${debug}`);
    }
    return { slug: shot.slug, file: null, cleanFile: null, tall: Boolean(shot.tall), box: null, problems };
  } finally {
    await page.context().close();
    clearDayToDayScenario();
  }
}

// ─── Output ────────────────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, "0");

function sectionLabel(entry: StoryboardEntry): string {
  if (entry.kind === "card") {
    if (entry.card === "stage") return `Stop ${entry.stage} · ${STAGES[entry.stage!].title}`;
    return { title: "Intro", guide: "Intro", complete: "Job complete", remember: "Closing", call: "Closing" }[entry.card] ?? "";
  }
  const s = entry.section;
  return typeof s === "number" ? `Stop ${s} · ${STAGES[s].title}` : s === "complete" ? "Job complete" : "Closing";
}

function cardLabel(card: DayCard): string {
  if (card.card === "stage") return `Stop ${card.stage} — ${STAGES[card.stage!].title}`;
  return { title: "Title card", guide: "The one-page guide", complete: "Job complete", remember: "Show up. Work it. Document it.", call: "Call the office" }[card.card] ?? card.slug;
}

const CARD_TEXT: Record<string, { line: string; narration: string }> = {
  title: {
    line: GUIDE_LINES.title,
    narration: "Every Novara job follows the same four stops. Here's what each one looks like in the app.",
  },
  guide: {
    line: GUIDE_LINES.intro,
    narration: "This is the one-page guide from your onboarding. Keep it handy — we'll go through it stop by stop.",
  },
  complete: {
    line: GUIDE_LINES.complete.line,
    narration: "When all four stops are done, the job is complete.",
  },
  remember: {
    line: `${GUIDE_LINES.remember.title} ${GUIDE_LINES.remember.line}`,
    narration: "Show up on time. Work the checklist. Document everything. That's how you move up a tier and earn more per job.",
  },
  call: {
    line: `${GUIDE_LINES.call.title} ${GUIDE_LINES.call.line}`,
    narration: "And if you're ever unsure, call the office. You're never in trouble for asking — guessing wrong costs far more.",
  },
};

function stageNarration(stage: 1 | 2 | 3 | 4): string {
  return {
    1: "Stop one: before you go.",
    2: "Stop two: when you arrive.",
    3: "Stop three: while you work.",
    4: "Stop four: before you leave.",
  }[stage];
}

function writeReadme(rows: Array<{ n: number; entry: StoryboardEntry; name: string; result?: ShotResult }>, capturedAt: string) {
  const tall = rows.find((r) => r.entry.kind === "shot" && r.entry.tall);
  const lines: string[] = [
    "# Day To Day Operations — training video screenshots",
    "",
    "Support screenshots for the training video on the one-page guide",
    "**Your Job, Start to Finish** (`public/cleaner/guide-pdfs/day-to-day-job-operations.pdf`).",
    "Every frame follows one sample job from *Before you go* to *Job complete*: Dana's",
    "Standard Clean for Jordan Reyes, today 10–11 AM, 418 Larkspur Lane (side gate, a dog",
    "called Biscuit). All names, addresses, photos and amounts are invented.",
    "",
    "## What's here",
    "",
    "| Folder | What it is | Use it for |",
    "| --- | --- | --- |",
    "| `frames/` | 1920×1080 frames, numbered in video order | Drop straight onto the timeline |",
    "| `phone/` | The phone screen with the step spotlighted (860×1864) | Your own layouts, picture-in-picture |",
    "| `phone/clean/` | The same screens without the spotlight | Your own zooms and highlights |",
    "| `guide/` | The one-page guide at full resolution (3000×4296) | Intro/outro, slow pans |",
    "| `storyboard.png` | Every frame as a numbered thumbnail | Seeing the whole video at a glance |",
    "",
    ...(tall
      ? [`\`phone/${tall.name}.png\` is one tall image of the whole checklist — pan down it slowly for a "scrolling" shot.`, ""]
      : []),
    "## Storyboard",
    "",
    "Headlines are the guide's own words. The voiceover column is a suggestion that only says",
    "what the screen shows — rewrite it in your own voice.",
    "",
  ];

  let current = "";
  for (const { n, entry, name, result } of rows) {
    const label = sectionLabel(entry);
    if (label !== current) {
      current = label;
      if (lines[lines.length - 1] !== "") lines.push("");
      lines.push(`### ${label}`, "", "| # | Frame | Guide line | On screen | Suggested voiceover |", "| --- | --- | --- | --- | --- |");
    }
    if (entry.kind === "card") {
      const text = entry.card === "stage"
        ? { line: STAGES[entry.stage!].bullets.join(" · "), narration: stageNarration(entry.stage!) }
        : CARD_TEXT[entry.card];
      lines.push(`| ${pad2(n)} | \`frames/${name}.png\` | ${text.line} | ${cardLabel(entry)} | ${text.narration} |`);
      continue;
    }
    const frame = entry.tall ? `\`phone/${name}.png\` (tall)` : `\`frames/${name}.png\``;
    const flag = result && (result.problems.length || !result.file) ? " ⚠️" : "";
    lines.push(`| ${pad2(n)} | ${frame}${flag} | ${entry.bullet} | ${entry.onScreen} | ${entry.narration} |`);
  }

  const notes = rows.filter((r) => r.entry.kind === "shot" && (r.entry as DayShot).note);
  lines.push(
    "",
    "## Where the app and the guide differ",
    "",
    "Worth knowing before you record, so the voiceover doesn't promise a button that isn't there:",
    "",
    ...notes.map((r) => `- **${pad2(r.n)} · ${(r.entry as DayShot).bullet}** — ${(r.entry as DayShot).note}`),
    "- **The floating Help button is hidden** in these captures. On the job pages it sits on top of the Submit button at phone width.",
    "",
    "## Regenerating",
    "",
    "The images are generated from the real screens, so re-run this whenever a contractor screen changes:",
    "",
    "```bash",
    "npm run dev -- --port 3100              # in one terminal",
    "npm run docs:capture:day-to-day",
    "```",
    "",
    "The storyboard (order, guide lines, spotlight targets, voiceover) is",
    "`scripts/docs/capture/day-to-day-shots.ts`; the sample job is",
    "`scripts/docs/capture/day-to-day-scenario.ts`. If next/font can't reach Google Fonts on",
    "your machine, point `DOCS_CAPTURE_FONT_DIR` at a folder with the Inter and Plus Jakarta",
    "Sans woff2 files so the screens use the real brand fonts.",
    "",
    `_Captured ${capturedAt.slice(0, 10)}._`,
    "",
  );
  writeFileSync(join(OUT, "README.md"), lines.join("\n"));
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  try {
    const res = await fetch(`${BASE_URL}/cleaner/auth`);
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (err) {
    console.error(
      `Cannot reach the dev server at ${BASE_URL} (${err instanceof Error ? err.message : err}).\nStart it first:  npm run dev -- --port 3100`,
    );
    process.exit(1);
  }

  const fonts = loadFonts();
  if (!fonts) {
    console.warn("No DOCS_CAPTURE_FONT_DIR — screens use whatever fonts the dev server loaded.");
  }

  // `-- check-in ringer-on` re-captures just those entries (slug or number)
  // and leaves everything else, README and manifest included, untouched.
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const partial = only.length > 0;

  if (!partial) {
    // Start clean so a removed shot can't leave a stale image behind.
    for (const dir of [DIRS.frames, DIRS.phone, DIRS.guide]) rmSync(dir, { recursive: true, force: true });
  }
  for (const dir of Object.values(DIRS)) mkdirSync(dir, { recursive: true });

  const executablePath = process.env.DOCS_CAPTURE_CHROMIUM || undefined;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});

  const rows: Array<{ n: number; entry: StoryboardEntry; name: string; result?: ShotResult }> = STORYBOARD.map((entry, i) => ({
    n: i + 1,
    entry,
    name: `${pad2(i + 1)}-${entry.slug}`,
  }));
  const wanted = (row: (typeof rows)[number]) =>
    !partial || only.some((o) => o === row.entry.slug || o === row.name || Number(o) === row.n);
  if (partial && !rows.some(wanted)) {
    console.error(`Nothing in the storyboard matches ${only.join(", ")}`);
    process.exit(1);
  }

  console.log("Phone screens");
  for (const row of rows) {
    if (row.entry.kind !== "shot" || !wanted(row)) continue;
    process.stdout.write(`  ${row.name.padEnd(40)} `);
    row.result = await captureShot(browser, row.entry, row.name, fonts);
    console.log(!row.result.file ? "FAILED" : row.result.problems.length ? `ok (${row.result.problems.join("; ")})` : "ok");
  }

  console.log("Frames");
  const guide = await loadGuideImage(GUIDE_PDF);
  const assets = buildAssets(guide);
  writeFileSync(join(DIRS.guide, "your-job-start-to-finish@3x.png"), assets.guide);
  for (const row of rows) {
    const { entry } = row;
    if (!wanted(row) || (entry.kind === "shot" && (entry.tall || !row.result?.file))) continue;
    const html = entry.kind === "card" ? cardFrameHtml(entry, fonts) : shotFrameHtml(entry, row.result!.file!, fonts);
    await renderFrame(browser, html, join(DIRS.frames, `${row.name}.png`), assets, DIRS, fonts);
    console.log(`  ${row.name}`);
  }

  if (!partial) {
    const sheet = rows
      .filter((r) => existsSync(join(DIRS.frames, `${r.name}.png`)))
      .map((r) => ({ file: `${r.name}.png`, label: r.entry.kind === "shot" ? r.entry.onScreen : cardLabel(r.entry) }));
    await renderFrame(browser, contactSheetHtml(sheet, fonts), join(OUT, "storyboard.png"), assets, DIRS, fonts, true);
    console.log("  storyboard.png");
  }
  await browser.close();

  if (partial) {
    const failed = rows.filter((r) => r.result && (!r.result.file || r.result.problems.length));
    for (const r of failed) console.log(`  ${r.name}: ${r.result!.problems.join("; ") || "no image"}`);
    if (failed.length) process.exitCode = 1;
    console.log("\nPartial run: README.md and manifest.json were left as they were.");
    return;
  }

  const capturedAt = new Date().toISOString();
  writeReadme(rows, capturedAt);
  const manifest = {
    _readme:
      "GENERATED by npm run docs:capture:day-to-day. Real contractor screens, invented data only. Re-run when a contractor screen changes.",
    generatedAt: capturedAt,
    baseUrl: BASE_URL,
    timezone: CAPTURE_TIMEZONE,
    phoneViewport: { ...PHONE_VIEWPORT, deviceScaleFactor: 2 },
    brandFonts: Boolean(fonts),
    entries: rows.map(({ n, entry, name, result }) => ({
      n,
      name,
      kind: entry.kind,
      section: sectionLabel(entry),
      ...(entry.kind === "shot"
        ? {
            guideLine: entry.bullet,
            onScreen: entry.onScreen,
            narration: entry.narration,
            url: entry.url,
            frame: entry.tall || !result?.file ? null : `frames/${name}.png`,
            phone: result?.file ? `phone/${result.file}` : null,
            phoneClean: result?.cleanFile ? `phone/clean/${result.cleanFile}` : null,
            spotlight: result?.box
              ? { x: Math.round(result.box.x), y: Math.round(result.box.y), width: Math.round(result.box.width), height: Math.round(result.box.height) }
              : null,
            problems: result?.problems ?? [],
          }
        : { frame: `frames/${name}.png` }),
    })),
  };
  writeFileSync(join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const bytes = (dir: string) => readdirSync(dir).filter((f) => f.endsWith(".png")).reduce((n, f) => n + statSync(join(dir, f)).size, 0);
  console.log(
    `\nDone → ${OUT}\n  frames ${(bytes(DIRS.frames) / 1e6).toFixed(1)} MB · phone ${(bytes(DIRS.phone) / 1e6).toFixed(1)} MB · clean ${(bytes(DIRS.clean) / 1e6).toFixed(1)} MB`,
  );
  const failed = rows.filter((r) => r.result && (!r.result.file || r.result.problems.length));
  if (failed.length) {
    console.log(`\n${failed.length} shot(s) need a look:`);
    for (const r of failed) console.log(`  ${r.name}: ${r.result!.problems.join("; ") || "no image"}`);
    process.exitCode = 1;
  }
}

main();

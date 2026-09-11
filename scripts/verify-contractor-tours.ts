// ─── Offline verification of the contractor walkthroughs (no network) ────────
//
// The walkthroughs work by pointing at named elements in the live portal. That
// buys us clips and tours that can't show a screen which no longer exists, but
// it moves the risk somewhere else: a step can reference an anchor that no
// component renders any more, and the only symptom is a walkthrough quietly
// explaining thin air to a contractor. Nobody files a bug for that.
//
// So this script checks the two halves against each other by reading the
// files:
//
//   • every anchor a step references is rendered by some component
//   • every anchor in the registry is used by something (dead anchors are
//     how the registry stops being trustworthy)
//   • the catalog's own shape holds: unique ids, fallback text wherever a
//     step points at an element, lengths that match the stated run time
//   • each recording's source hashes still match the repo, so a clip whose
//     screen has changed is reported rather than left to be discovered by a
//     contractor following instructions for a button that moved
//
//   Run:  npm run tours:verify

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { ALL_TOUR_ANCHORS, TOUR, TOUR_ATTRIBUTE } from "../src/lib/tours/anchors";
import { TOURS, TOUR_SCREENS, type Tour } from "../src/lib/tours/catalog";
import {
  DEFAULT_TOUR_SETTINGS,
  isTourOwed,
  normalizeTourSettings,
  resumeStepIndex,
  standingRows,
  standingSummary,
  tourStanding,
  toursToOffer,
  type TourProgressRecord,
} from "../src/lib/tours/progress";
import { TOUR_SOURCES, hashSources, staleSources } from "./tours/sources";

const ROOT = resolve(__dirname, "..");
const RECORDINGS_DIR = resolve(ROOT, "docs/contractor-tours/recordings");
const MANIFEST = resolve(ROOT, "src/lib/tours/recordings.manifest.json");
const CURRENT_HASHES = resolve(ROOT, "src/lib/tours/source-hashes.generated.json");

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

function warn(message: string): void {
  console.log(`  ! ${message}`);
}

// ── Which anchors does the source tree actually render? ─────────────────────

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

const files = sourceFiles(resolve(ROOT, "src"));

// Two ways an anchor reaches the DOM: spread through `tourAnchor(TOUR.x)`, or
// passed as a nav item's `tourAnchor` field and applied by the shared chrome.
// Both are a usage; only the registry itself doesn't count.
const rendered = new Set<string>();
for (const file of files) {
  if (file.endsWith("src/lib/tours/anchors.ts")) continue;
  if (file.endsWith("src/lib/tours/catalog.ts")) continue;
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/TOUR\.([A-Za-z0-9_]+)/g)) {
    const key = match[1] as keyof typeof TOUR;
    if (key in TOUR) rendered.add(TOUR[key]);
  }
}

console.log("Anchors referenced by steps are rendered somewhere:");
const stepAnchors = new Set<string>();
for (const tour of TOURS) {
  for (const step of tour.steps) if (step.anchor) stepAnchors.add(step.anchor);
}
const unrendered = [...stepAnchors].filter((a) => !rendered.has(a)).sort();
check("no step points at an anchor nothing renders", unrendered, []);

console.log("\nRegistry has no dead entries:");
const unused = ALL_TOUR_ANCHORS.filter((a) => !rendered.has(a)).sort();
check("every registry anchor is used by a component", unused, []);

console.log("\nCatalog shape:");
check("seven walkthroughs", TOURS.length, 7);
check(
  "ids are unique",
  TOURS.length,
  new Set(TOURS.map((t) => t.id)).size,
);
check(
  "order values are unique and 1..7",
  TOURS.map((t) => t.order).sort((a, b) => a - b),
  [1, 2, 3, 4, 5, 6, 7],
);
check(
  "every walkthrough is in the first-login sequence",
  TOURS.filter((t) => !t.autoStart).map((t) => t.id),
  [],
);

const badStepIds = TOURS.filter(
  (t) => new Set(t.steps.map((s) => s.id)).size !== t.steps.length,
).map((t) => t.id);
check("step ids are unique within each walkthrough", badStepIds, []);

// A step that points at an element MUST carry fallback copy, or it degrades
// into a popover hovering over nothing when that element isn't on screen.
const missingFallback: string[] = [];
for (const tour of TOURS) {
  for (const step of tour.steps) {
    if (step.anchor && !step.fallback) missingFallback.push(`${tour.id}/${step.id}`);
  }
}
check("anchored steps all have fallback copy", missingFallback, []);

const unknownScreens: string[] = [];
for (const tour of TOURS) {
  for (const step of tour.steps) {
    if (!(step.screen in TOUR_SCREENS)) unknownScreens.push(`${tour.id}/${step.id}`);
  }
}
check("every step names a known screen", unknownScreens, []);

// "Each one is short — completable in under two minutes."
//
// Two different numbers here, and conflating them was a mistake worth
// spelling out: `readingSeconds` is the floor — the dwell the recorder holds
// each step for, which is how long the words take to read. `estimatedSeconds`
// is what we tell a contractor in the Help menu, and a person clicking
// through at their own pace is slower than that floor. So the assertion is
// that the promise is neither impossible nor broken: not faster than reading,
// and still inside two minutes.
const readingSeconds = (tour: Tour) =>
  tour.steps.reduce((sum, step) => {
    const words = `${step.title} ${step.body}`.trim().split(/\s+/).length;
    return sum + Math.min(8, Math.max(4, 3 + words * 0.13));
  }, 0);

const tooLong = TOURS.filter((t) => t.estimatedSeconds > 120).map((t) => t.id);
check("no walkthrough claims more than two minutes", tooLong, []);

const unreadable = TOURS.filter((t) => readingSeconds(t) > 120).map((t) => t.id);
check("no walkthrough takes over two minutes just to read", unreadable, []);

const optimistic = TOURS.filter((t) => t.estimatedSeconds < readingSeconds(t)).map(
  (t) => t.id,
);
check("no walkthrough promises to be faster than its own text", optimistic, []);

console.log("\nAnchor attribute:");
check("attribute name", TOUR_ATTRIBUTE, "data-tour");
check(
  "anchor ids are kebab-case",
  ALL_TOUR_ANCHORS.filter((a) => !/^[a-z][a-z0-9-]*$/.test(a)),
  [],
);
check(
  "anchor ids are unique",
  ALL_TOUR_ANCHORS.length,
  new Set(ALL_TOUR_ANCHORS).size,
);

// ── Progress rules ─────────────────────────────────────────────────────────

console.log("\nProgress standing:");
const tour = TOURS[0];
const record = (over: Partial<TourProgressRecord> = {}): TourProgressRecord => ({
  tourId: tour.id,
  version: tour.version,
  status: "completed",
  lastStepIndex: 0,
  startedAt: null,
  completedAt: null,
  updatedAt: null,
  ...over,
});

check("no record at all", tourStanding(tour, null), "never");
check("finished the current version", tourStanding(tour, record()), "completed");
check("skipped the current version", tourStanding(tour, record({ status: "skipped" })), "skipped");
check("stopped partway", tourStanding(tour, record({ status: "in_progress" })), "in_progress");
check(
  "finished an older version",
  tourStanding(tour, record({ version: tour.version - 1 })),
  "outdated",
);
check(
  "skipped an older version still counts as outdated",
  tourStanding(tour, record({ version: tour.version - 1, status: "skipped" })),
  "outdated",
);

console.log("\nWhat gets offered:");
check("never seen → owed", isTourOwed(tour, null), true);
check("stopped partway → owed", isTourOwed(tour, record({ status: "in_progress" })), true);
check("finished → not owed", isTourOwed(tour, record()), false);
// A skip is an answer. Re-asking after "no" is the nagging this feature is
// meant to avoid.
check("skipped → not owed", isTourOwed(tour, record({ status: "skipped" })), false);
check(
  "outdated → owed when re-offering is on",
  isTourOwed(tour, record({ version: tour.version - 1 }), DEFAULT_TOUR_SETTINGS),
  true,
);
check(
  "outdated → not owed when admin turned re-offering off",
  isTourOwed(tour, record({ version: tour.version - 1 }), {
    ...DEFAULT_TOUR_SETTINGS,
    reofferOnVersionChange: false,
  }),
  false,
);

check(
  "a brand new contractor is offered at most maxReoffersAtOnce",
  toursToOffer([], DEFAULT_TOUR_SETTINGS).length,
  DEFAULT_TOUR_SETTINGS.maxReoffersAtOnce,
);
check(
  "the first offer is the first walkthrough",
  toursToOffer([], DEFAULT_TOUR_SETTINGS)[0].id,
  "dashboard-basics",
);
check(
  "auto-start off → nothing is offered unprompted",
  toursToOffer([], { ...DEFAULT_TOUR_SETTINGS, autoStartOnFirstLogin: false }),
  [],
);

console.log("\nResume:");
check("no record → start at the beginning", resumeStepIndex(tour, null), 0);
check(
  "partway → resume there",
  resumeStepIndex(tour, record({ status: "in_progress", lastStepIndex: 3 })),
  3,
);
check(
  "past the end (catalog shrank) → clamp",
  resumeStepIndex(tour, record({ status: "in_progress", lastStepIndex: 99 })),
  tour.steps.length - 1,
);
check(
  "a different version → start over rather than resume into moved steps",
  resumeStepIndex(tour, record({ status: "in_progress", lastStepIndex: 3, version: 99 })),
  0,
);

console.log("\nSettings degrade to working defaults:");
check("missing settings row", normalizeTourSettings(null), DEFAULT_TOUR_SETTINGS);
check("empty object", normalizeTourSettings({}), DEFAULT_TOUR_SETTINGS);
check(
  "partial object keeps the rest",
  normalizeTourSettings({ reofferOnVersionChange: false }),
  { ...DEFAULT_TOUR_SETTINGS, reofferOnVersionChange: false },
);
check(
  "a nonsense cap falls back rather than offering zero",
  normalizeTourSettings({ maxReoffersAtOnce: 0 }).maxReoffersAtOnce,
  DEFAULT_TOUR_SETTINGS.maxReoffersAtOnce,
);

console.log("\nAdmin summary is counts, never a score:");
const rows = standingRows([
  record({ status: "completed" }),
  { ...record(), tourId: "reading-a-job", status: "skipped" },
]);
check("one row per walkthrough", rows.length, TOURS.length);
check(
  "summary reads as facts",
  standingSummary(rows),
  "1 of 7 completed · 1 skipped · 5 not started",
);
check(
  "no percentage anywhere in the summary",
  /%/.test(standingSummary(rows)),
  false,
);

// ── Recording freshness ────────────────────────────────────────────────────
//
// Staleness is a warning, not a failure. Failing the build on it would mean
// no UI change could land without re-recording seven videos, which is the
// fastest way to get a check deleted. The requirement is that an outdated
// clip is visible, and a named warning here plus the admin panel is visible.

console.log("\nRecordings:");
check(
  "every walkthrough has a declared source list",
  TOURS.filter((t) => !TOUR_SOURCES[t.id]?.length).map((t) => t.id),
  [],
);

const declaredSources = new Set(Object.values(TOUR_SOURCES).flat());
const missingSourceFiles = [...declaredSources]
  .filter((path) => !existsSync(resolve(ROOT, path)))
  .sort();
check("declared source files all exist", missingSourceFiles, []);

// Refresh the hashes the running app compares recordings against.
//
// Derived purely from the source tree, so this is a rewrite of a cache and
// not a check of itself. The admin panel can't hash files at request time —
// source files aren't in a deployed bundle — so the current state has to be
// carried into the build by something, and this is that something. A
// developer who changes a contractor screen and runs verify gets an updated
// file to commit, and the panel then shows the affected clips as stale.
const currentHashes = hashSources([...declaredSources]);
const generated = {
  _readme:
    "GENERATED by npm run tours:verify. Content hashes of the contractor screens the walkthrough recordings show. Compared against each recording's sourceHashes to flag clips whose screen has changed since they were captured. Commit this alongside UI changes.",
  generatedAt: new Date().toISOString(),
  hashes: currentHashes,
};
const previousGenerated = existsSync(CURRENT_HASHES)
  ? (JSON.parse(readFileSync(CURRENT_HASHES, "utf8")).hashes as Record<string, string | null>)
  : null;
if (JSON.stringify(previousGenerated) !== JSON.stringify(currentHashes)) {
  writeFileSync(CURRENT_HASHES, `${JSON.stringify(generated, null, 2)}\n`);
  warn(
    previousGenerated
      ? "contractor screens changed — refreshed src/lib/tours/source-hashes.generated.json (commit it)"
      : "wrote src/lib/tours/source-hashes.generated.json (commit it)",
  );
}

const manifest = existsSync(MANIFEST)
  ? (JSON.parse(readFileSync(MANIFEST, "utf8")) as {
      _readme?: string;
      recordings?: Array<{
        id: string;
        version: number;
        file: string;
        captionFile: string;
        durationSeconds: number;
        generatedAt: string;
        sourceHashes: Record<string, string | null>;
      }>;
    })
  : null;

check(
  "the manifest is committed so the app can read it without a recording run",
  Boolean(manifest),
  true,
);
check(
  "manifest carries its generated-by marker",
  typeof manifest?._readme === "string",
  true,
);

const recordings = manifest?.recordings || [];

if (!recordings.length) {
  warn(
    "no recordings yet — run `npm run dev -- --port 3100` then `npm run tours:record`. " +
      "The interactive walkthroughs work without them.",
  );
} else {
  const missingFiles = recordings
    .flatMap((r) => [r.file, r.captionFile])
    .filter((f) => f && !existsSync(resolve(RECORDINGS_DIR, f)))
    .sort();
  check("every manifest entry has its files on disk", missingFiles, []);

  // "Short silent captioned clips (30–90 seconds)."
  const wrongLength = recordings
    .filter((r) => r.durationSeconds < 25 || r.durationSeconds > 100)
    .map((r) => `${r.id} (${r.durationSeconds}s)`);
  check("clips are roughly 30–90 seconds", wrongLength, []);

  const uncaptioned = recordings.filter((r) => !r.captionFile).map((r) => r.id);
  check("every clip has a caption track", uncaptioned, []);

  const behindVersion = recordings
    .filter((r) => {
      const t = TOURS.find((x) => x.id === r.id);
      return t && r.version !== t.version;
    })
    .map((r) => r.id);
  if (behindVersion.length) {
    warn(
      `recorded from an older walkthrough version: ${behindVersion.join(", ")} — re-record with \`npm run tours:record\``,
    );
  }

  let staleCount = 0;
  for (const recording of recordings) {
    const stale = staleSources(recording.sourceHashes || {});
    if (stale.length) {
      staleCount += 1;
      warn(
        `${recording.id} shows screens that changed since ${recording.generatedAt.slice(0, 10)}: ${stale
          .map((s) => s.path)
          .join(", ")}`,
      );
    }
  }

  const missingRecordings = TOURS.filter((t) => !recordings.some((r) => r.id === t.id)).map(
    (t) => t.id,
  );
  if (missingRecordings.length) {
    warn(`no clip yet for: ${missingRecordings.join(", ")}`);
  }

  console.log(
    `  ${recordings.length}/${TOURS.length} walkthroughs recorded, ${staleCount} stale`,
  );
}

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("All contractor walkthrough checks passed.");

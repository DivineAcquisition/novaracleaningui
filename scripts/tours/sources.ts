// ─── What each recording depends on ─────────────────────────────────────────
//
// A clip is a picture of some screens at a moment in time, so it goes stale
// the moment one of those screens changes — and the whole failure mode we're
// avoiding is a clip that is confidently, silently wrong.
//
// So each recording records the content hash of every source file it shows.
// `npm run tours:verify` re-hashes those files and reports any clip whose
// screens have moved on since it was captured, and the admin panel shows the
// same thing. Nobody has to remember which video to re-record after a UI
// change; the repo works it out.
//
// The lists below are the honest answer to "what is visible in this clip?".
// They include the walkthrough copy (the catalog), the overlay that draws the
// card, and the components whose markup appears on screen. They deliberately
// do NOT include every transitive import — a change to a date helper is not a
// change to what the clip shows, and a list that flags everything gets
// ignored.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { TourId } from "../../src/lib/tours/catalog";

export const REPO_ROOT = resolve(__dirname, "../..");

/** Visible in every clip: the walkthrough text and the card that shows it. */
const SHARED = [
  "src/lib/tours/catalog.ts",
  "src/lib/tours/anchors.ts",
  "src/components/tour/TourOverlay.tsx",
  "src/components/tour/TourLauncher.tsx",
];

const PORTAL_CHROME = [
  "src/components/chrome/WorkspaceShell.tsx",
  "src/components/contractor/ContractorLayout.tsx",
];

const DASHBOARD = [
  "src/views/cleaner/Dashboard.tsx",
  "src/components/cleaner/portal-enrichment.tsx",
];

const CHECKLIST = ["src/views/cleaner/JobChecklist.tsx"];

export const TOUR_SOURCES: Record<TourId, string[]> = {
  "dashboard-basics": [
    ...SHARED,
    ...PORTAL_CHROME,
    ...DASHBOARD,
    "src/components/cleaner/DashboardStats.tsx",
  ],
  "reading-a-job": [...SHARED, ...PORTAL_CHROME, ...DASHBOARD],
  "working-the-checklist": [...SHARED, ...CHECKLIST],
  "photo-documentation": [...SHARED, "src/views/cleaner/JobPhotos.tsx"],
  "communication": [...SHARED, ...CHECKLIST, ...PORTAL_CHROME, ...DASHBOARD],
  "pay-and-score": [
    ...SHARED,
    ...PORTAL_CHROME,
    ...DASHBOARD,
    "src/views/contractor/Jobs.tsx",
  ],
  "availability-and-offers": [
    ...SHARED,
    ...PORTAL_CHROME,
    "src/views/cleaner/JobOffersList.tsx",
    "src/views/cleaner/Profile.tsx",
  ],
};

/** Short content hash of one repo-relative file, or null when it's gone. */
export function hashFile(relativePath: string): string | null {
  const full = resolve(REPO_ROOT, relativePath);
  if (!existsSync(full)) return null;
  return createHash("sha256").update(readFileSync(full)).digest("hex").slice(0, 16);
}

export type SourceHashes = Record<string, string | null>;

export function hashSources(paths: string[]): SourceHashes {
  const out: SourceHashes = {};
  for (const path of [...paths].sort()) out[path] = hashFile(path);
  return out;
}

export interface StaleSource {
  path: string;
  recorded: string | null;
  current: string | null;
}

/**
 * Which of a clip's sources have changed since it was recorded.
 *
 * A file that has been deleted counts as changed, not as missing-so-ignore: a
 * clip showing a screen that no longer exists is the worst case of all.
 */
export function staleSources(recorded: SourceHashes): StaleSource[] {
  const stale: StaleSource[] = [];
  for (const [path, hash] of Object.entries(recorded || {})) {
    const current = hashFile(path);
    if (current !== hash) stale.push({ path, recorded: hash, current });
  }
  return stale;
}

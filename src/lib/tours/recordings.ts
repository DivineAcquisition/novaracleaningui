// ─── Recording manifest, as the app sees it ─────────────────────────────────
//
// The clips themselves live in Supabase Storage (they're too heavy to bundle
// and too boring to version), but the manifest is committed, so the app always
// knows what exists, how long it is, and — the part that matters — whether it
// still matches the screens it shows.
//
// Freshness works by comparing two committed facts:
//
//   recording.sourceHashes   the contractor screens as they were when the
//                            clip was captured (written by tours:record)
//   CURRENT_SOURCE_HASHES    the same files as they are now (refreshed by
//                            tours:verify)
//
// When they disagree, that clip is showing a screen that has since changed.
// Neither side is computed at request time, because source files don't exist
// in a deployed bundle — which is exactly why the hashes are carried into the
// build rather than derived from it.
//
// A clip going stale is surfaced, not hidden: the contractor-facing player
// says so, and admin gets the list. The alternative — quietly serving a clip
// that shows a button which moved — is the failure this whole arrangement is
// built to avoid.

import manifest from "./recordings.manifest.json";
import generatedHashes from "./source-hashes.generated.json";
import { TOURS, getTour, type TourId } from "./catalog";

export interface Recording {
  id: TourId;
  title: string;
  /** Catalog version of the walkthrough when this was captured. */
  version: number;
  file: string;
  captionFile: string;
  startUrl: string;
  steps: number;
  durationSeconds: number;
  generatedAt: string;
  sourceHashes: Record<string, string | null>;
  problems?: string[];
}

const RECORDINGS: Recording[] = ((manifest as { recordings?: unknown[] }).recordings ||
  []) as Recording[];

const CURRENT_SOURCE_HASHES: Record<string, string | null> =
  (generatedHashes as { hashes?: Record<string, string | null> }).hashes || {};

export const RECORDINGS_BUCKET = "contractor-tour-recordings";

export function allRecordings(): Recording[] {
  return RECORDINGS;
}

export function getRecording(tourId: string): Recording | null {
  return RECORDINGS.find((r) => r.id === tourId) || null;
}

/** Why a clip is out of date, or an empty list when it isn't. */
export interface Staleness {
  /** Screens that have changed since the clip was captured. */
  changedScreens: string[];
  /** True when the walkthrough's own copy has moved on. */
  behindVersion: boolean;
}

export function staleness(recording: Recording): Staleness {
  const changedScreens: string[] = [];
  for (const [path, hash] of Object.entries(recording.sourceHashes || {})) {
    // A path we no longer track can't be compared. Treating that as "fine"
    // is the right call: it means the file was dropped from the clip's
    // declared sources, which is a deliberate edit, not drift.
    if (!(path in CURRENT_SOURCE_HASHES)) continue;
    if (CURRENT_SOURCE_HASHES[path] !== hash) changedScreens.push(path);
  }

  const tour = getTour(recording.id);
  return {
    changedScreens,
    behindVersion: Boolean(tour && tour.version !== recording.version),
  };
}

export function isStale(recording: Recording): boolean {
  const s = staleness(recording);
  return s.changedScreens.length > 0 || s.behindVersion;
}

/**
 * One line a contractor or an admin can act on.
 *
 * Names the walkthrough rather than the file paths — a contractor doesn't
 * care that `Dashboard.tsx` changed, only that the clip may not match what
 * they're looking at.
 */
export function stalenessNote(recording: Recording): string | null {
  const s = staleness(recording);
  if (s.behindVersion) {
    return "This walkthrough has been updated since this clip was recorded. Run the interactive version for the current steps.";
  }
  if (s.changedScreens.length) {
    return "Part of the screen in this clip has changed since it was recorded. The interactive walkthrough is always current.";
  }
  return null;
}

export interface RecordingRow {
  tourId: TourId;
  title: string;
  summary: string;
  recording: Recording | null;
  stale: boolean;
  note: string | null;
}

/** Every walkthrough with its clip, if it has one. Catalog order. */
export function recordingRows(): RecordingRow[] {
  return TOURS.map((tour) => {
    const recording = getRecording(tour.id);
    return {
      tourId: tour.id,
      title: tour.title,
      summary: tour.summary,
      recording,
      stale: recording ? isStale(recording) : false,
      note: recording ? stalenessNote(recording) : null,
    };
  });
}

export function manifestGeneratedAt(): string | null {
  return (manifest as { generatedAt?: string }).generatedAt || null;
}

// ─── Tour progress rules ─────────────────────────────────────────────────────
//
// Pure functions, no I/O — the client, the API route, and the admin panel all
// decide "has this contractor seen this?" here rather than each re-deriving it
// from raw rows. Three places doing the same comparison slightly differently
// is how a contractor ends up being shown a walkthrough they finished last
// week, or worse, not shown one they never saw.
//
// Two things are deliberately kept apart:
//
//   Finished vs. skipped. Both stop us pestering someone — a walkthrough that
//   re-offers itself after you dismissed it is an obstacle, and the rule is
//   that these never obstruct. But admin sees the difference, because
//   "skipped it" and "read it" are not the same fact when someone says they
//   were never told.
//
//   Completion vs. performance. Completion is context for a conversation. It
//   is not an input to the Novara Score and it triggers nothing automatically.
//   Nothing in this file returns a number that could be mistaken for a grade.

import { TOURS, type Tour, type TourId } from "./catalog";

export type TourStatus = "in_progress" | "skipped" | "completed";

export interface TourProgressRecord {
  tourId: string;
  /** Catalog version of the tour at the time this row was last written. */
  version: number;
  status: TourStatus;
  /** How far they got. Lets a resumed walkthrough pick up where it stopped. */
  lastStepIndex: number;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
}

/**
 * Where a contractor stands on one walkthrough.
 *
 * `outdated` means they reached the end of an older version and the feature
 * has since changed materially, so the walkthrough is worth another minute.
 */
export type TourStanding =
  | "never"
  | "in_progress"
  | "skipped"
  | "completed"
  | "outdated";

export interface TourSettings {
  /** Run the first-login sequence automatically. */
  autoStartOnFirstLogin: boolean;
  /**
   * Re-offer a walkthrough whose version was bumped. Admin-configurable
   * because a release that touches several screens at once would otherwise
   * queue up five walkthroughs for every contractor on the same morning.
   */
  reofferOnVersionChange: boolean;
  /** Don't re-offer more than this many at once, however many are owed. */
  maxReoffersAtOnce: number;
}

export const DEFAULT_TOUR_SETTINGS: TourSettings = {
  autoStartOnFirstLogin: true,
  reofferOnVersionChange: true,
  maxReoffersAtOnce: 2,
};

export function normalizeTourSettings(raw: unknown): TourSettings {
  const value = (raw || {}) as Record<string, unknown>;
  const bool = (key: keyof TourSettings, fallback: boolean) =>
    typeof value[key] === "boolean" ? (value[key] as boolean) : fallback;
  const max = Number(value.maxReoffersAtOnce);
  return {
    autoStartOnFirstLogin: bool("autoStartOnFirstLogin", DEFAULT_TOUR_SETTINGS.autoStartOnFirstLogin),
    reofferOnVersionChange: bool("reofferOnVersionChange", DEFAULT_TOUR_SETTINGS.reofferOnVersionChange),
    maxReoffersAtOnce:
      Number.isFinite(max) && max > 0 ? Math.floor(max) : DEFAULT_TOUR_SETTINGS.maxReoffersAtOnce,
  };
}

export function findProgress(
  records: TourProgressRecord[] | null | undefined,
  tourId: string,
): TourProgressRecord | null {
  if (!records) return null;
  return records.find((r) => r.tourId === tourId) || null;
}

export function tourStanding(
  tour: Tour,
  record: TourProgressRecord | null | undefined,
): TourStanding {
  if (!record) return "never";
  if (record.status === "in_progress") return "in_progress";

  // A finished or skipped walkthrough from an older version of the feature.
  // Treated the same whether they read it or skipped it: the screen changed,
  // so what they saw (or declined to see) describes something else now.
  if (record.version < tour.version) return "outdated";

  return record.status === "skipped" ? "skipped" : "completed";
}

/**
 * Does this walkthrough still want a minute of the contractor's time?
 *
 * A skipped one does not — they gave an answer, and asking again after a "no"
 * is exactly the nagging this feature is supposed to avoid.
 */
export function isTourOwed(
  tour: Tour,
  record: TourProgressRecord | null | undefined,
  settings: TourSettings = DEFAULT_TOUR_SETTINGS,
): boolean {
  const standing = tourStanding(tour, record);
  if (standing === "never" || standing === "in_progress") return true;
  if (standing === "outdated") return settings.reofferOnVersionChange;
  return false;
}

/**
 * What to offer this contractor right now, in catalog order and capped.
 *
 * Only `autoStart` walkthroughs are ever offered unprompted; the rest are
 * there to be chosen from the Help menu.
 */
export function toursToOffer(
  records: TourProgressRecord[] | null | undefined,
  settings: TourSettings = DEFAULT_TOUR_SETTINGS,
): Tour[] {
  if (!settings.autoStartOnFirstLogin) return [];
  return TOURS.filter((tour) => tour.autoStart)
    .filter((tour) => isTourOwed(tour, findProgress(records, tour.id), settings))
    .sort((a, b) => a.order - b.order)
    .slice(0, Math.max(1, settings.maxReoffersAtOnce));
}

/** Step to resume at — never past the end, since the catalog may have shrunk. */
export function resumeStepIndex(
  tour: Tour,
  record: TourProgressRecord | null | undefined,
): number {
  if (!record || record.status !== "in_progress") return 0;
  if (record.version !== tour.version) return 0;
  const index = Number(record.lastStepIndex);
  if (!Number.isFinite(index) || index < 0) return 0;
  return Math.min(Math.floor(index), tour.steps.length - 1);
}

// ── Admin-facing shapes ────────────────────────────────────────────────────

export interface TourStandingRow {
  tourId: TourId;
  title: string;
  standing: TourStanding;
  /** Null unless they actually reached the end. */
  completedAt: string | null;
  updatedAt: string | null;
  /** Version they saw, when they saw one. */
  seenVersion: number | null;
  currentVersion: number;
}

export function standingRows(
  records: TourProgressRecord[] | null | undefined,
): TourStandingRow[] {
  return TOURS.map((tour) => {
    const record = findProgress(records, tour.id);
    const standing = tourStanding(tour, record);
    return {
      tourId: tour.id,
      title: tour.title,
      standing,
      completedAt: standing === "completed" ? record?.completedAt || null : null,
      updatedAt: record?.updatedAt || null,
      seenVersion: record ? record.version : null,
      currentVersion: tour.version,
    };
  }).sort((a, b) => {
    const orderOf = (id: TourId) => TOURS.findIndex((t) => t.id === id);
    return orderOf(a.tourId) - orderOf(b.tourId);
  });
}

export const STANDING_LABEL: Record<TourStanding, string> = {
  never: "Not started",
  in_progress: "Started",
  skipped: "Skipped",
  completed: "Completed",
  outdated: "Completed (older version)",
};

/**
 * One line for the admin table.
 *
 * Phrased as a count of facts, not a score. There is no percentage here on
 * purpose — a percentage invites someone to set a target for it, and the
 * moment training completion has a target it stops being context and starts
 * being a metric people game.
 */
export function standingSummary(rows: TourStandingRow[]): string {
  const completed = rows.filter((r) => r.standing === "completed").length;
  const started = rows.filter((r) => r.standing === "in_progress").length;
  const skipped = rows.filter((r) => r.standing === "skipped").length;
  const outdated = rows.filter((r) => r.standing === "outdated").length;
  const untouched = rows.filter((r) => r.standing === "never").length;

  // Every walkthrough is accounted for. Leaving a standing out makes the
  // counts fail to add up to the total, which reads as a bug and invites
  // somebody to go looking for the missing one.
  const parts: string[] = [`${completed} of ${rows.length} completed`];
  if (outdated > 0) parts.push(`${outdated} on an older version`);
  if (started > 0) parts.push(`${started} started`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (untouched > 0) parts.push(`${untouched} not started`);
  return parts.join(" · ");
}

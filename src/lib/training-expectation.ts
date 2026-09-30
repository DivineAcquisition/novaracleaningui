// The onboarding video that plays before the app walkthroughs.
// Watching it does not by itself clear the first-job gate. The seven
// walkthroughs still do that. This flag only records that this browser
// finished the expectation video, so the button under it can open them.

export const EXPECTATION_MEDIA_ID = "nvdljdxmls";

export function expectationWatchedKey(cleanerId: string): string {
  return `novara.training.expectation.${EXPECTATION_MEDIA_ID}.${cleanerId}`;
}

export function hasWatchedExpectationVideo(cleanerId: string): boolean {
  try {
    return window.localStorage.getItem(expectationWatchedKey(cleanerId)) === "1";
  } catch {
    return false;
  }
}

export function markExpectationVideoWatched(cleanerId: string): void {
  try {
    window.localStorage.setItem(expectationWatchedKey(cleanerId), "1");
  } catch {
    // Private mode can refuse storage. The in-memory unlock still stands.
  }
}

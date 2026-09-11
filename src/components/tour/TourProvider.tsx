"use client";

// ─── Tour engine ─────────────────────────────────────────────────────────────
//
// Drives the guided walkthroughs over the contractor's real portal. There is
// no recorded or mocked UI involved: a step names an element, and the engine
// either finds that element on the live page or falls back to explaining it.
//
// Three things here are less obvious than they look:
//
//   Active state lives in sessionStorage, not just React state. The pay
//   walkthrough crosses from /cleaner/dashboard to /contractor/jobs, and
//   those two pages are in different layouts — the provider unmounts on the
//   way. Parking the active step in sessionStorage means the walkthrough
//   picks up on the other side instead of vanishing, and it survives a reload
//   too.
//
//   Progress is written to localStorage first and the server second. A
//   contractor on a phone in a basement should not lose their place because a
//   POST failed, and many cleaner rows aren't linked to an auth user yet, so
//   there isn't always a row to write to.
//
//   The first-login sequence auto-starts exactly one walkthrough, then asks
//   before each next one. Seven back to back is fifteen minutes, and a
//   fifteen-minute wall in front of someone trying to check the address of a
//   job they're already late for is the opposite of what this is for.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";

import { supabase } from "@/integrations/supabase/client";
import {
  TOURS,
  TOUR_SCREENS,
  getTour,
  type Tour,
  type TourId,
  type TourStep,
} from "@/lib/tours/catalog";
import {
  DEFAULT_TOUR_SETTINGS,
  findProgress,
  resumeStepIndex,
  standingRows,
  toursToOffer,
  type TourProgressRecord,
  type TourSettings,
  type TourStanding,
} from "@/lib/tours/progress";
import { TourOverlay } from "./TourOverlay";
import { TourSuggestion } from "./TourSuggestion";

const ACTIVE_KEY = "novara.tours.active.v1";
const PROGRESS_KEY_PREFIX = "novara.tours.progress.v1";
const DISMISS_KEY = "novara.tours.dismissed.v1";

/** Pages where the first-login sequence may start itself. */
const AUTO_START_PATHS = ["/cleaner/dashboard", "/cleaner/mobile-dashboard"];

interface ActiveTour {
  tourId: TourId;
  stepIndex: number;
}

interface TourContextValue {
  /** The walkthrough running right now, if any. */
  active: ActiveTour | null;
  tours: Tour[];
  standings: Record<string, TourStanding>;
  loaded: boolean;
  /** Set when a walkthrough just ended and another is still owed. */
  suggestion: Tour | null;
  start: (tourId: string) => void;
  next: () => void;
  back: () => void;
  /** Stop and remember how far they got. Not a failure state. */
  skip: () => void;
  dismissSuggestion: () => void;
}

const TourContext = createContext<TourContextValue | null>(null);

export function useTours(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) {
    throw new Error("useTours must be used inside <TourProvider>");
  }
  return ctx;
}

/**
 * Safe to call outside the provider — returns null instead of throwing.
 *
 * The Help launcher sits in the portal chrome, which also renders on pages
 * that don't mount the provider. A missing provider should hide the button,
 * not white-screen the page.
 */
export function useToursOptional(): TourContextValue | null {
  return useContext(TourContext);
}

function readJson<T>(storage: Storage | null, key: string, fallback: T): T {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(storage: Storage | null, key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing, full quota — progress tracking is not worth an
    // exception that breaks the page it's supposed to be explaining.
  }
}

function session(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function local(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function TourProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [loaded, setLoaded] = useState(false);
  const [cleanerId, setCleanerId] = useState<string | null>(null);
  const [settings, setSettings] = useState<TourSettings>(DEFAULT_TOUR_SETTINGS);
  const [records, setRecords] = useState<TourProgressRecord[]>([]);
  const [active, setActive] = useState<ActiveTour | null>(null);
  const [suggestion, setSuggestion] = useState<Tour | null>(null);

  // Auto-start is a once-per-page-load decision. Without this the sequence
  // would restart every time the dashboard re-rendered after a data refresh.
  const autoStartChecked = useRef(false);

  const progressKey = useMemo(
    () => `${PROGRESS_KEY_PREFIX}.${cleanerId || "anon"}`,
    [cleanerId],
  );

  // ── Load ────────────────────────────────────────────────────────────────
  //
  // Local copy first so a walkthrough can start immediately, then the server
  // copy, which wins because it's the one admin sees.

  useEffect(() => {
    const parked = readJson<ActiveTour | null>(session(), ACTIVE_KEY, null);
    if (parked && getTour(parked.tourId)) {
      setActive(parked);
    }

    const localRecords = readJson<TourProgressRecord[]>(
      local(),
      `${PROGRESS_KEY_PREFIX}.anon`,
      [],
    );
    if (localRecords.length) setRecords(localRecords);

    let cancelled = false;

    const load = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) {
          if (!cancelled) setLoaded(true);
          return;
        }

        const res = await fetch("/api/cleaner/tours", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          if (!cancelled) setLoaded(true);
          return;
        }
        const json = (await res.json()) as {
          cleanerId?: string | null;
          settings?: unknown;
          progress?: TourProgressRecord[];
        };
        if (cancelled) return;

        if (json.cleanerId) setCleanerId(String(json.cleanerId));
        if (json.settings) setSettings(json.settings as TourSettings);
        if (Array.isArray(json.progress) && json.progress.length) {
          setRecords(json.progress);
        }
      } catch {
        // Offline or the route is unavailable. The walkthroughs still run;
        // they just track locally until the next successful load.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Persist ─────────────────────────────────────────────────────────────

  const persist = useCallback(
    (tour: Tour, status: TourProgressRecord["status"], stepIndex: number) => {
      const now = new Date().toISOString();
      const record: TourProgressRecord = {
        tourId: tour.id,
        version: tour.version,
        status,
        lastStepIndex: stepIndex,
        startedAt: now,
        completedAt: status === "completed" ? now : null,
        updatedAt: now,
      };

      setRecords((prev) => {
        const next = prev.filter((r) => r.tourId !== tour.id).concat(record);
        writeJson(local(), progressKey, next);
        // Also keep the anon copy current, so progress made before the
        // cleaner row resolved isn't stranded under a key nothing reads.
        writeJson(local(), `${PROGRESS_KEY_PREFIX}.anon`, next);
        return next;
      });

      void (async () => {
        try {
          const { data } = await supabase.auth.getSession();
          const token = data?.session?.access_token;
          if (!token) return;
          await fetch("/api/cleaner/tours", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              tourId: tour.id,
              status,
              lastStepIndex: stepIndex,
            }),
          });
        } catch {
          // Kept locally; the next write will carry the newer state anyway.
        }
      })();
    },
    [progressKey],
  );

  const park = useCallback((value: ActiveTour | null) => {
    const store = session();
    if (!store) return;
    try {
      if (value) store.setItem(ACTIVE_KEY, JSON.stringify(value));
      else store.removeItem(ACTIVE_KEY);
    } catch {
      // Non-fatal: the walkthrough still runs, it just won't survive a
      // cross-layout navigation.
    }
  }, []);

  // ── Navigation ──────────────────────────────────────────────────────────

  /**
   * Put the contractor on the screen a step is about, when we can.
   *
   * Token-scoped screens (the on-site checklist and photo pages) have no
   * navigable path — we can't fabricate a job link, and dropping someone into
   * a real job's checklist mid-walkthrough risks a stray tap checking off work
   * that hasn't been done. Those steps explain themselves instead.
   */
  const ensureScreen = useCallback(
    (step: TourStep) => {
      const screen = TOUR_SCREENS[step.screen];
      if (!screen || !screen.path || screen.tokenScoped) return;
      if (pathname === screen.path) return;
      // The dashboard has a mobile twin; either one satisfies a dashboard step.
      if (
        step.screen === "dashboard" &&
        pathname === TOUR_SCREENS.mobileDashboard.path
      ) {
        return;
      }
      router.push(screen.path);
    },
    [pathname, router],
  );

  const goToStep = useCallback(
    (tour: Tour, index: number) => {
      const clamped = Math.min(Math.max(index, 0), tour.steps.length - 1);
      const next = { tourId: tour.id, stepIndex: clamped };
      setActive(next);
      park(next);
      persist(tour, "in_progress", clamped);
      ensureScreen(tour.steps[clamped]);
    },
    [ensureScreen, park, persist],
  );

  const start = useCallback(
    (tourId: string) => {
      const tour = getTour(tourId);
      if (!tour) return;
      setSuggestion(null);
      const from = resumeStepIndex(tour, findProgress(records, tour.id));
      goToStep(tour, from);
    },
    [goToStep, records],
  );

  const finish = useCallback(
    (tour: Tour, status: "completed" | "skipped", stepIndex: number) => {
      persist(tour, status, stepIndex);
      setActive(null);
      park(null);

      // Offer the next one in the sequence rather than launching it. Asking
      // is the difference between a sequence and an obstacle.
      const answered = records
        .filter((r) => r.tourId !== tour.id)
        .concat({
          tourId: tour.id,
          version: tour.version,
          status,
          lastStepIndex: stepIndex,
          startedAt: null,
          completedAt: null,
          updatedAt: null,
        });
      const owed = toursToOffer(answered, settings);
      setSuggestion(owed.length ? owed[0] : null);
    },
    [park, persist, records, settings],
  );

  const next = useCallback(() => {
    if (!active) return;
    const tour = getTour(active.tourId);
    if (!tour) return;
    if (active.stepIndex >= tour.steps.length - 1) {
      finish(tour, "completed", active.stepIndex);
      return;
    }
    goToStep(tour, active.stepIndex + 1);
  }, [active, finish, goToStep]);

  const back = useCallback(() => {
    if (!active) return;
    const tour = getTour(active.tourId);
    if (!tour || active.stepIndex === 0) return;
    goToStep(tour, active.stepIndex - 1);
  }, [active, goToStep]);

  const skip = useCallback(() => {
    if (!active) return;
    const tour = getTour(active.tourId);
    if (!tour) return;
    finish(tour, "skipped", active.stepIndex);
  }, [active, finish]);

  const dismissSuggestion = useCallback(() => {
    setSuggestion(null);
    writeJson(session(), DISMISS_KEY, true);
  }, []);

  // ── First-login sequence ────────────────────────────────────────────────

  useEffect(() => {
    if (!loaded || active || autoStartChecked.current) return;
    if (!AUTO_START_PATHS.includes(pathname || "")) return;
    if (readJson<boolean>(session(), DISMISS_KEY, false)) return;

    autoStartChecked.current = true;
    const owed = toursToOffer(records, settings);
    if (!owed.length) return;

    // Start the first one outright — on a genuine first login there is no
    // progress at all, and a contractor who has never seen the dashboard
    // benefits more from being shown it than from being asked whether they'd
    // like to be shown it. Everything after this one is offered, not imposed.
    start(owed[0].id);
  }, [active, loaded, pathname, records, settings, start]);

  // ── Context ─────────────────────────────────────────────────────────────

  const standings = useMemo(() => {
    const rows = standingRows(records);
    return rows.reduce<Record<string, TourStanding>>((acc, row) => {
      acc[row.tourId] = row.standing;
      return acc;
    }, {});
  }, [records]);

  const activeTour = active ? getTour(active.tourId) : null;

  const value = useMemo<TourContextValue>(
    () => ({
      active,
      tours: TOURS,
      standings,
      loaded,
      suggestion,
      start,
      next,
      back,
      skip,
      dismissSuggestion,
    }),
    [active, back, dismissSuggestion, loaded, next, skip, standings, start, suggestion],
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      {activeTour && active && (
        <TourOverlay
          tour={activeTour}
          stepIndex={active.stepIndex}
          onNext={next}
          onBack={back}
          onSkip={skip}
        />
      )}
      {!active && suggestion && (
        <TourSuggestion
          tour={suggestion}
          onStart={() => start(suggestion.id)}
          onDismiss={dismissSuggestion}
        />
      )}
    </TourContext.Provider>
  );
}

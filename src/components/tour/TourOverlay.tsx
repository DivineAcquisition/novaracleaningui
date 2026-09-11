"use client";

// ─── Tour overlay ────────────────────────────────────────────────────────────
//
// Dims the page, cuts a hole over the element the current step is about, and
// puts a card next to it.
//
// Two decisions worth knowing about:
//
//   The dim layer swallows clicks, including over the highlighted element.
//   Most product tours let you click through, but three of these walkthroughs
//   run on a live job checklist, and a contractor tapping what they think is
//   a tour card could check off work they haven't done. Reading a walkthrough
//   should never be able to change a job. Skip is always one tap away.
//
//   A step whose element isn't on the page doesn't disappear — it shows its
//   fallback text instead. That's what keeps the walkthroughs honest: when a
//   screen changes, a step degrades into a plain explanation rather than
//   pointing confidently at the wrong thing.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCheckLine,
  RiCloseLine,
  RiInformationLine,
} from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { findAnchor } from "@/lib/tours/anchors";
import { TOUR_SCREENS, type Tour } from "@/lib/tours/catalog";
import { cn } from "@/lib/utils";

/** How long to wait for an element to show up before falling back. */
const ANCHOR_TIMEOUT_MS = 3500;
const ANCHOR_POLL_MS = 120;
const SPOTLIGHT_PADDING = 6;
const CARD_GAP = 12;
const CARD_WIDTH = 340;
const VIEWPORT_MARGIN = 12;
/** Below this width the card becomes a bottom sheet. */
const COMPACT_BREAKPOINT = 640;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function measure(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function TourOverlay({
  tour,
  stepIndex,
  onNext,
  onBack,
  onSkip,
}: {
  tour: Tour;
  stepIndex: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const step = tour.steps[stepIndex];
  const cardRef = useRef<HTMLDivElement | null>(null);

  const [rect, setRect] = useState<Rect | null>(null);
  // "looking" keeps the card from flashing its fallback text during the beat
  // between a navigation and the target screen rendering.
  const [looking, setLooking] = useState(false);
  const [compact, setCompact] = useState(false);
  const [cardSize, setCardSize] = useState({ width: CARD_WIDTH, height: 200 });

  useEffect(() => {
    const sync = () => setCompact(window.innerWidth < COMPACT_BREAKPOINT);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  // ── Find the element this step is about ──────────────────────────────────

  useEffect(() => {
    setRect(null);

    if (!step?.anchor) {
      setLooking(false);
      return;
    }

    setLooking(true);
    let cancelled = false;
    const startedAt = Date.now();

    const attempt = () => {
      if (cancelled) return;
      const el = findAnchor(step.anchor!);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        // Let the smooth scroll settle before measuring, or the hole lands
        // where the element used to be.
        window.setTimeout(() => {
          if (!cancelled) {
            setRect(measure(el));
            setLooking(false);
          }
        }, 320);
        return;
      }
      if (Date.now() - startedAt > ANCHOR_TIMEOUT_MS) {
        setLooking(false);
        return;
      }
      window.setTimeout(attempt, ANCHOR_POLL_MS);
    };

    attempt();
    return () => {
      cancelled = true;
    };
  }, [step, stepIndex, tour.id]);

  // Keep the hole over the element while the page moves under it.
  useEffect(() => {
    if (!step?.anchor || !rect) return;

    let frame = 0;
    const remeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = findAnchor(step.anchor!);
        if (el) setRect(measure(el));
      });
    };

    window.addEventListener("scroll", remeasure, true);
    window.addEventListener("resize", remeasure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", remeasure, true);
      window.removeEventListener("resize", remeasure);
    };
  }, [rect, step]);

  useEffect(() => {
    if (!cardRef.current) return;
    const el = cardRef.current;
    const update = () =>
      setCardSize({ width: el.offsetWidth, height: el.offsetHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [stepIndex, rect, compact]);

  // ── Keyboard ─────────────────────────────────────────────────────────────

  const handleKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onSkip();
        return;
      }
      if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        onNext();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onBack();
      }
    },
    [onBack, onNext, onSkip],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, [stepIndex]);

  if (!step) return null;

  const isLast = stepIndex >= tour.steps.length - 1;
  const showingFallback = Boolean(step.anchor) && !rect && !looking;
  const screen = TOUR_SCREENS[step.screen];

  // Body copy: the step's own text when we found the element, its fallback
  // when we didn't. The fallback is required by the type whenever an anchor is
  // set, so this can't end up empty.
  const body = showingFallback ? step.fallback || step.body : step.body;

  const cardStyle = !compact && rect
    ? cardPosition(rect, cardSize, step.placement || "auto")
    : null;

  return (
    <div
      className="fixed inset-0 z-[80]"
      role="dialog"
      aria-modal="true"
      aria-label={`${tour.title} — step ${stepIndex + 1} of ${tour.steps.length}`}
    >
      {/* Dim. Four panels around the hole rather than one box-shadowed
          element, so the highlighted area stays crisp at any zoom level. */}
      {rect ? (
        <>
          <Dim style={{ top: 0, left: 0, right: 0, height: Math.max(rect.top - SPOTLIGHT_PADDING, 0) }} />
          <Dim style={{ top: rect.top + rect.height + SPOTLIGHT_PADDING, left: 0, right: 0, bottom: 0 }} />
          <Dim
            style={{
              top: Math.max(rect.top - SPOTLIGHT_PADDING, 0),
              left: 0,
              width: Math.max(rect.left - SPOTLIGHT_PADDING, 0),
              height: rect.height + SPOTLIGHT_PADDING * 2,
            }}
          />
          <Dim
            style={{
              top: Math.max(rect.top - SPOTLIGHT_PADDING, 0),
              left: rect.left + rect.width + SPOTLIGHT_PADDING,
              right: 0,
              height: rect.height + SPOTLIGHT_PADDING * 2,
            }}
          />
          {/* The hole itself still absorbs clicks — see the header note. */}
          <div
            aria-hidden
            onClick={(e) => e.preventDefault()}
            className="absolute rounded-xl ring-2 ring-primary ring-offset-2 ring-offset-transparent pointer-events-auto transition-all duration-200"
            style={{
              top: rect.top - SPOTLIGHT_PADDING,
              left: rect.left - SPOTLIGHT_PADDING,
              width: rect.width + SPOTLIGHT_PADDING * 2,
              height: rect.height + SPOTLIGHT_PADDING * 2,
            }}
          />
        </>
      ) : (
        <Dim style={{ inset: 0 }} />
      )}

      <div
        ref={cardRef}
        tabIndex={-1}
        className={cn(
          "absolute bg-background rounded-2xl shadow-2xl border p-4 space-y-3 outline-none",
          compact || !rect
            ? "left-3 right-3 bottom-3 sm:left-1/2 sm:right-auto sm:bottom-auto sm:top-1/2 sm:w-[340px] sm:-translate-x-1/2 sm:-translate-y-1/2"
            : "w-[340px]",
        )}
        style={cardStyle || undefined}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              {tour.title} · {stepIndex + 1} of {tour.steps.length}
            </p>
            <h2 className="font-semibold text-base leading-snug mt-0.5">{step.title}</h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0 -mr-1 -mt-1"
            onClick={onSkip}
            aria-label="Close walkthrough"
          >
            <RiCloseLine className="w-4 h-4" />
          </Button>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed" aria-live="polite">
          {body}
        </p>

        {/* When the element isn't here, say where it is. A contractor being
            told about a button they can't see should know that's expected —
            not wonder whether their app is broken. */}
        {showingFallback && (
          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5 rounded-lg bg-muted/60 px-2.5 py-2">
            <RiInformationLine className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
            <span>
              {screen?.tokenScoped
                ? `This is on ${screen.label}, which opens from the link dispatch sends you for each job.`
                : `This appears on ${screen?.label || "another screen"} once you have one.`}
            </span>
          </p>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Skip for now
          </button>

          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <Button variant="outline" size="sm" onClick={onBack}>
                <RiArrowLeftLine className="w-3.5 h-3.5 mr-1" />
                Back
              </Button>
            )}
            <Button size="sm" onClick={onNext}>
              {isLast ? (
                <>
                  <RiCheckLine className="w-3.5 h-3.5 mr-1" />
                  Done
                </>
              ) : (
                <>
                  Next
                  <RiArrowRightLine className="w-3.5 h-3.5 ml-1" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Dim({ style }: { style: React.CSSProperties }) {
  return (
    <div
      aria-hidden
      className="absolute bg-slate-950/60 pointer-events-auto"
      style={style}
    />
  );
}

/**
 * Put the card beside the highlighted element, inside the viewport.
 *
 * The requested placement is a preference, not a promise — an element near
 * the bottom of the screen gets its card above it regardless of what the step
 * asked for, because a card hanging off the bottom edge is unreadable.
 */
function cardPosition(
  rect: Rect,
  card: { width: number; height: number },
  placement: "auto" | "top" | "bottom" | "left" | "right",
): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const room = {
    top: rect.top,
    bottom: vh - (rect.top + rect.height),
    left: rect.left,
    right: vw - (rect.left + rect.width),
  };

  const fits = {
    top: room.top >= card.height + CARD_GAP + VIEWPORT_MARGIN,
    bottom: room.bottom >= card.height + CARD_GAP + VIEWPORT_MARGIN,
    left: room.left >= card.width + CARD_GAP + VIEWPORT_MARGIN,
    right: room.right >= card.width + CARD_GAP + VIEWPORT_MARGIN,
  };

  const order: Array<"bottom" | "top" | "right" | "left"> =
    placement === "auto"
      ? ["bottom", "top", "right", "left"]
      : ([placement, "bottom", "top", "right", "left"].filter(
          (v, i, arr) => arr.indexOf(v) === i,
        ) as Array<"bottom" | "top" | "right" | "left">);

  const chosen = order.find((side) => fits[side]) || "bottom";

  const clamp = (value: number, size: number, max: number) =>
    Math.min(Math.max(value, VIEWPORT_MARGIN), Math.max(max - size - VIEWPORT_MARGIN, VIEWPORT_MARGIN));

  if (chosen === "bottom" || chosen === "top") {
    const left = clamp(rect.left + rect.width / 2 - card.width / 2, card.width, vw);
    const top =
      chosen === "bottom"
        ? rect.top + rect.height + CARD_GAP
        : rect.top - card.height - CARD_GAP;
    return { top: clamp(top, card.height, vh), left };
  }

  const top = clamp(rect.top + rect.height / 2 - card.height / 2, card.height, vh);
  const left =
    chosen === "right" ? rect.left + rect.width + CARD_GAP : rect.left - card.width - CARD_GAP;
  return { top, left: clamp(left, card.width, vw) };
}

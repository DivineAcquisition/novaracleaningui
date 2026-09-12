"use client";

// ─── "Next walkthrough" prompt ───────────────────────────────────────────────
//
// Shown after a walkthrough ends when another is still owed. Deliberately an
// offer and not a launch: the first-login sequence is seven walkthroughs, and
// chaining them automatically would put a quarter of an hour between a
// contractor and the job details they opened the app to read.
//
// Dismissing it is remembered for the session, so nobody gets asked twice on
// the way to doing something else.

import { RiCloseLine, RiPlayCircleLine } from "@remixicon/react";

import { Button } from "@/components/ui/button";
import type { Tour } from "@/lib/tours/catalog";

export function TourSuggestion({
  tour,
  onStart,
  onDismiss,
}: {
  tour: Tour;
  onStart: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="fixed bottom-4 left-3 right-3 sm:left-auto sm:right-4 sm:w-[360px] z-[70] rounded-2xl border bg-background shadow-2xl p-4 space-y-3"
      role="status"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Next walkthrough
          </p>
          <p className="font-semibold text-sm mt-0.5">{tour.title}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 flex-shrink-0 -mr-1 -mt-1"
          onClick={onDismiss}
          aria-label="Not now"
        >
          <RiCloseLine className="w-4 h-4" />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{tour.summary}</p>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Not now
        </Button>
        <Button size="sm" onClick={onStart}>
          <RiPlayCircleLine className="w-3.5 h-3.5 mr-1" />
          Start
        </Button>
      </div>
    </div>
  );
}

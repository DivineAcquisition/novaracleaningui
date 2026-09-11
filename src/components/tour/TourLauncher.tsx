"use client";

// ─── Help & training launcher ────────────────────────────────────────────────
//
// The on-demand way into the walkthroughs, so they aren't a one-time thing
// that happened during onboarding and can never be repeated. Lives in the
// portal sidebar next to the nav.
//
// Every walkthrough is listed with where the contractor stands on it, and
// every one can be replayed — including finished ones. Somebody re-reading
// the photo walkthrough before a job they're nervous about is the whole point.

import { useState } from "react";
import Link from "next/link";
import {
  RiPlayCircleLine,
  RiQuestionLine,
  RiRefreshLine,
  RiVideoLine,
} from "@remixicon/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TOUR, tourAnchor } from "@/lib/tours/anchors";
import { STANDING_LABEL, type TourStanding } from "@/lib/tours/progress";
import { cn } from "@/lib/utils";
import { useToursOptional } from "./TourProvider";

const STANDING_STYLE: Record<TourStanding, string> = {
  never: "bg-muted text-muted-foreground",
  in_progress: "bg-amber-500/10 text-amber-700",
  skipped: "bg-muted text-muted-foreground",
  completed: "bg-emerald-500/10 text-emerald-700",
  outdated: "bg-sky-500/10 text-sky-700",
};

function minutesLabel(seconds: number): string {
  if (seconds < 90) return "about a minute";
  return `about ${Math.round(seconds / 60)} minutes`;
}

export function TourLauncher({
  /**
   * "sidebar" sits in the portal nav. "floating" is for the token-linked job
   * pages, which have no chrome at all — a contractor standing in a kitchen
   * with the checklist open is the person most likely to want the checklist
   * walkthrough, so it needs to be reachable from there.
   */
  variant = "sidebar",
}: {
  variant?: "sidebar" | "floating";
} = {}) {
  const tours = useToursOptional();
  const [open, setOpen] = useState(false);

  // The chrome renders on pages that don't mount the engine. Hiding the
  // button beats showing one that can't do anything.
  if (!tours) return null;

  const launch = (id: string) => {
    setOpen(false);
    tours.start(id);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {variant === "floating" ? (
          <Button
            variant="secondary"
            size="sm"
            className="fixed bottom-4 right-4 z-50 rounded-full shadow-lg gap-2 h-10"
            {...tourAnchor(TOUR.helpButton)}
          >
            <RiQuestionLine className="w-4 h-4" />
            Help
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            {...tourAnchor(TOUR.helpButton)}
          >
            <RiQuestionLine className="w-4 h-4" />
            Help &amp; training
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Walkthroughs</DialogTitle>
          <DialogDescription>
            Short guided tours of your own dashboard. Each one runs on the real
            screen, so what you see is what you&apos;ll be using. Stop any of them
            whenever you like — your place is saved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {tours.tours.map((tour) => {
            const standing = tours.standings[tour.id] || "never";
            const seen = standing === "completed" || standing === "outdated";
            return (
              <div
                key={tour.id}
                // The recorder starts each walkthrough by clicking the real
                // button in this list. Matching the row on its heading text
                // meant matching whichever nested div happened to contain the
                // words, which is not the one holding the button.
                data-tour-row={tour.id}
                className="rounded-xl border p-3 flex items-start justify-between gap-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm">{tour.title}</p>
                    <Badge
                      variant="secondary"
                      className={cn("text-[10px] px-1.5 py-0 border-0", STANDING_STYLE[standing])}
                    >
                      {STANDING_LABEL[standing]}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-snug">{tour.summary}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {tour.steps.length} steps · {minutesLabel(tour.estimatedSeconds)}
                  </p>
                </div>

                <Button
                  size="sm"
                  variant={seen ? "outline" : "default"}
                  className="flex-shrink-0"
                  onClick={() => launch(tour.id)}
                >
                  {seen ? (
                    <>
                      <RiRefreshLine className="w-3.5 h-3.5 mr-1" />
                      Replay
                    </>
                  ) : (
                    <>
                      <RiPlayCircleLine className="w-3.5 h-3.5 mr-1" />
                      Start
                    </>
                  )}
                </Button>
              </div>
            );
          })}
        </div>

        <div className="rounded-xl bg-muted/50 p-3 flex items-start gap-2.5">
          <RiVideoLine className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-semibold">Prefer to watch?</p>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Every walkthrough also has a short recorded version with captions,
              so you can watch with the sound off.
            </p>
            <Link
              href="/cleaner/training#recordings"
              className="text-[11px] font-semibold text-primary hover:underline"
              onClick={() => setOpen(false)}
            >
              Open the recordings →
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

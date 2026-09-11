"use client";

// ─── Recorded walkthroughs, on the training page ─────────────────────────────
//
// The watch-instead-of-click version of the same seven walkthroughs. Useful
// for a contractor who wants to see the job flow before they're standing in
// someone's kitchen, and for anyone on a slow connection who'd rather not
// have an overlay chasing them around the app.
//
// Three things this section is careful about:
//
//   1. The clips are silent. Captions are the content, not a courtesy, so
//      the caption track is loaded alongside the video and the player says
//      so up front rather than letting someone assume their volume is broken.
//
//   2. A clip can go out of date; the interactive walkthrough cannot. So when
//      the manifest says a recording is behind the live screens, that shows
//      up on the card, next to a button that runs the current version. An
//      out-of-date clip stays watchable — most of it is still right — but
//      nobody watches it thinking it's current.
//
//   3. The video files live in a private bucket. Nothing here is a public
//      URL; every play fetches a short-lived signed URL for the clip and its
//      captions, so the media is as gated as the rest of the portal.

import { useState } from "react";
import {
  RiAlertLine,
  RiCheckboxCircleLine,
  RiClosedCaptioningLine,
  RiLoader4Line,
  RiPlayCircleLine,
  RiVideoLine,
} from "@remixicon/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { TOUR, tourAnchor } from "@/lib/tours/anchors";
import {
  RECORDINGS_BUCKET,
  recordingRows,
  type RecordingRow,
} from "@/lib/tours/recordings";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useToursOptional } from "./TourProvider";

/** Long enough to watch a 90-second clip twice, short enough to not be a link worth sharing. */
const SIGNED_URL_TTL_SECONDS = 600;

interface PlayerSource {
  videoUrl: string;
  captionUrl: string | null;
}

export function TourRecordings() {
  const tours = useToursOptional();
  const rows = recordingRows();

  const [playing, setPlaying] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [sources, setSources] = useState<Record<string, PlayerSource>>({});

  const play = async (row: RecordingRow) => {
    if (!row.recording) return;
    if (sources[row.tourId]) {
      setPlaying(row.tourId);
      return;
    }

    setLoadingId(row.tourId);
    try {
      const wanted = [row.recording.file, row.recording.captionFile].filter(Boolean);
      const { data, error } = await supabase.storage
        .from(RECORDINGS_BUCKET)
        .createSignedUrls(wanted, SIGNED_URL_TTL_SECONDS);

      if (error) throw error;

      const byPath = new Map(
        (data || []).map((entry) => [entry.path, entry.signedUrl]),
      );
      const videoUrl = byPath.get(row.recording.file);
      if (!videoUrl) throw new Error("no signed url for the clip");

      setSources((prev) => ({
        ...prev,
        [row.tourId]: {
          videoUrl,
          captionUrl: byPath.get(row.recording!.captionFile) || null,
        },
      }));
      setPlaying(row.tourId);
    } catch (err) {
      console.error("[TourRecordings] signed url error", err);
      // The interactive walkthrough covers the same ground, so a broken clip
      // is an inconvenience rather than a dead end. Say that.
      toast.error("Could not load that clip. The guided walkthrough covers the same steps.");
    } finally {
      setLoadingId(null);
    }
  };

  const recorded = rows.filter((r) => r.recording).length;

  return (
    <section id="recordings" className="space-y-3 scroll-mt-6" {...tourAnchor(TOUR.trainingRecordings)}>
      <div className="flex items-center justify-between gap-3 px-1 flex-wrap">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Recorded Walkthroughs
        </h2>
        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
          <RiClosedCaptioningLine className="w-3.5 h-3.5" />
          Captioned · no sound needed
        </span>
      </div>

      <Card className="border-border/60">
        <CardContent className="p-4 space-y-1.5">
          <p className="text-xs text-foreground/90 leading-snug">
            These seven walkthroughs are required before your first job.
            Watch the clip through to the end, or run the live guided version
            and finish it. Skipping does not count.
          </p>
          <p className="text-[11px] text-muted-foreground">
            {recorded === 0
              ? "Clips are being produced. In the meantime every walkthrough runs live on your own dashboard."
              : `${recorded} of ${rows.length} available. The guided version is always current.`}
          </p>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {rows.map((row) => {
          const isPlaying = playing === row.tourId;
          const source = sources[row.tourId];
          const watched = tours?.standings[row.tourId] === "completed";

          return (
            <Card
              key={row.tourId}
              className={cn(
                "border-border/60 overflow-hidden",
                watched && "border-emerald-500/30",
                row.stale && !watched && "border-amber-500/40",
              )}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold">{row.title}</h3>
                      {watched ? (
                        <Badge
                          variant="secondary"
                          className="bg-emerald-500/10 text-emerald-700 text-[10px] px-1.5 py-0 border-0"
                        >
                          Watched
                        </Badge>
                      ) : null}
                      {row.recording ? (
                        <Badge
                          variant="secondary"
                          className="bg-primary/10 text-primary text-[10px] px-1.5 py-0 border-0"
                        >
                          {row.recording.durationSeconds}s
                        </Badge>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="bg-muted text-muted-foreground text-[10px] px-1.5 py-0 border-0"
                        >
                          Guided only
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-snug">
                      {row.summary}
                    </p>
                    {!row.recording ? (
                      <p className="text-[11px] text-muted-foreground">
                        No clip yet — tap Guide me and finish the live walkthrough.
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    {row.recording && !isPlaying && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void play(row)}
                        disabled={loadingId === row.tourId}
                      >
                        {loadingId === row.tourId ? (
                          <RiLoader4Line className="w-3.5 h-3.5 mr-1 animate-spin" />
                        ) : watched ? (
                          <RiCheckboxCircleLine className="w-3.5 h-3.5 mr-1" />
                        ) : (
                          <RiVideoLine className="w-3.5 h-3.5 mr-1" />
                        )}
                        {watched ? "Rewatch" : "Watch"}
                      </Button>
                    )}
                    {tours && (
                      <Button
                        size="sm"
                        variant={row.recording && !row.stale ? "ghost" : "default"}
                        onClick={() => tours.start(row.tourId)}
                      >
                        <RiPlayCircleLine className="w-3.5 h-3.5 mr-1" />
                        Guide me
                      </Button>
                    )}
                  </div>
                </div>

                {row.note && (
                  <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5 flex items-start gap-2">
                    <RiAlertLine className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-900/90 leading-snug">
                      {row.note}
                    </p>
                  </div>
                )}

                {isPlaying && source && (
                  <div className="space-y-1.5">
                    <video
                      src={source.videoUrl}
                      controls
                      autoPlay
                      playsInline
                      // Silent by design — captions carry the narration. Muted
                      // also keeps autoplay from being blocked.
                      muted
                      onEnded={() => tours?.completeTour(row.tourId)}
                      className="w-full rounded-lg bg-black"
                    >
                      {source.captionUrl && (
                        <track
                          kind="captions"
                          src={source.captionUrl}
                          srcLang="en"
                          label="English"
                          default
                        />
                      )}
                    </video>
                    <p className="text-[10px] text-muted-foreground">
                      No audio — turn captions on with the CC control if they
                      aren&apos;t showing.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

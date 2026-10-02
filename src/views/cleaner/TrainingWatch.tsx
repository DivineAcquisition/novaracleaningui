"use client";

// Same expectation-video page as /cleaner/training, opened from a
// tokenized link. No contractor session, and finishing the video does
// not stamp anyone's training record.

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { RiGraduationCapLine, RiLoader4Line, RiPlayCircleLine } from "@remixicon/react";

import { WistiaPlayer } from "@/components/cleaner/WistiaPlayer";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/SEO";
import { EXPECTATION_MEDIA_ID } from "@/lib/training-expectation";

const WATCHED_KEY = `novara.training.expectation.${EXPECTATION_MEDIA_ID}.watch-link`;

export default function TrainingWatchPage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [watched, setWatched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/cleaner/training-watch/${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setMessage(String(body?.error || "This training link isn't valid."));
          return;
        }
        try {
          setWatched(window.localStorage.getItem(WATCHED_KEY) === "1");
        } catch {
          setWatched(false);
        }
      } catch {
        if (!cancelled) setMessage("Couldn't open this training link.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onEnded = useCallback(() => {
    try {
      window.localStorage.setItem(WATCHED_KEY, "1");
    } catch {
      // The button still unlocks for this visit.
    }
    setWatched(true);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center space-y-4">
          <RiLoader4Line className="w-10 h-10 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground text-sm">Loading training…</p>
        </div>
      </div>
    );
  }

  if (message) {
    return (
      <div className="mx-auto max-w-md py-24 text-center space-y-3">
        <h1 className="text-xl font-semibold font-jakarta">Training link</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <SEO title="What to expect" noindex />
      <main className="space-y-5">
        <section className="text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <RiPlayCircleLine className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold font-jakarta tracking-tight">
            What to expect
          </h1>
          <p className="text-sm text-muted-foreground max-w-lg mx-auto">
            Watch this video all the way through. It is how you learn what a
            job looks like before you open the app. The button under the
            video stays off until the video ends.
          </p>
        </section>

        <div className="overflow-hidden rounded-xl border bg-black">
          <WistiaPlayer
            mediaId={EXPECTATION_MEDIA_ID}
            aspect={1.7777777777777777}
            placeholderPaddingTop="56.25%"
            onEnded={onEnded}
          />
        </div>

        <div className="space-y-3 text-center">
          <p className="text-sm font-medium">
            {watched
              ? "You finished the video. The app walkthroughs are next."
              : "The whole video has to play before you can continue."}
          </p>
          <Button
            size="lg"
            disabled={!watched}
            onClick={() => router.push("/cleaner/training/app")}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <RiGraduationCapLine className="w-4 h-4 mr-1.5" />
            {watched ? "Continue to app training" : "Watch the full video to continue"}
          </Button>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            App training is the walkthrough of Offers, a job card, and the
            checklist. Finish those videos before your first job. Skipping
            them does not count.
          </p>
        </div>
      </main>
    </div>
  );
}

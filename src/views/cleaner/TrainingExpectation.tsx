"use client";

// Last onboarding step. One video about what a job feels like, then a
// button into the app walkthroughs that were already on the training hub.
// The button stays off until the video reaches the end.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RiGraduationCapLine, RiLoader4Line, RiPlayCircleLine } from "@remixicon/react";

import { WistiaPlayer } from "@/components/cleaner/WistiaPlayer";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/SEO";
import { supabase } from "@/integrations/supabase/client";
import { resolveCleanerAuth, isBlockedCleanerStatus } from "@/lib/cleaner-auth";
import {
  EXPECTATION_MEDIA_ID,
  hasWatchedExpectationVideo,
  markExpectationVideoWatched,
} from "@/lib/training-expectation";
import { toast } from "sonner";

export default function TrainingExpectationPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [cleanerId, setCleanerId] = useState<string | null>(null);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [watched, setWatched] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const { cleaner: resolved, routing } = await resolveCleanerAuth();
        if (routing === "auth") {
          toast.error("Please sign in to access training");
          router.replace("/cleaner/auth");
          return;
        }
        if (!resolved) {
          toast.info("Please complete your profile first");
          router.replace("/cleaner/onboarding");
          return;
        }
        if (isBlockedCleanerStatus(resolved.status)) {
          toast.error("Your account is not currently active. Contact support.");
          router.replace("/cleaner/auth");
          return;
        }

        const { data: row, error } = await supabase
          .from("cleaners")
          .select("id, first_name, ob_training_accessed")
          .eq("id", resolved.id)
          .maybeSingle();
        if (error) throw error;
        if (!row) {
          toast.info("Please complete your profile first");
          router.replace("/cleaner/onboarding");
          return;
        }

        setCleanerId(row.id);
        setFirstName(row.first_name);
        setWatched(hasWatchedExpectationVideo(row.id));

        if (!row.ob_training_accessed) {
          void supabase
            .from("cleaners")
            .update({
              ob_training_accessed: true,
              ob_training_accessed_at: new Date().toISOString(),
            })
            .eq("id", row.id);
        }
      } catch (err) {
        console.error("[TrainingExpectation] load error", err);
        toast.error("Could not load training. Please try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const onEnded = useCallback(() => {
    if (!cleanerId) return;
    markExpectationVideoWatched(cleanerId);
    setWatched(true);
  }, [cleanerId]);

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

  if (!cleanerId) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <SEO title="What to expect" noindex />
      <main className="space-y-5">
        <section className="text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <RiPlayCircleLine className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold font-jakarta tracking-tight">
            What to expect{firstName?.trim() ? `, ${firstName.trim()}` : ""}
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

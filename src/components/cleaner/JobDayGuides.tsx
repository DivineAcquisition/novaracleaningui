"use client";

// The dress code and job-day graphics, plus the one acknowledgment that
// covers both. Mounted by step 2 of the onboarding portal; kept separate from
// it so the same panel can be dropped into Training later without the
// onboarding step's save logic coming along.
//
// Each graphic carries its own text version in a disclosure. It is open by
// default only when the image failed to load, so a contractor is never stuck
// looking at a broken box — and it is always available for anyone who would
// rather read than squint at a diagram on a phone.

import {
  RiAlertLine,
  RiCheckboxCircleFill,
  RiExternalLinkLine,
  RiLoader4Line,
} from "@remixicon/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OnboardingGuide } from "@/lib/cleaner-onboarding-guides";

export interface JobDayGuidesProps {
  guides: OnboardingGuide[];
  /** Non-null once the contractor has acknowledged. */
  acknowledgedAt: string | null;
  /** Throw with a message to surface an error inline. */
  onAcknowledge: () => Promise<void>;
  /** "plain" drops card chrome so this can nest inside an onboarding step. */
  variant?: "card" | "plain";
}

function GuidePanel({ guide, variant }: { guide: OnboardingGuide; variant: "card" | "plain" }) {
  const [imageBroken, setImageBroken] = useState(false);

  return (
    <section
      className={cn(
        "space-y-3",
        variant === "card"
          ? "rounded-2xl border border-border bg-card p-5 shadow-sm"
          : "border-t border-border/60 pt-4",
      )}
    >
      <div>
        <h3 className="text-sm font-semibold text-foreground">{guide.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{guide.lede}</p>
      </div>

      {imageBroken ? (
        <p className="inline-flex items-start gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <RiAlertLine className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          The graphic didn&apos;t load. Everything it says is written out below.
        </p>
      ) : (
        <a
          href={guide.image}
          target="_blank"
          rel="noreferrer"
          className="group block overflow-hidden rounded-xl border border-border bg-muted/40"
        >
          <img
            src={guide.image}
            alt={guide.alt}
            loading="lazy"
            onError={() => setImageBroken(true)}
            className="w-full"
          />
          <span className="flex items-center justify-end gap-1 px-3 py-1.5 text-[11px] text-muted-foreground group-hover:text-primary">
            <RiExternalLinkLine className="h-3 w-3" />
            Open full size
          </span>
        </a>
      )}

      <details open={imageBroken} className="rounded-xl border border-border bg-muted/30 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-foreground">
          {guide.title} as text
        </summary>
        <ul className="mt-2 space-y-1.5">
          {guide.points.map((point) => (
            <li key={point} className="flex items-start gap-2 text-sm leading-snug text-foreground">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </details>

      {guide.footnote ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{guide.footnote}</p>
      ) : null}
    </section>
  );
}

export function JobDayGuides({
  guides,
  acknowledgedAt,
  onAcknowledge,
  variant = "card",
}: JobDayGuidesProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acked, setAcked] = useState<string | null>(acknowledgedAt);

  const acknowledge = async () => {
    setSaving(true);
    setError(null);
    try {
      await onAcknowledge();
      setAcked(new Date().toISOString());
    } catch (e) {
      setError((e as Error).message || "Couldn't save that. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {guides.map((guide) => (
        <GuidePanel key={guide.id} guide={guide} variant={variant} />
      ))}

      <div className={cn(variant === "plain" && "border-t border-border/60 pt-4")}>
        {acked ? (
          <p className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <RiCheckboxCircleFill className="h-4 w-4" />
            Read — thanks. Both are here whenever you want them again.
          </p>
        ) : (
          <>
            {error ? <p className="mb-3 text-sm text-rose-600">{error}</p> : null}
            <Button className="w-full" disabled={saving} onClick={() => void acknowledge()}>
              {saving ? (
                <>
                  <RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "I've read both"
              )}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

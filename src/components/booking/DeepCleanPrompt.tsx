"use client";

import { RiAlertLine, RiSparklingLine } from "@remixicon/react";
import { cn } from "@/lib/utils";

export type DeepCleanedBefore = "yes" | "no" | "";

export interface DeepCleanChoice {
  /** Whether the customer answered they've had a recent professional deep clean. */
  deepCleanedBefore: DeepCleanedBefore;
  /** Whether to add the one-time first-clean deep clean to the membership. */
  includeDeepClean: boolean;
}

interface DeepCleanPromptProps {
  value: DeepCleanChoice;
  onChange: (next: DeepCleanChoice) => void;
  /** Surcharge amount in whole dollars (default 75). */
  priceDollars?: number;
  className?: string;
}

/**
 * Universal first-clean deep-clean prompt for recurring/membership signups.
 *
 * Asks whether the home has been professionally deep cleaned recently and
 * lets the customer add or decline the one-time deep clean. If they decline,
 * we clearly disclose that a surge charge may apply if the cleaner determines
 * a deep clean is needed on arrival. The chosen state is reported up so the
 * caller can forward `includeDeepClean` / `deepCleanedBefore` to
 * create-membership-intent (public Glow funnel) or create-checkout (VA).
 */
export function DeepCleanPrompt({ value, onChange, priceDollars = 75, className }: DeepCleanPromptProps) {
  const setAnswer = (answer: DeepCleanedBefore) => {
    // Recently deep cleaned → default to skipping the add-on. Otherwise we
    // recommend adding it. The customer can still override via the checkbox.
    onChange({ deepCleanedBefore: answer, includeDeepClean: answer === "yes" ? false : true });
  };

  return (
    <div className={cn("rounded-xl border border-border bg-muted/30 p-4 space-y-4", className)}>
      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <RiSparklingLine className="w-4 h-4 text-primary" />
        </div>
        <div>
          <p className="font-semibold text-sm">First-clean deep clean</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            New memberships start with a one-time deep clean to reset your home so recurring
            cleans stay effortless.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Has your home had a professional deep clean in the last 3 months?
        </p>
        <div className="grid grid-cols-2 gap-2">
          {([
            { id: "yes", label: "Yes, recently" },
            { id: "no", label: "No / Not sure" },
          ] as const).map((opt) => {
            const selected = value.deepCleanedBefore === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setAnswer(opt.id)}
                className={cn(
                  "rounded-xl border-2 py-2.5 text-sm font-semibold transition-all",
                  selected
                    ? "border-primary bg-primary/10 text-primary shadow-sm"
                    : "border-border hover:border-primary/30 text-foreground/80",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-border bg-background px-3 py-3">
        <input
          type="checkbox"
          checked={value.includeDeepClean}
          onChange={(e) => onChange({ ...value, includeDeepClean: e.target.checked })}
          className="h-5 w-5 mt-0.5 accent-[hsl(var(--primary))]"
        />
        <span className="text-sm">
          <span className="font-semibold">Add the one-time deep clean (+${priceDollars})</span>
          <span className="block text-xs text-muted-foreground mt-0.5">
            Recommended for the first visit. Added once to your first month.
          </span>
        </span>
      </label>

      {!value.includeDeepClean && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-950/20 p-3">
          <RiAlertLine className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            You&apos;ve chosen to skip the first-clean deep clean. If your cleaner determines your
            home needs a deep clean upon arrival, a <span className="font-semibold">surge charge
            may apply</span> based on its condition.
          </p>
        </div>
      )}
    </div>
  );
}

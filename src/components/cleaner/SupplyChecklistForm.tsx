"use client";

// The supply checkoff itself, with no opinion about how the contractor got
// here. Two surfaces render it: the tokenized page a mailed link opens, and
// step 2 of the onboarding portal. Whoever mounts it supplies the load and
// save, so neither surface has to re-implement the scoring or the copy.

import {
  RiCheckboxCircleFill,
  RiDownloadLine,
  RiLoader4Line,
} from "@remixicon/react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  SUPPLY_CATEGORY_LABEL,
  SUPPLY_CHECKLIST_PDF,
  SUPPLY_READY_PERCENT,
  type SupplyCategory,
  type SupplyInventory,
  type SupplyItem,
} from "@/lib/cleaner-supplies";

// Commercial equipment sits last: it never counts toward job readiness, and
// most contractors will tick none of it. Declaring a scrubber is what makes
// someone eligible for the sites whose walkthrough said one is needed.
const CATEGORY_ORDER: SupplyCategory[] = [
  "solutions",
  "tools",
  "safety",
  "optional",
  "commercial_equipment",
];

export interface SupplyChecklistFormProps {
  items: SupplyItem[];
  inventory: SupplyInventory;
  /** Non-null once the contractor has submitted at least once. */
  submittedAt: string | null;
  /** Resolve with the stored inventory; throw with a message to show an error. */
  onSave: (owned: SupplyInventory) => Promise<SupplyInventory | void>;
  firstName?: string;
  /**
   * "card" gives each category its own card, for the standalone page.
   * "plain" drops the chrome so this can sit inside an onboarding step card.
   */
  variant?: "card" | "plain";
  saveLabel?: string;
}

export function SupplyChecklistForm({
  items,
  inventory,
  submittedAt,
  onSave,
  firstName,
  variant = "card",
  saveLabel = "Save my supplies",
}: SupplyChecklistFormProps) {
  const [owned, setOwned] = useState<SupplyInventory>({ ...inventory });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(submittedAt);
  const [justSaved, setJustSaved] = useState(false);

  // Scored here as well as server-side so the meter tracks each tick rather
  // than waiting for a round trip.
  const score = useMemo(() => {
    const needed = items.filter((i) => i.neededForJob);
    const ownedNeeded = needed.filter((i) => owned[i.id]).length;
    const totalNeeded = needed.length;
    const threshold = Math.ceil((totalNeeded * SUPPLY_READY_PERCENT) / 100);
    return {
      ownedNeeded,
      totalNeeded,
      threshold,
      percent: totalNeeded === 0 ? 0 : Math.round((ownedNeeded / totalNeeded) * 100),
      ready: ownedNeeded >= threshold,
    };
  }, [items, owned]);

  const groups = CATEGORY_ORDER.map((cat) => ({
    cat,
    label: SUPPLY_CATEGORY_LABEL[cat],
    rows: items.filter((i) => i.category === cat),
  })).filter((g) => g.rows.length > 0);

  const toggle = (id: string, next: boolean) => {
    setOwned((prev) => ({ ...prev, [id]: next }));
    setSaveError(null);
    setJustSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const stored = await onSave(owned);
      if (stored) setOwned({ ...stored });
      setSavedAt(new Date().toISOString());
      setJustSaved(true);
    } catch (e) {
      setSaveError((e as Error).message || "Couldn't save your checklist.");
    } finally {
      setSaving(false);
    }
  };

  const block = variant === "card" ? "rounded-2xl border border-border bg-card p-5 shadow-sm" : "";
  const greeting = firstName ? `Hi ${firstName} — c` : "C";

  return (
    <div className={variant === "card" ? "space-y-4" : "space-y-4"}>
      <div className={block}>
        {variant === "card" ? (
          <p className="text-lg font-semibold text-foreground">What supplies do you have?</p>
        ) : null}
        <p className={cn("text-sm text-muted-foreground", variant === "card" && "mt-1")}>
          {greeting}heck off what you already own. You don&apos;t need every essential on day
          one — we look for about {SUPPLY_READY_PERCENT}% of the job-needed items (
          {score.threshold} of {score.totalNeeded}). Commercial equipment at the bottom is
          optional; ticking it puts you in line for larger sites that need it.
        </p>

        <div className="mt-4 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium text-foreground">
              Job-needed: {score.ownedNeeded}/{score.totalNeeded} ({score.percent}%)
            </span>
            {score.ready ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                <RiCheckboxCircleFill className="h-3.5 w-3.5" />
                Ready
              </span>
            ) : (
              <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                Need {Math.max(0, score.threshold - score.ownedNeeded)} more
              </span>
            )}
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                score.ready ? "bg-emerald-500" : "bg-primary",
              )}
              style={{ width: `${Math.min(100, score.percent)}%` }}
            />
          </div>
        </div>

        <a
          href={SUPPLY_CHECKLIST_PDF}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          <RiDownloadLine className="h-3.5 w-3.5" />
          Download full PDF checklist
        </a>
      </div>

      {groups.map((group) => (
        <div
          key={group.cat}
          className={cn(block, variant === "plain" && "border-t border-border/60 pt-4")}
        >
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {group.label}
            {group.cat === "optional" ? " (not required)" : null}
          </p>
          <ul className="space-y-2.5">
            {group.rows.map((item) => (
              <li key={item.id} className="flex items-start gap-3">
                <Checkbox
                  id={`supply-${item.id}`}
                  checked={owned[item.id] === true}
                  onCheckedChange={(v) => toggle(item.id, v === true)}
                  className="mt-0.5"
                />
                <label
                  htmlFor={`supply-${item.id}`}
                  className="cursor-pointer text-sm leading-snug text-foreground"
                >
                  {item.label}
                  {item.neededForJob ? (
                    <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                      needed
                    </span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className={cn(block, variant === "plain" && "border-t border-border/60 pt-4")}>
        {justSaved ? (
          <p className="mb-3 text-sm font-medium text-emerald-700 dark:text-emerald-400">
            Saved — thanks. You can update this anytime.
          </p>
        ) : null}
        {saveError ? <p className="mb-3 text-sm text-rose-600">{saveError}</p> : null}
        <Button className="w-full" disabled={saving} onClick={() => void save()}>
          {saving ? (
            <>
              <RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : savedAt ? (
            "Update my supplies"
          ) : (
            saveLabel
          )}
        </Button>
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          Tip: keep bathroom supplies in a separate tote from the rest of the house.
        </p>
      </div>
    </div>
  );
}

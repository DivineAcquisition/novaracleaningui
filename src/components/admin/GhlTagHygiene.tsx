"use client";

// ─── GHL tag hygiene ──────────────────────────────────────────────────────────
//
// Runs the tag cleanup and shows what it found. The chat agent used to invent
// tags from an LLM and push them straight to GHL, and half a dozen sync paths
// wrote their own shapes on top, so the account accumulated hundreds of
// one-offs that nobody could filter on.
//
// Dry run first, always. The point of the first click is to see the list of what
// would be removed — a tag sweep is the kind of thing you want to read before
// you run it, and "apply" is a second, deliberate decision.

import {
  RiCheckLine,
  RiDeleteBinLine,
  RiLoader4Line,
  RiPriceTag3Line,
  RiSearchEyeLine,
} from "@remixicon/react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { describeEdgeError } from "@/lib/edge-invoke";
import { cn } from "@/lib/utils";

interface CleanupResult {
  mode: string;
  scanned: number;
  contactsChanged: number;
  tagsRemoved: number;
  failures: number;
  maxTagsPerContact: number;
  topOffenders: { tag: string; contacts: number }[];
  locationTags: {
    checked: number;
    offVocabulary: number;
    names: string[];
    deleted: number;
  };
  sample: { who: string; before: string[]; after: string[]; removed: string[] }[];
  vocabulary: Record<string, string[]>;
}

export default function GhlTagHygiene() {
  const [busy, setBusy] = useState<"scan" | "apply" | null>(null);
  const [result, setResult] = useState<CleanupResult | null>(null);
  const [showVocab, setShowVocab] = useState(false);

  const run = async (apply: boolean) => {
    setBusy(apply ? "apply" : "scan");
    try {
      const { data, error } = await supabase.functions.invoke("ghl-tag-cleanup", {
        body: { apply, limit: 5000, sample: 25, deleteLocationTags: apply },
      });
      if (error) throw new Error(await describeEdgeError(error, data));
      const d = data as CleanupResult & { error?: string };
      if (d?.error) throw new Error(d.error);
      setResult(d);
      toast.success(
        apply
          ? `Cleaned ${d.contactsChanged} contact${d.contactsChanged === 1 ? "" : "s"} — ${d.tagsRemoved} tags removed`
          : `${d.contactsChanged} of ${d.scanned} contacts carry off-vocabulary tags`,
        {
          description: apply
            ? `${d.locationTags.deleted} tag definitions deleted from the GHL picker.`
            : "Nothing changed — this was a dry run.",
        },
      );
    } catch (e) {
      toast.error("Tag cleanup failed", {
        description: (e as Error).message,
        duration: 15_000,
      });
    } finally {
      setBusy(null);
    }
  };

  const dirty = result ? result.contactsChanged > 0 || result.locationTags.offVocabulary > 0 : false;

  return (
    <Card className="border-slate-200">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <RiPriceTag3Line className="h-4 w-4 text-violet-600" /> GHL tag hygiene
            </p>
            <p className="mt-0.5 max-w-xl text-xs text-slate-500">
              Tags are a closed vocabulary now — max{" "}
              <span className="font-medium">{result?.maxTagsPerContact ?? 5} per contact</span>, one per
              category, and the AI can no longer invent them. This removes what was created before that
              and deletes the leftover definitions from the GHL tag picker.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void run(false)} disabled={busy !== null}>
              {busy === "scan" ? (
                <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <RiSearchEyeLine className="mr-1.5 h-4 w-4" />
              )}
              Dry run
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-red-200 text-red-700 hover:bg-red-50"
              disabled={busy !== null || !result || result.mode === "applied"}
              onClick={() => {
                if (
                  !window.confirm(
                    `Remove ${result?.tagsRemoved ?? 0} tags from ${result?.contactsChanged ?? 0} contacts and ` +
                      `delete ${result?.locationTags.offVocabulary ?? 0} tag definitions from GHL?\n\n` +
                      `Tags in the vocabulary are kept. This can't be undone from here.`,
                  )
                ) {
                  return;
                }
                void run(true);
              }}
            >
              {busy === "apply" ? (
                <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <RiDeleteBinLine className="mr-1.5 h-4 w-4" />
              )}
              Clean them up
            </Button>
          </div>
        </div>

        {result ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">{result.mode}</Badge>
              <Badge variant="outline">{result.scanned} contacts scanned</Badge>
              <Badge
                variant="outline"
                className={cn(dirty ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-700")}
              >
                {result.contactsChanged} {result.mode === "applied" ? "cleaned" : "to clean"}
              </Badge>
              <Badge variant="outline">
                {result.tagsRemoved} tags {result.mode === "applied" ? "removed" : "to remove"}
              </Badge>
              <Badge variant="outline">
                {result.locationTags.offVocabulary} off-vocabulary definitions
                {result.locationTags.deleted ? ` · ${result.locationTags.deleted} deleted` : ""}
              </Badge>
              {result.failures > 0 ? (
                <Badge variant="destructive">{result.failures} failed</Badge>
              ) : null}
            </div>

            {!dirty ? (
              <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                <RiCheckLine className="h-4 w-4" /> Every contact is inside the vocabulary. Nothing to clean.
              </p>
            ) : null}

            {result.topOffenders.length > 0 ? (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  Most common off-vocabulary tags
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {result.topOffenders.slice(0, 30).map((o) => (
                    <span
                      key={o.tag}
                      className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700"
                    >
                      {o.tag} <span className="text-slate-400">×{o.contacts}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {result.sample.length > 0 ? (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  Examples
                </p>
                <div className="space-y-1.5">
                  {result.sample.slice(0, 8).map((s) => (
                    <div key={s.who} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px]">
                      <p className="font-medium text-slate-800">{s.who}</p>
                      <p className="mt-0.5 text-slate-500">
                        <span className="line-through decoration-rose-400">{s.removed.join(", ")}</span>
                      </p>
                      <p className="text-emerald-700">keeps: {s.after.join(", ") || "nothing"}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <button
              onClick={() => setShowVocab((v) => !v)}
              className="text-[11px] font-medium text-slate-600 underline decoration-dotted"
            >
              {showVocab ? "Hide" : "Show"} the allowed vocabulary
            </button>
            {showVocab ? (
              <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
                {Object.entries(result.vocabulary).map(([slot, tags]) => (
                  <div key={slot} className="text-[11px]">
                    <span className="font-semibold text-slate-700">{slot}</span>
                    <span className="text-slate-500"> — {tags.join(" · ")}</span>
                  </div>
                ))}
                <p className="pt-1 text-[11px] text-slate-500">
                  Priority runs top to bottom. A contact keeps at most one tag per category and{" "}
                  {result.maxTagsPerContact} in total, so an automation trigger can never be pushed out by
                  a UTM campaign.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

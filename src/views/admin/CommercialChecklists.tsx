"use client";

// ─── Commercial hub → Checklists ───────────────────────────────────────────
//
// The internal layout of the same Light / Standard / Detailed / Office lists
// published at /checklist/commercial-* and /checklist/office. Staff preview
// here, customers open the public page, the crew works the matching list.

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  RiCheckboxCircleFill,
  RiExternalLinkLine,
  RiFileCopyLine,
  RiInformationLine,
} from "@remixicon/react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CommercialScopeComparison } from "@/components/checklists/CommercialScopePreview";
import {
  CHECKLISTS,
  COMMERCIAL_CHECKLIST_SLUGS,
  TRY_CHECKLIST_ORIGIN,
  type ChecklistSlug,
} from "@/lib/checklists";
import { cn } from "@/lib/utils";

export default function CommercialChecklists() {
  const [active, setActive] = useState<ChecklistSlug>("commercial-standard");
  const checklist = CHECKLISTS[active];
  const publicHref = `${TRY_CHECKLIST_ORIGIN}/checklist/${checklist.slug}`;

  const itemCount = useMemo(
    () => checklist.sections.reduce((n, s) => n + s.items.length, 0),
    [checklist],
  );

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicHref);
      toast.success("Public checklist link copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-violet-200 bg-violet-50/60 px-4 py-3 text-sm text-slate-700 flex items-start gap-2">
        <RiInformationLine className="w-4 h-4 mt-0.5 text-violet-700 shrink-0" />
        <p>
          Same lists the customer sees on{" "}
          <Link href="/checklist" className="font-medium text-violet-800 underline underline-offset-2" target="_blank">
            /checklist
          </Link>{" "}
          and the crew works on the job. Light ⊂ Standard ⊂ Detailed. Office is
          Standard plus after-hours desk and lock-up rules. Large sites add
          photo zones at dispatch — those are not on the published template.
        </p>
      </div>

      <CommercialScopeComparison />

      <div className="flex flex-wrap gap-1.5">
        {COMMERCIAL_CHECKLIST_SLUGS.map((slug) => {
          const c = CHECKLISTS[slug];
          const on = slug === active;
          return (
            <button
              key={slug}
              type="button"
              onClick={() => setActive(slug)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                on
                  ? "bg-violet-50 text-violet-800 ring-1 ring-violet-200"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
              )}
            >
              {c.name}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold text-slate-900">{checklist.name}</h2>
            <Badge variant="outline">{itemCount} items</Badge>
          </div>
          <p className="text-sm text-slate-500 mt-1">{checklist.tagline}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void copyLink()}>
            <RiFileCopyLine className="w-3.5 h-3.5 mr-1.5" />
            Copy public link
          </Button>
          <Button size="sm" asChild>
            <Link href={`/checklist/${checklist.slug}`} target="_blank" rel="noopener noreferrer">
              Open public page
              <RiExternalLinkLine className="w-3.5 h-3.5 ml-1.5" />
            </Link>
          </Button>
        </div>
      </div>

      <p className="text-sm text-slate-600 max-w-3xl">{checklist.description}</p>

      <div className="grid sm:grid-cols-3 gap-3">
        <Meta label="Estimated time" value={checklist.meta.estimatedTime} />
        <Meta label="Best for" value={checklist.meta.bestFor} />
        <Meta label="Frequency" value={checklist.meta.frequency} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {checklist.sections.map((section) => (
          <Card key={section.title} className="border-slate-200">
            <CardContent className="p-4">
              <p className="font-semibold text-slate-900 mb-2">{section.title}</p>
              <ul className="space-y-1.5">
                {section.items.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-slate-800">
                    <RiCheckboxCircleFill className="w-4 h-4 mt-0.5 shrink-0 text-violet-600" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      {checklist.notIncluded.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-4">
            <p className="font-semibold text-amber-900 mb-2">{checklist.notIncludedHeading}</p>
            <ul className="space-y-1.5">
              {checklist.notIncluded.map((item) => (
                <li key={item} className="text-sm text-slate-800">— {item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {checklist.addOns.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {checklist.addOns.map((item) => (
            <span
              key={item}
              className="inline-flex items-center rounded-full bg-violet-50 text-violet-800 px-3 py-1 text-xs font-medium"
            >
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
      <p className="text-sm font-medium text-slate-900 mt-0.5">{value}</p>
    </div>
  );
}

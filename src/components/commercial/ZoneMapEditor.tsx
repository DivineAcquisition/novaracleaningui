"use client";

// Shared editor for a site's standing zone map — walkthrough capture and
// admin corrections (rename / split / merge / add) without a re-walkthrough.

import { useState } from "react";
import { RiAddLine, RiDeleteBinLine, RiGitMergeLine, RiScissorsCutLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  addZone,
  mergeZones,
  parseSiteZones,
  splitZone,
  type SiteZone,
} from "@/lib/site-zones";
import { cn } from "@/lib/utils";

export function ZoneMapEditor({
  zones,
  onChange,
  disabled,
  compact,
}: {
  zones: SiteZone[];
  onChange: (next: SiteZone[]) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const list = parseSiteZones(zones);
  const [draftName, setDraftName] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [splitFor, setSplitFor] = useState<string | null>(null);
  const [splitLeft, setSplitLeft] = useState("");
  const [splitRight, setSplitRight] = useState("");
  const [mergeKeep, setMergeKeep] = useState<string | null>(null);

  const patch = (id: string, name: string, description: string) => {
    onChange(list.map((z) => (z.id === id ? { ...z, name, description } : z)));
  };

  return (
    <div className="space-y-2">
      {list.length === 0 && (
        <p className={cn("text-slate-500", compact ? "text-[11px]" : "text-xs")}>
          Name the physical sections of this site — Loading Dock, Office Area, Restroom Block A.
          These become the standing map for every future visit.
        </p>
      )}
      {list.map((z, i) => (
        <div key={z.id} className="rounded-lg border border-slate-200 bg-white p-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate-400 w-5">{i + 1}</span>
            <Input
              value={z.name}
              disabled={disabled}
              onChange={(e) => patch(z.id, e.target.value, z.description)}
              placeholder="Zone name"
              className="h-8 text-xs font-medium"
            />
            {!disabled && (
              <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-slate-500"
                onClick={() => onChange(list.filter((x) => x.id !== z.id))}
                aria-label="Remove zone">
                <RiDeleteBinLine className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
          <Textarea
            value={z.description}
            disabled={disabled}
            onChange={(e) => patch(z.id, z.name, e.target.value)}
            placeholder="What's in it — access, equipment, anything the crew needs"
            rows={2}
            className="text-xs"
          />
          {!disabled && (
            <div className="flex flex-wrap gap-1">
              <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]"
                onClick={() => {
                  setSplitFor(z.id);
                  setSplitLeft(z.name);
                  setSplitRight("");
                }}>
                <RiScissorsCutLine className="w-3 h-3 mr-1" /> Split
              </Button>
              {mergeKeep && mergeKeep !== z.id ? (
                <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]"
                  onClick={() => {
                    onChange(mergeZones(list, mergeKeep, z.id));
                    setMergeKeep(null);
                  }}>
                  <RiGitMergeLine className="w-3 h-3 mr-1" /> Merge into selected
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm"
                  className={cn("h-7 text-[11px]", mergeKeep === z.id && "border-violet-400 text-violet-800")}
                  onClick={() => setMergeKeep(mergeKeep === z.id ? null : z.id)}>
                  <RiGitMergeLine className="w-3 h-3 mr-1" />
                  {mergeKeep === z.id ? "Merging…" : "Merge"}
                </Button>
              )}
            </div>
          )}
          {splitFor === z.id && !disabled && (
            <div className="rounded-md bg-slate-50 border border-slate-200 p-2 space-y-1.5">
              <p className="text-[11px] text-slate-600">This zone becomes two. Name both sides.</p>
              <Input className="h-8 text-xs" value={splitLeft} onChange={(e) => setSplitLeft(e.target.value)} placeholder="Keep as…" />
              <Input className="h-8 text-xs" value={splitRight} onChange={(e) => setSplitRight(e.target.value)} placeholder="New zone name" />
              <div className="flex gap-1">
                <Button type="button" size="sm" className="h-7 text-[11px]" disabled={!splitRight.trim()}
                  onClick={() => {
                    onChange(splitZone(list, z.id, splitLeft, splitRight, z.description));
                    setSplitFor(null);
                  }}>
                  Split
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => setSplitFor(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}

      {!disabled && (
        <div className="flex flex-col sm:flex-row gap-1.5">
          <Input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Add a zone — e.g. Main warehouse floor"
            className="h-8 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (!draftName.trim()) return;
                onChange(addZone(list, draftName, draftDesc));
                setDraftName("");
                setDraftDesc("");
              }
            }}
          />
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs shrink-0"
            disabled={!draftName.trim()}
            onClick={() => {
              onChange(addZone(list, draftName, draftDesc));
              setDraftName("");
              setDraftDesc("");
            }}>
            <RiAddLine className="w-3.5 h-3.5 mr-1" /> Add zone
          </Button>
        </div>
      )}
    </div>
  );
}

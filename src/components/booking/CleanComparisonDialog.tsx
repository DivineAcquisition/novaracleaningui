"use client";

import { Fragment } from "react";
import {
  RiCheckLine,
  RiCloseLine,
  RiSparklingLine,
  RiTimeLine,
  RiTeamLine,
} from "@remixicon/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface CleanComparisonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Side-by-side comparison rows. Each row says whether the task is
// included in Standard, Deep, or both. Grouped by room/area so it's
// scannable at a glance.
type Row = { label: string; standard: boolean; deep: boolean };
type Group = { title: string; rows: Row[] };

const COMPARISON: Group[] = [
  {
    title: "Kitchen",
    rows: [
      { label: "Counters, sink, stovetop wiped",          standard: true,  deep: true  },
      { label: "Appliance exteriors (fridge, oven, etc.)", standard: true,  deep: true  },
      { label: "Cabinet exteriors wiped",                  standard: true,  deep: true  },
      { label: "Floors vacuumed & mopped",                 standard: true,  deep: true  },
      { label: "Inside cabinets & drawers cleaned",        standard: false, deep: true  },
      { label: "Hand-scrub backsplash + grease build-up",  standard: false, deep: true  },
      { label: "Detailed range hood / vent degrease",      standard: false, deep: true  },
    ],
  },
  {
    title: "Bathrooms",
    rows: [
      { label: "Sink, faucet, counter sanitized",          standard: true,  deep: true  },
      { label: "Toilet inside + out",                       standard: true,  deep: true  },
      { label: "Mirror polished",                           standard: true,  deep: true  },
      { label: "Tub & shower wiped",                        standard: true,  deep: true  },
      { label: "Floors mopped",                             standard: true,  deep: true  },
      { label: "Grout scrubbed (soap scum + mildew)",      standard: false, deep: true  },
      { label: "Behind toilet + under sink detailed",       standard: false, deep: true  },
      { label: "Showerhead descaled",                       standard: false, deep: true  },
    ],
  },
  {
    title: "Living areas & bedrooms",
    rows: [
      { label: "Dusting all reachable surfaces",            standard: true,  deep: true  },
      { label: "Vacuum carpets, rugs, upholstery surfaces", standard: true,  deep: true  },
      { label: "Mop hard floors",                           standard: true,  deep: true  },
      { label: "Make beds on request",                      standard: true,  deep: true  },
      { label: "Baseboards + door frames hand-wiped",       standard: false, deep: true  },
      { label: "Interior windows + sills",                  standard: false, deep: true  },
      { label: "Light fixtures + ceiling fan blades",       standard: false, deep: true  },
      { label: "Behind / under reachable furniture",        standard: false, deep: true  },
    ],
  },
  {
    title: "Whole-home extras",
    rows: [
      { label: "Trash removal",                             standard: true,  deep: true  },
      { label: "General tidy + put-away",                   standard: true,  deep: true  },
      { label: "Eco-friendly products & HEPA vacuums",      standard: true,  deep: true  },
      { label: "Detailed switch plates + door handles",     standard: false, deep: true  },
      { label: "Vent cover dusting + AC return wipe",       standard: false, deep: true  },
      { label: "48-hour re-clean guarantee",                standard: true,  deep: true  },
    ],
  },
];

function Tick({ included }: { included: boolean }) {
  return included ? (
    <RiCheckLine className="h-4 w-4 text-primary" aria-label="Included" />
  ) : (
    <RiCloseLine className="h-4 w-4 text-muted-foreground/50" aria-label="Not included" />
  );
}

export function CleanComparisonDialog({ open, onOpenChange }: CleanComparisonDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-jakarta text-2xl">
            Standard vs. Deep Clean
          </DialogTitle>
          <DialogDescription>
            Both services use the same trusted, insured 2-person team and the
            same eco-friendly products. Deep adds a thorough top-to-bottom
            reset on the things Standard only surface-cleans.
          </DialogDescription>
        </DialogHeader>

        {/* Top summary row — duration + team + intent */}
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div className="rounded-lg border-2 border-primary/20 p-4 space-y-2 bg-background">
            <div className="flex items-center justify-between">
              <h3 className="font-bold font-jakarta text-base">Standard Clean</h3>
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-[10px]">
                Maintenance
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Recurring upkeep — surfaces, floors, kitchen + bathroom resets.
            </p>
            <Separator className="my-2" />
            <div className="flex items-center gap-1.5 text-xs">
              <RiTimeLine className="h-3.5 w-3.5 text-primary" />
              <span>~2–3 hours (smaller homes)</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <RiTeamLine className="h-3.5 w-3.5 text-primary" />
              <span>1–2 cleaners</span>
            </div>
          </div>
          <div className="rounded-lg border-2 border-primary/40 p-4 space-y-2 bg-primary/[0.04]">
            <div className="flex items-center justify-between">
              <h3 className="font-bold font-jakarta text-base">Deep Clean</h3>
              <Badge className="bg-gradient-primary text-white text-[10px]">
                <RiSparklingLine className="h-3 w-3 mr-1" />
                Most Popular
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Top-to-bottom reset — best for first cleans, move-ins, or after
              a long break.
            </p>
            <Separator className="my-2" />
            <div className="flex items-center gap-1.5 text-xs">
              <RiTimeLine className="h-3.5 w-3.5 text-primary" />
              <span>~3–5 hours (smaller homes)</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <RiTeamLine className="h-3.5 w-3.5 text-primary" />
              <span>2–3 cleaners</span>
            </div>
          </div>
        </div>

        {/* Comparison table — sticky header, grouped rows */}
        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/50 backdrop-blur-sm">
              <tr>
                <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">
                  What's included
                </th>
                <th className="text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 w-24">
                  Standard
                </th>
                <th className="text-center text-[11px] font-semibold uppercase tracking-wider text-primary px-3 py-2 w-24">
                  Deep
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((group, gi) => (
                <Fragment key={`g-${gi}`}>
                  {/* Group header */}
                  <tr className="bg-muted/30 border-y border-border">
                    <td colSpan={3} className="px-3 py-2 text-xs font-bold font-jakarta">
                      {group.title}
                    </td>
                  </tr>
                  {group.rows.map((row, ri) => (
                    <tr
                      key={`g-${gi}-r-${ri}`}
                      className={cn(
                        "border-b border-border/60",
                        !row.standard && row.deep && "bg-primary/[0.02]",
                      )}
                    >
                      <td className="px-3 py-2 text-xs md:text-sm">{row.label}</td>
                      <td className="px-3 py-2 text-center"><div className="inline-flex"><Tick included={row.standard} /></div></td>
                      <td className="px-3 py-2 text-center"><div className="inline-flex"><Tick included={row.deep} /></div></td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {/* Bottom hint */}
        <div className="mt-3 rounded-lg bg-primary/5 border border-primary/15 px-3 py-2 text-xs text-foreground">
          <strong>Not sure?</strong> Most first-time customers pick the{" "}
          <span className="font-semibold">Deep Clean</span> for the initial
          reset, then switch to <span className="font-semibold">Standard</span>{" "}
          for ongoing visits — or save up to 42% with the Glow Membership.
        </div>
      </DialogContent>
    </Dialog>
  );
}

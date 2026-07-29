"use client";

// ─── Operations ───────────────────────────────────────────────────────────────
//
// One place for running today. These four screens were separate sidebar
// entries, which meant the person working a late job had to leave the at-risk
// board to find a cleaner in Dispatch, then leave Dispatch to check coverage on
// the Map — and Sync Health, the thing that explains why a booking is missing in
// the first place, was three clicks from anything it could explain.
//
//   Needs attention — at-risk bookings, delays, no-shows, coverage, the bench
//   Dispatch        — staffing jobs, offers, re-dispatch
//   Map             — cleaner coverage against the booking heatmap
//   Sync health     — Airtable flows, review queue, recent errors
//
// Deep links survive: /admin/attention, /admin/dispatch, /admin/map and
// /admin/sync all redirect here with the right tab pre-selected, and
// Dispatch's ?job= parameter still lands on the right card, because those URLs
// are in sent emails and Discord alerts that we don't get to edit.

import { RiAlarmWarningLine, RiMapPin2Line, RiRefreshLine, RiRocket2Line } from "@remixicon/react";
import { useState } from "react";
import { useSearchParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AdminDispatch from "@/views/admin/Dispatch";
import AdminMap from "@/views/admin/Map";
import NeedsAttention from "@/views/admin/NeedsAttention";
import SyncHealth from "@/views/admin/SyncHealth";

const TABS = [
  { id: "attention", label: "Needs attention", icon: RiAlarmWarningLine },
  { id: "dispatch", label: "Dispatch", icon: RiRocket2Line },
  { id: "map", label: "Map", icon: RiMapPin2Line },
  { id: "sync", label: "Sync health", icon: RiRefreshLine },
] as const;

type TabId = (typeof TABS)[number]["id"];

const VALID = new Set<string>(TABS.map((t) => t.id));
/** Old names that shipped in emails and Discord alerts. */
const ALIASES: Record<string, TabId> = {
  risk: "attention",
  "needs-attention": "attention",
  "sync-health": "sync",
  airtable: "sync",
  coverage: "attention",
};

export default function Operations() {
  const searchParams = useSearchParams();
  const raw = (searchParams?.get("tab") || "").toLowerCase();
  // A ?job= link comes from a dispatch alert, so honour the intent even when
  // whoever built the link didn't include ?tab=dispatch.
  const inferred = searchParams?.get("job") ? "dispatch" : "attention";
  const requested = ALIASES[raw] || raw;
  const [tab, setTab] = useState<TabId>(
    (VALID.has(requested) ? requested : inferred) as TabId,
  );

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
        <TabsList className="flex h-auto flex-wrap">
          {TABS.map(({ id, label, icon: Icon }) => (
            <TabsTrigger key={id} value={id} className="gap-1.5">
              <Icon className="h-4 w-4" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Mounted lazily: the map loads Google Maps and Sync Health polls every
            30s, so neither should run while somebody is reading the risk board. */}
        <TabsContent value="attention" className="mt-4">
          {tab === "attention" && <NeedsAttention />}
        </TabsContent>
        <TabsContent value="dispatch" className="mt-4">
          {tab === "dispatch" && <AdminDispatch />}
        </TabsContent>
        <TabsContent value="map" className="mt-4">
          {tab === "map" && <AdminMap />}
        </TabsContent>
        <TabsContent value="sync" className="mt-4">
          {tab === "sync" && <SyncHealth />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

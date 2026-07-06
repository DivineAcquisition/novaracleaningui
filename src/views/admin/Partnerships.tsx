"use client";

// ─── /admin/partner — Partnerships (unified) ──────────────────────────────────
//
// One tab for the whole STR partner program, combining the two halves that used
// to be separate nav items:
//   • Host Accounts  — the management console (Airtable Client & Revenue Ops):
//     lifecycle, pricing/Active gate, revenue, needs-attention, admin actions.
//   • Turnover Ops   — the operational console (Supabase turnover portal):
//     per-property pricing, crew, recurring schedules, assignments, requests.
//
// A "Sync to Airtable" action reconciles the operational Supabase data into the
// Airtable base so both halves read as one dataset (identity backfill; Airtable
// keeps ownership of rates/lifecycle).

import { useState } from "react";
import { toast } from "sonner";
import { RiRefreshLine, RiHotelLine, RiToolsLine, RiLoader4Line } from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PartnerAccounts from "@/views/admin/PartnerAccounts";
import PartnerAdmin from "@/views/admin/PartnerAdmin";
import { syncPartners, syncContractors } from "@/lib/partner-admin-api";

export default function Partnerships() {
  const [tab, setTab] = useState("accounts");
  const [syncing, setSyncing] = useState(false);
  const [syncingContractors, setSyncingContractors] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await syncPartners();
      toast.success(
        `Synced ${res.hostsSynced} host${res.hostsSynced === 1 ? "" : "s"} · ${res.propertiesSynced} propert${res.propertiesSynced === 1 ? "y" : "ies"} to Airtable.`,
      );
      if (res.warnings && res.warnings.length > 0) {
        toast.warning(`${res.warnings.length} item(s) had issues — check logs.`);
      }
    } catch (err) {
      toast.error((err as Error).message || "Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncContractors = async () => {
    setSyncingContractors(true);
    try {
      const res = await syncContractors();
      toast.success(
        `${res.created ? "Created Contractors table · " : ""}Synced ${res.contractorsSynced} contractor${res.contractorsSynced === 1 ? "" : "s"} (${res.withPay} with pay, ${res.withAgreement} with agreement).`,
      );
      if (res.warnings && res.warnings.length > 0) {
        toast.warning(`Some steps were skipped — check logs.`);
      }
    } catch (err) {
      toast.error((err as Error).message || "Contractor sync failed.");
    } finally {
      setSyncingContractors(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-1 sm:px-4 py-2 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Partnerships</h1>
          <p className="text-sm text-muted-foreground mt-1">
            STR host accounts, pricing, revenue, turnovers, crew, and recurring schedules — in one place.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleSyncContractors} disabled={syncingContractors}>
            {syncingContractors ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiToolsLine className="w-4 h-4 mr-1.5" />}
            Sync contractors
          </Button>
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
            {syncing ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiRefreshLine className="w-4 h-4 mr-1.5" />}
            Sync to Airtable
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList>
          <TabsTrigger value="accounts" className="gap-1.5">
            <RiHotelLine className="w-4 h-4" /> Host Accounts
          </TabsTrigger>
          <TabsTrigger value="turnovers" className="gap-1.5">
            <RiToolsLine className="w-4 h-4" /> Turnover Ops
          </TabsTrigger>
        </TabsList>

        {/* Mount lazily per tab so each console only fetches when viewed. */}
        <TabsContent value="accounts" className="mt-4">
          {tab === "accounts" && <PartnerAccounts />}
        </TabsContent>
        <TabsContent value="turnovers" className="mt-4">
          {tab === "turnovers" && <PartnerAdmin />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

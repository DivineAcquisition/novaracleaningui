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
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { RiRefreshLine, RiHotelLine, RiToolsLine, RiLoader4Line, RiDashboardLine, RiBuilding2Line, RiCalendarCheckLine } from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PartnerAccounts from "@/views/admin/PartnerAccounts";
import PartnerAdmin from "@/views/admin/PartnerAdmin";
import PartnershipsOverview from "@/views/admin/PartnershipsOverview";
import CommercialAccountsAdmin from "@/views/admin/CommercialAccountsAdmin";
import PartnershipBooking from "@/views/admin/PartnershipBooking";
import PartnerRecurringSchedules from "@/views/admin/PartnerRecurringSchedules";
import { syncPartners, syncContractors } from "@/lib/partner-admin-api";

const VALID_TABS = ["overview", "commercial", "book", "recurring", "accounts", "turnovers"];

export default function Partnerships() {
  const searchParams = useSearchParams();
  const initialTab = searchParams?.get("tab") || "overview";
  const [tab, setTab] = useState(VALID_TABS.includes(initialTab) ? initialTab : "overview");
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
          <h1 className="text-2xl font-bold tracking-tight">Partnerships Hub</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Commercial, Office &amp; STR in one place — pipeline, accounts, pricing, revenue, turnovers, crew.
            Intake: commercial.novaracleaning.com · Partner app: partner.novaracleaning.com
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
          <TabsTrigger value="overview" className="gap-1.5">
            <RiDashboardLine className="w-4 h-4" /> Overview
          </TabsTrigger>
          <TabsTrigger value="commercial" className="gap-1.5">
            <RiBuilding2Line className="w-4 h-4" /> Commercial &amp; Office
          </TabsTrigger>
          <TabsTrigger value="book" className="gap-1.5">
            <RiCalendarCheckLine className="w-4 h-4" /> Book Job
          </TabsTrigger>
          <TabsTrigger value="recurring" className="gap-1.5">
            <RiRefreshLine className="w-4 h-4" /> Recurring
          </TabsTrigger>
          <TabsTrigger value="accounts" className="gap-1.5">
            <RiHotelLine className="w-4 h-4" /> STR Hosts
          </TabsTrigger>
          <TabsTrigger value="turnovers" className="gap-1.5">
            <RiToolsLine className="w-4 h-4" /> Turnover Ops
          </TabsTrigger>
        </TabsList>

        {/* Mount lazily per tab so each console only fetches when viewed. */}
        <TabsContent value="overview" className="mt-4">
          {tab === "overview" && <PartnershipsOverview />}
        </TabsContent>
        <TabsContent value="commercial" className="mt-4">
          {tab === "commercial" && <CommercialAccountsAdmin />}
        </TabsContent>
        <TabsContent value="book" className="mt-4">
          {tab === "book" && <PartnershipBooking />}
        </TabsContent>
        <TabsContent value="recurring" className="mt-4">
          {tab === "recurring" && <PartnerRecurringSchedules />}
        </TabsContent>
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

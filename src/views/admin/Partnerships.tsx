"use client";

// ─── /admin/partner — Partnerships Hub ────────────────────────────────────────
//
// The single console for every line of business — Commercial, Office, STR:
//   • Overview   — pipeline, revenue per line, needs-attention
//   • Accounts   — THE account-base view: every commercial/office account and
//     every STR host in one list; click any row for the type-appropriate
//     detail (sites/gates/rates vs properties/turnovers/pricing). The legacy
//     Airtable host console is available inside as an advanced section.
//   • Book Job   — the unified internal booking flow (all three types)
//   • Walkthroughs — the gate for large commercial facilities: no firm price,
//     and no booking, until someone has actually walked the building
//   • Recurring  — partner cadences (the residential-style recurring setup)
//   • Ops Queue  — turnover dispatch operations (crew, assignments, batches)

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { RiRefreshLine, RiHotelLine, RiToolsLine, RiLoader4Line, RiDashboardLine, RiCalendarCheckLine, RiArrowDownSLine, RiRulerLine } from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PartnerAccounts from "@/views/admin/PartnerAccounts";
import PartnerAdmin from "@/views/admin/PartnerAdmin";
import PartnershipsOverview from "@/views/admin/PartnershipsOverview";
import PartnershipAccounts from "@/views/admin/PartnershipAccounts";
import PartnershipBooking from "@/views/admin/PartnershipBooking";
import PartnerRecurringSchedules from "@/views/admin/PartnerRecurringSchedules";
import CommercialWalkthroughs from "@/views/admin/CommercialWalkthroughs";
import { syncPartners, syncContractors } from "@/lib/partner-admin-api";

const VALID_TABS = ["overview", "accounts", "book", "walkthroughs", "recurring", "ops"];
// Old deep links keep working: commercial → accounts, turnovers → ops.
const TAB_ALIASES: Record<string, string> = { commercial: "accounts", turnovers: "ops" };

export default function Partnerships() {
  const searchParams = useSearchParams();
  const rawTab = searchParams?.get("tab") || "overview";
  const initialTab = TAB_ALIASES[rawTab] || rawTab;
  const [tab, setTab] = useState(VALID_TABS.includes(initialTab) ? initialTab : "overview");
  const [syncing, setSyncing] = useState(false);
  const [syncingContractors, setSyncingContractors] = useState(false);
  const [showAirtableConsole, setShowAirtableConsole] = useState(false);

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
          <TabsTrigger value="accounts" className="gap-1.5">
            <RiHotelLine className="w-4 h-4" /> Accounts
          </TabsTrigger>
          <TabsTrigger value="book" className="gap-1.5">
            <RiCalendarCheckLine className="w-4 h-4" /> Book Job
          </TabsTrigger>
          <TabsTrigger value="walkthroughs" className="gap-1.5">
            <RiRulerLine className="w-4 h-4" /> Walkthroughs
          </TabsTrigger>
          <TabsTrigger value="recurring" className="gap-1.5">
            <RiRefreshLine className="w-4 h-4" /> Recurring
          </TabsTrigger>
          <TabsTrigger value="ops" className="gap-1.5">
            <RiToolsLine className="w-4 h-4" /> Ops Queue
          </TabsTrigger>
        </TabsList>

        {/* Mount lazily per tab so each console only fetches when viewed. */}
        <TabsContent value="overview" className="mt-4">
          {tab === "overview" && <PartnershipsOverview />}
        </TabsContent>
        <TabsContent value="accounts" className="mt-4 space-y-4">
          {tab === "accounts" && (
            <>
              <PartnershipAccounts />
              {/* Legacy Airtable host console — advanced lifecycle actions
                  (approve-live gate, offboard-retain) until fully absorbed. */}
              <button
                className="flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-slate-600"
                onClick={() => setShowAirtableConsole((v) => !v)}
              >
                <RiArrowDownSLine className={`w-4 h-4 transition-transform ${showAirtableConsole ? "rotate-180" : ""}`} />
                Advanced: Airtable host lifecycle console
              </button>
              {showAirtableConsole && <PartnerAccounts />}
            </>
          )}
        </TabsContent>
        <TabsContent value="book" className="mt-4">
          {tab === "book" && <PartnershipBooking />}
        </TabsContent>
        <TabsContent value="walkthroughs" className="mt-4">
          {tab === "walkthroughs" && <CommercialWalkthroughs />}
        </TabsContent>
        <TabsContent value="recurring" className="mt-4">
          {tab === "recurring" && <PartnerRecurringSchedules />}
        </TabsContent>
        <TabsContent value="ops" className="mt-4">
          {tab === "ops" && <PartnerAdmin />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

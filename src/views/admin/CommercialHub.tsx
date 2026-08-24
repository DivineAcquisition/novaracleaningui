"use client";

// ─── /admin/commercial — Commercial hub ────────────────────────────────────
//
// The console for commercial and office work, remapped from the old
// Partnerships tab so the deal actually reads in the order it happens:
//
//   Overview → Accounts → Walkthroughs → Send Proposal → Pipeline →
//   Book Job → Recurring → Compliance → STR
//
// Send Proposal is the Internal Booking analogue: a numbered workspace that
// emails a tokenized /proposal/[token] link. Pipeline is the follow-up board
// (resend, changes, agreement, billing). STR / turnovers stay here so ops
// does not hunt a second tab, but they are no longer the identity of the hub.
//
// /admin/partner bookmarks land here with tab aliases intact.

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  RiArrowDownSLine,
  RiBuilding2Line,
  RiCalendarCheckLine,
  RiDashboardLine,
  RiFileTextLine,
  RiHotelLine,
  RiLoader4Line,
  RiMailSendLine,
  RiRefreshLine,
  RiRulerLine,
  RiShieldCheckLine,
  RiToolsLine,
} from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PartnerAccounts from "@/views/admin/PartnerAccounts";
import PartnerAdmin from "@/views/admin/PartnerAdmin";
import PartnershipsOverview from "@/views/admin/PartnershipsOverview";
import PartnershipAccounts from "@/views/admin/PartnershipAccounts";
import PartnershipBooking from "@/views/admin/PartnershipBooking";
import PartnerRecurringSchedules from "@/views/admin/PartnerRecurringSchedules";
import CommercialWalkthroughs from "@/views/admin/CommercialWalkthroughs";
import CommercialProposals from "@/views/admin/CommercialProposals";
import CommercialProposalSend from "@/views/admin/CommercialProposalSend";
import CoiCompliance from "@/views/admin/CoiCompliance";
import { syncPartners, syncContractors } from "@/lib/partner-admin-api";

const VALID_TABS = [
  "overview",
  "accounts",
  "walkthroughs",
  "send",
  "pipeline",
  "book",
  "recurring",
  "compliance",
  "str",
] as const;

type Tab = (typeof VALID_TABS)[number];

// Old Partnerships Hub deep links keep working.
const TAB_ALIASES: Record<string, Tab> = {
  commercial: "accounts",
  turnovers: "str",
  ops: "str",
  proposals: "pipeline",
  partner: "overview",
};

function isTab(v: string): v is Tab {
  return (VALID_TABS as readonly string[]).includes(v);
}

export default function CommercialHub() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawTab = searchParams?.get("tab") || "overview";
  const initialTab = TAB_ALIASES[rawTab] || rawTab;
  const tab: Tab = isTab(initialTab) ? initialTab : "overview";
  const accountFromUrl = searchParams?.get("account") || "";

  const [syncing, setSyncing] = useState(false);
  const [syncingContractors, setSyncingContractors] = useState(false);
  const [showAirtableConsole, setShowAirtableConsole] = useState(false);

  const setTab = useCallback(
    (next: string) => {
      const mapped = TAB_ALIASES[next] || next;
      const params = new URLSearchParams(searchParams?.toString() || "");
      params.set("tab", mapped);
      if (mapped !== "send") params.delete("account");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

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
        toast.warning("Some steps were skipped — check logs.");
      }
    } catch (err) {
      toast.error((err as Error).message || "Contractor sync failed.");
    } finally {
      setSyncingContractors(false);
    }
  };

  const strSyncVisible = tab === "str" || tab === "accounts";

  const tabs = useMemo(
    () =>
      [
        { id: "overview", label: "Overview", icon: RiDashboardLine },
        { id: "accounts", label: "Accounts", icon: RiHotelLine },
        { id: "walkthroughs", label: "Walkthroughs", icon: RiRulerLine },
        { id: "send", label: "Send Proposal", icon: RiMailSendLine },
        { id: "pipeline", label: "Pipeline", icon: RiFileTextLine },
        { id: "book", label: "Book Job", icon: RiCalendarCheckLine },
        { id: "recurring", label: "Recurring", icon: RiRefreshLine },
        { id: "compliance", label: "Compliance", icon: RiShieldCheckLine },
        { id: "str", label: "STR", icon: RiBuilding2Line },
      ] as const,
    [],
  );

  return (
    <div className="max-w-[1240px] mx-auto px-1 sm:px-4 py-2 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-violet-700/80 bg-violet-50 border border-violet-200/70 rounded-full px-2 py-0.5">
              Commercial
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Commercial</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Walkthrough → proposal → agreement → billing → dispatch. Office accounts use the same
            path. STR turnovers live under the STR tab.
          </p>
        </div>
        {strSyncVisible && (
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
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="h-auto w-full flex flex-wrap justify-start gap-1">
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="gap-1.5">
              <t.icon className="w-4 h-4" /> {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          {tab === "overview" && <PartnershipsOverview />}
        </TabsContent>
        <TabsContent value="accounts" className="mt-4 space-y-4">
          {tab === "accounts" && (
            <>
              <PartnershipAccounts />
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
        <TabsContent value="walkthroughs" className="mt-4">
          {tab === "walkthroughs" && <CommercialWalkthroughs />}
        </TabsContent>
        <TabsContent value="send" className="mt-4">
          {tab === "send" && <CommercialProposalSend initialAccountId={accountFromUrl} />}
        </TabsContent>
        <TabsContent value="pipeline" className="mt-4">
          {tab === "pipeline" && <CommercialProposals />}
        </TabsContent>
        <TabsContent value="book" className="mt-4">
          {tab === "book" && <PartnershipBooking />}
        </TabsContent>
        <TabsContent value="recurring" className="mt-4">
          {tab === "recurring" && <PartnerRecurringSchedules />}
        </TabsContent>
        <TabsContent value="compliance" className="mt-4">
          {tab === "compliance" && <CoiCompliance />}
        </TabsContent>
        <TabsContent value="str" className="mt-4">
          {tab === "str" && <PartnerAdmin />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

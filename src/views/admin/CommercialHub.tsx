"use client";

// ─── /admin/commercial — Commercial hub ────────────────────────────────────
//
// Book commercial jobs the same way Bookings is used for residential work.
// Quote / walkthrough / send / pipeline live on Proposals so this tab is not
// a second copy of that path.

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  RiArrowDownSLine,
  RiBuilding2Line,
  RiCalendarCheckLine,
  RiFileTextLine,
  RiHomeSmile2Line,
  RiHotelLine,
  RiLoader4Line,
  RiRefreshLine,
  RiShieldCheckLine,
  RiToolsLine,
} from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useOpsAssistantRecord } from "@/components/ops-assistant/OpsAssistantProvider";
import PartnerAccounts from "@/views/admin/PartnerAccounts";
import PartnerAdmin from "@/views/admin/PartnerAdmin";
import PropertyManagerAdmin from "@/views/admin/PropertyManagerAdmin";
import PartnershipAccounts from "@/views/admin/PartnershipAccounts";
import PartnershipBooking from "@/views/admin/PartnershipBooking";
import PartnerRecurringSchedules from "@/views/admin/PartnerRecurringSchedules";
import CommercialChecklists from "@/views/admin/CommercialChecklists";
import CoiCompliance from "@/views/admin/CoiCompliance";
import { syncPartners, syncContractors } from "@/lib/partner-admin-api";

const VALID_TABS = [
  "book",
  "recurring",
  "accounts",
  "checklists",
  "compliance",
  "str",
  "portfolio",
] as const;

type Tab = (typeof VALID_TABS)[number];

const TAB_ALIASES: Record<string, Tab> = {
  overview: "book",
  comms: "accounts",
  partner: "book",
  commercial: "accounts",
  turnovers: "str",
  ops: "str",
  pm: "portfolio",
  "property-manager": "portfolio",
  "property_manager": "portfolio",
};

function isTab(v: string): v is Tab {
  return (VALID_TABS as readonly string[]).includes(v);
}

const SCREENS: Array<{ id: Tab; label: string; icon: typeof RiCalendarCheckLine }> = [
  { id: "book", label: "Book", icon: RiCalendarCheckLine },
  { id: "recurring", label: "Recurring", icon: RiRefreshLine },
  { id: "accounts", label: "Accounts", icon: RiHotelLine },
  { id: "checklists", label: "Checklists", icon: RiFileTextLine },
  { id: "compliance", label: "Compliance", icon: RiShieldCheckLine },
  { id: "str", label: "STR", icon: RiBuilding2Line },
  { id: "portfolio", label: "Portfolio", icon: RiHomeSmile2Line },
];

export default function CommercialHub() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawTab = searchParams?.get("tab") || "book";
  const aliased = TAB_ALIASES[rawTab] || rawTab;
  const tab: Tab = isTab(String(aliased)) ? (aliased as Tab) : "book";
  const accountFromUrl = searchParams?.get("account") || "";
  useOpsAssistantRecord(
    accountFromUrl ? { kind: "account", id: accountFromUrl } : null,
  );

  const [syncing, setSyncing] = useState(false);
  const [syncingContractors, setSyncingContractors] = useState(false);
  const [showAirtableConsole, setShowAirtableConsole] = useState(false);

  const setTab = useCallback(
    (next: Tab) => {
      const params = new URLSearchParams(searchParams?.toString() || "");
      params.set("tab", next);
      params.delete("account");
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
  const subtitle = useMemo(() => SCREENS.find((s) => s.id === tab)?.label || "Book", [tab]);

  return (
    <div className="max-w-[1240px] mx-auto px-1 sm:px-4 py-2 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-violet-700/80 bg-violet-50 border border-violet-200/70 rounded-full px-2 py-0.5">
              Commercial
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              {subtitle}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Book commercial and office jobs, then keep the account, certificate, and recurring cadence here.
            Quotes and sending live on{" "}
            <a href="/admin/proposals" className="font-semibold text-violet-800 underline-offset-2 hover:underline">
              Proposals
            </a>
            .
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

      <nav aria-label="Commercial" className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {SCREENS.map((item) => {
          const active = item.id === tab;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => setTab(item.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-violet-600 text-white" : "text-slate-600 hover:bg-slate-50",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="pt-1">
        {tab === "book" && <PartnershipBooking />}
        {tab === "recurring" && <PartnerRecurringSchedules />}
        {tab === "accounts" && (
          <div className="space-y-4">
            <PartnershipAccounts />
            <button
              className="flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-slate-600"
              onClick={() => setShowAirtableConsole((v) => !v)}
            >
              <RiArrowDownSLine className={`w-4 h-4 transition-transform ${showAirtableConsole ? "rotate-180" : ""}`} />
              Advanced: Airtable host lifecycle console
            </button>
            {showAirtableConsole && <PartnerAccounts />}
          </div>
        )}
        {tab === "checklists" && <CommercialChecklists />}
        {tab === "compliance" && <CoiCompliance />}
        {tab === "str" && <PartnerAdmin />}
        {tab === "portfolio" && <PropertyManagerAdmin />}
      </div>
    </div>
  );
}

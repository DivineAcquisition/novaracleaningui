"use client";

// ─── /admin/commercial — Commercial hub ────────────────────────────────────
//
// The console for commercial and office work. Nine destinations used to sit
// in one wrapping tab strip; that is too many things competing for the same
// row. They are grouped into five workspaces:
//
//   Home        — Overview, Accounts, Comms
//   Deals       — Walkthroughs (findings → firm price). Send and pipeline
//                 live on the dedicated Proposals tab so VA and admin share
//                 one quote path.
//   Jobs        — Book job, Recurring, Checklists
//   Compliance  — COI (client certs + Novara's own)
//   STR         — turnovers / hosts
//
// Deep links still use ?tab=overview|accounts|comms|walkthroughs|send|pipeline|
// book|recurring|checklists|compliance|str. Old Partnerships Hub aliases keep working.
// ?tab=send and ?tab=pipeline redirect to /admin/proposals.

import { useCallback, useEffect, useMemo, useState } from "react";
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
  RiMailLine,
  RiMailSendLine,
  RiRefreshLine,
  RiRulerLine,
  RiShieldCheckLine,
  RiToolsLine,
} from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useOpsAssistantRecord } from "@/components/ops-assistant/OpsAssistantProvider";
import { proposalsHubTab } from "@/lib/commercial-proposal";
import PartnerAccounts from "@/views/admin/PartnerAccounts";
import PartnerAdmin from "@/views/admin/PartnerAdmin";
import PartnershipsOverview from "@/views/admin/PartnershipsOverview";
import PartnershipAccounts from "@/views/admin/PartnershipAccounts";
import PartnershipBooking from "@/views/admin/PartnershipBooking";
import PartnerRecurringSchedules from "@/views/admin/PartnerRecurringSchedules";
import CommercialWalkthroughs from "@/views/admin/CommercialWalkthroughs";
import CommercialChecklists from "@/views/admin/CommercialChecklists";
import CoiCompliance from "@/views/admin/CoiCompliance";
import PartnershipComms from "@/views/admin/PartnershipComms";
import { syncPartners, syncContractors } from "@/lib/partner-admin-api";

const VALID_TABS = [
  "overview",
  "accounts",
  "comms",
  "walkthroughs",
  "send",
  "pipeline",
  "book",
  "recurring",
  "checklists",
  "compliance",
  "str",
] as const;

type Tab = (typeof VALID_TABS)[number];
type WorkspaceId = "home" | "deals" | "jobs" | "compliance" | "str";

// Old Partnerships Hub deep links keep working.
const TAB_ALIASES: Record<string, Tab> = {
  commercial: "accounts",
  turnovers: "str",
  ops: "str",
  proposals: "pipeline",
  partner: "overview",
  communications: "comms",
};

function isTab(v: string): v is Tab {
  return (VALID_TABS as readonly string[]).includes(v);
}

const SCREENS: Record<
  Tab,
  { label: string; icon: typeof RiDashboardLine }
> = {
  overview: { label: "Overview", icon: RiDashboardLine },
  accounts: { label: "Accounts", icon: RiHotelLine },
  comms: { label: "Comms", icon: RiMailLine },
  walkthroughs: { label: "Walkthroughs", icon: RiRulerLine },
  send: { label: "Send proposal", icon: RiMailSendLine },
  pipeline: { label: "Pipeline", icon: RiFileTextLine },
  book: { label: "Book job", icon: RiCalendarCheckLine },
  recurring: { label: "Recurring", icon: RiRefreshLine },
  checklists: { label: "Checklists", icon: RiFileTextLine },
  compliance: { label: "Compliance", icon: RiShieldCheckLine },
  str: { label: "STR", icon: RiBuilding2Line },
};

const WORKSPACES: Array<{
  id: WorkspaceId;
  label: string;
  description: string;
  tabs: Tab[];
  fallback: Tab;
}> = [
  {
    id: "home",
    label: "Home",
    description: "Pipeline snapshot, the account list, and partnership communications.",
    tabs: ["overview", "accounts", "comms"],
    fallback: "overview",
  },
  {
    id: "deals",
    label: "Deals",
    description: "Walkthrough findings and firm price. Sending lives on Proposals.",
    tabs: ["walkthroughs", "send", "pipeline"],
    fallback: "pipeline",
  },
  {
    id: "jobs",
    label: "Jobs",
    description: "One-off commercial jobs, recurring schedules, and published checklists.",
    tabs: ["book", "recurring", "checklists"],
    fallback: "book",
  },
  {
    id: "compliance",
    label: "Compliance",
    description: "Client COI and Novara's own certificate.",
    tabs: ["compliance"],
    fallback: "compliance",
  },
  {
    id: "str",
    label: "STR",
    description: "Turnovers, hosts, and STR pricing.",
    tabs: ["str"],
    fallback: "str",
  },
];

const TAB_WORKSPACE: Record<Tab, WorkspaceId> = {
  overview: "home",
  accounts: "home",
  comms: "home",
  walkthroughs: "deals",
  send: "deals",
  pipeline: "deals",
  book: "jobs",
  recurring: "jobs",
  checklists: "jobs",
  compliance: "compliance",
  str: "str",
};

export default function CommercialHub() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawTab = searchParams?.get("tab") || "overview";
  const initialTab = TAB_ALIASES[rawTab] || rawTab;
  const tab: Tab = isTab(initialTab) ? initialTab : "overview";
  const accountFromUrl = searchParams?.get("account") || "";
  useOpsAssistantRecord(
    accountFromUrl ? { kind: "account", id: accountFromUrl } : null,
  );
  const workspace = TAB_WORKSPACE[tab];
  const workspaceDef = WORKSPACES.find((w) => w.id === workspace)!;

  const [syncing, setSyncing] = useState(false);
  const [syncingContractors, setSyncingContractors] = useState(false);
  const [showAirtableConsole, setShowAirtableConsole] = useState(false);

  const setTab = useCallback(
    (next: string) => {
      const mapped = TAB_ALIASES[next] || next;
      if (mapped === "send") {
        const account = searchParams?.get("account") || "";
        router.replace(proposalsHubTab("send", account ? { account } : undefined), { scroll: false });
        return;
      }
      if (mapped === "pipeline") {
        router.replace(proposalsHubTab("pipeline"), { scroll: false });
        return;
      }
      const params = new URLSearchParams(searchParams?.toString() || "");
      params.set("tab", mapped);
      params.delete("account");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    if (tab === "send") {
      router.replace(proposalsHubTab("send", accountFromUrl ? { account: accountFromUrl } : undefined));
    } else if (tab === "pipeline") {
      router.replace(proposalsHubTab("pipeline"));
    }
  }, [tab, accountFromUrl, router]);

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
  const subNav = useMemo(
    () => workspaceDef.tabs.map((id) => ({ id, ...SCREENS[id] })),
    [workspaceDef],
  );

  return (
    <div className="max-w-[1240px] mx-auto px-1 sm:px-4 py-2 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-violet-700/80 bg-violet-50 border border-violet-200/70 rounded-full px-2 py-0.5">
              Commercial
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              {workspaceDef.label}
              {workspaceDef.tabs.length > 1 ? ` · ${SCREENS[tab].label}` : ""}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{workspaceDef.description}</p>
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

      <div className="space-y-2">
        <nav
          aria-label="Commercial workspaces"
          className="grid grid-cols-5 gap-1 rounded-xl bg-slate-100 p-1"
        >
          {WORKSPACES.map((ws) => {
            const active = ws.id === workspace;
            return (
              <button
                key={ws.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  if (active) return;
                  setTab(ws.fallback);
                }}
                className={cn(
                  "rounded-lg px-2 py-2 text-center text-[13px] sm:text-sm font-medium transition-all",
                  active
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-800",
                )}
              >
                {ws.label}
              </button>
            );
          })}
        </nav>

        {subNav.length > 1 && (
          <nav
            aria-label={`${workspaceDef.label} screens`}
            className="flex flex-wrap gap-1"
          >
            {subNav.map((item) => {
              const active = item.id === tab;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-violet-50 text-violet-800 ring-1 ring-violet-200"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        )}
      </div>

      <div className="pt-1">
        {tab === "overview" && <PartnershipsOverview />}
        {tab === "comms" && <PartnershipComms />}
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
        {tab === "walkthroughs" && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500 rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-2">
              New STR / commercial / office quote requests, tokenized onsite docs, and sending live in{" "}
              <a href="/admin/proposals" className="font-semibold text-violet-800 underline-offset-2 hover:underline">
                Proposals
              </a>
              . This board is findings → firm price. VA and admin open the same walkthrough document the agent uses.
            </p>
            <CommercialWalkthroughs />
          </div>
        )}
        {tab === "send" && (
          <p className="text-sm text-slate-500 py-8 text-center">Opening Proposals → Send…</p>
        )}
        {tab === "pipeline" && (
          <p className="text-sm text-slate-500 py-8 text-center">Opening Proposals → Pipeline…</p>
        )}
        {tab === "book" && <PartnershipBooking />}
        {tab === "recurring" && <PartnerRecurringSchedules />}
        {tab === "checklists" && <CommercialChecklists />}
        {tab === "compliance" && <CoiCompliance />}
        {tab === "str" && <PartnerAdmin />}
      </div>
    </div>
  );
}

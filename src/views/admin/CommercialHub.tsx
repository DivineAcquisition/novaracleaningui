"use client";

// ─── /admin/accounts — management hub ──────────────────────────────────────
//
// Three tabs. Account-scoped tools that used to be sibling tabs (STR list,
// portfolio, certificates, checklists, comms, book-a-site) now live on
// Accounts or Jobs so the bar matches how people actually work: pick the
// relationship, then open the tool.

import { useRouter, useSearchParams } from "next/navigation";
import {
  RiArrowLeftLine,
  RiBuilding2Line,
  RiCalendarCheckLine,
  RiFileList3Line,
  RiHotelLine,
  RiMailLine,
  RiRepeatLine,
  RiShieldCheckLine,
} from "@remixicon/react";
import { cn } from "@/lib/utils";
import {
  accountsHubHref,
  resolveAccountsHubLocation,
  type AccountsHubPanel,
  type AccountsHubTab,
} from "@/lib/accounts-hub";
import AdminBookings from "@/views/admin/Bookings";
import PartnerAdmin from "@/views/admin/PartnerAdmin";
import PropertyManagerAdmin from "@/views/admin/PropertyManagerAdmin";
import PartnershipAccounts from "@/views/admin/PartnershipAccounts";
import PartnershipBooking from "@/views/admin/PartnershipBooking";
import PartnerRecurringSchedules from "@/views/admin/PartnerRecurringSchedules";
import CoiCompliance from "@/views/admin/CoiCompliance";
import CommercialChecklists from "@/views/admin/CommercialChecklists";
import PartnershipComms from "@/views/admin/PartnershipComms";

const TABS: Array<{ id: AccountsHubTab; label: string; icon: typeof RiBuilding2Line }> = [
  { id: "accounts", label: "Accounts", icon: RiBuilding2Line },
  { id: "jobs", label: "Jobs", icon: RiCalendarCheckLine },
  { id: "recurring", label: "Recurring", icon: RiRepeatLine },
];

const ACCOUNT_TOOLS: Array<{ id: AccountsHubPanel; label: string; icon: typeof RiShieldCheckLine }> = [
  { id: "compliance", label: "Certificates", icon: RiShieldCheckLine },
  { id: "turnovers", label: "STR ops", icon: RiHotelLine },
  { id: "checklists", label: "Checklists", icon: RiFileList3Line },
  { id: "comms", label: "Comms", icon: RiMailLine },
];

export default function CommercialHub() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const extras = {
    panel: searchParams?.get("panel") || undefined,
    kind: searchParams?.get("kind") || undefined,
    type: searchParams?.get("type") || undefined,
    create: searchParams?.get("create") || undefined,
  };
  const loc = resolveAccountsHubLocation(searchParams?.get("tab"), extras);

  const pushLoc = (next: Partial<typeof loc>, extra?: Record<string, string>) => {
    router.replace(accountsHubHref({ ...loc, ...next }, extra), { scroll: false });
  };

  return (
    <div className="max-w-[1240px] mx-auto px-1 sm:px-4 py-2 space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-violet-700/80 bg-violet-50 border border-violet-200/70 rounded-full px-2 py-0.5">
            Accounts
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            Management
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          One list for commercial, office, STR, and portfolio accounts. Book and manage jobs here; sending an offer still lives on Proposals.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = loc.tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => pushLoc({ tab: t.id, panel: "list", create: false, kind: t.id === "accounts" ? loc.kind : null })}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium",
                on ? "bg-violet-600 text-white" : "text-slate-600 hover:bg-slate-50",
              )}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {loc.tab === "accounts" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 px-1">On this account</span>
            {ACCOUNT_TOOLS.map((tool) => {
              const Icon = tool.icon;
              const on = loc.panel === tool.id;
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => pushLoc({ panel: on ? "list" : tool.id })}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold",
                    on
                      ? "border-violet-300 bg-violet-50 text-violet-800"
                      : "border-slate-200 bg-white text-slate-600 hover:border-violet-200 hover:text-violet-700",
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tool.label}
                </button>
              );
            })}
          </div>

          {(loc.panel !== "list" || loc.kind === "portfolio") && (
            <button
              type="button"
              onClick={() => pushLoc({ panel: "list", kind: null })}
              className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:underline"
            >
              <RiArrowLeftLine className="w-3.5 h-3.5" />
              Back to accounts
            </button>
          )}

          {loc.panel === "compliance" ? (
            <CoiCompliance />
          ) : loc.panel === "turnovers" ? (
            <PartnerAdmin />
          ) : loc.panel === "checklists" ? (
            <CommercialChecklists />
          ) : loc.panel === "comms" ? (
            <PartnershipComms />
          ) : loc.kind === "portfolio" ? (
            <PropertyManagerAdmin initialAccountId={searchParams?.get("account") || undefined} />
          ) : (
            <PartnershipAccounts
              kindFilter={loc.kind}
              onKindFilterChange={(kind) => pushLoc({ kind })}
            />
          )}
        </div>
      ) : loc.tab === "jobs" ? (
        <AdminBookings
          scope="commercial"
          title="Jobs"
          initialCreating={loc.create}
          newJob={{
            label: "Book a site",
            render: () => <PartnershipBooking />,
          }}
        />
      ) : (
        <PartnerRecurringSchedules />
      )}
    </div>
  );
}

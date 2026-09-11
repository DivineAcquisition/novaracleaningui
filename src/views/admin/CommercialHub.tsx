"use client";

// ─── /admin/accounts — management hub (was Commercial) ─────────────────────
//
// Offers, payment, and agreement mail live on Proposals. This hub is the
// ongoing account: clients, jobs, book-a-site, recurring, COI, STR hosts,
// property-manager portfolios, published checklists, and comms.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  RiBuilding2Line,
  RiCalendarCheckLine,
  RiFileList3Line,
  RiHotelLine,
  RiMailLine,
  RiRepeatLine,
  RiShieldCheckLine,
  RiUserStarLine,
} from "@remixicon/react";
import { cn } from "@/lib/utils";
import AdminBookings from "@/views/admin/Bookings";
import CommercialBooking from "@/views/admin/CommercialBooking";
import PartnerAdmin from "@/views/admin/PartnerAdmin";
import PropertyManagerAdmin from "@/views/admin/PropertyManagerAdmin";
import PartnershipAccounts from "@/views/admin/PartnershipAccounts";
import PartnershipBooking from "@/views/admin/PartnershipBooking";
import PartnerRecurringSchedules from "@/views/admin/PartnerRecurringSchedules";
import CoiCompliance from "@/views/admin/CoiCompliance";
import CommercialChecklists from "@/views/admin/CommercialChecklists";
import PartnershipComms from "@/views/admin/PartnershipComms";

const TABS = [
  { id: "accounts", label: "Accounts", icon: RiBuilding2Line },
  { id: "jobs", label: "Jobs", icon: RiCalendarCheckLine },
  { id: "book", label: "Book", icon: RiCalendarCheckLine },
  { id: "recurring", label: "Recurring", icon: RiRepeatLine },
  { id: "compliance", label: "Compliance", icon: RiShieldCheckLine },
  { id: "str", label: "STR", icon: RiHotelLine },
  { id: "portfolio", label: "Portfolio", icon: RiUserStarLine },
  { id: "checklists", label: "Checklists", icon: RiFileList3Line },
  { id: "comms", label: "Comms", icon: RiMailLine },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function CommercialHub() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams?.get("tab") || "accounts";
  const tab: Tab = TABS.some((t) => t.id === raw) ? (raw as Tab) : "accounts";

  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams?.toString() || "");
    params.set("tab", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
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
          Business accounts, commercial jobs, STR hosts, property-manager portfolios, certificates, and recurring schedules. Sending an offer lives on Proposals.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
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

      {tab === "accounts" ? (
        <PartnershipAccounts />
      ) : tab === "jobs" ? (
        <AdminBookings
          scope="commercial"
          title="Jobs"
          newJob={{
            label: "New commercial job",
            render: () => <CommercialBooking />,
          }}
        />
      ) : tab === "book" ? (
        <PartnershipBooking />
      ) : tab === "recurring" ? (
        <PartnerRecurringSchedules />
      ) : tab === "compliance" ? (
        <CoiCompliance />
      ) : tab === "str" ? (
        <PartnerAdmin />
      ) : tab === "portfolio" ? (
        <PropertyManagerAdmin />
      ) : tab === "checklists" ? (
        <CommercialChecklists />
      ) : (
        <PartnershipComms />
      )}
    </div>
  );
}

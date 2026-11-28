"use client";

// ─── /admin/accounts — management hub (was Commercial) ─────────────────────
//
// Offers, payment, and agreement mail live on Proposals. This hub is the
// ongoing account: clients, jobs, book-a-site, recurring, COI, STR hosts,
// property-manager portfolios, published checklists, and comms.

import { AdminPageTitle } from "@/components/admin/AdminPageTitle";
import { SectionTabs } from "@/components/ui/section-tabs";
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
} from "@/components/icons";
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
        <AdminPageTitle id="accounts" />
        <p className="mt-1 text-sm text-muted-foreground">
          Business accounts, commercial jobs, STR hosts, property-manager portfolios, certificates, and recurring schedules. Sending an offer lives on Proposals.
        </p>
      </div>

      <SectionTabs
        label="Business account sections"
        value={tab}
        onChange={setTab}
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon }))}
      />

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

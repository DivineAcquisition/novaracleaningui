"use client";

// ─── /admin/commercial — commercial job control center ─────────────────────
//
// Same screen as Bookings: list jobs, open one, cancel / reschedule / refund.
// Scoped to commercial and office work. Quotes live on Proposals.

import { useSearchParams } from "next/navigation";
import AdminBookings from "@/views/admin/Bookings";
import CommercialBooking from "@/views/admin/CommercialBooking";
import PartnerAdmin from "@/views/admin/PartnerAdmin";
import PropertyManagerAdmin from "@/views/admin/PropertyManagerAdmin";
import PartnershipAccounts from "@/views/admin/PartnershipAccounts";
import PartnerRecurringSchedules from "@/views/admin/PartnerRecurringSchedules";
import CoiCompliance from "@/views/admin/CoiCompliance";
import CommercialChecklists from "@/views/admin/CommercialChecklists";

export default function CommercialHub() {
  const searchParams = useSearchParams();
  const tab = searchParams?.get("tab") || "";

  // Old deep links still resolve. They are not a second tab strip.
  if (tab === "compliance") return <CoiCompliance />;
  if (tab === "str") return <PartnerAdmin />;
  if (tab === "portfolio") return <PropertyManagerAdmin />;
  if (tab === "recurring") return <PartnerRecurringSchedules />;
  if (tab === "accounts") return <PartnershipAccounts />;
  if (tab === "checklists") return <CommercialChecklists />;

  return (
    <div className="max-w-[1240px] mx-auto px-1 sm:px-4 py-2">
      <AdminBookings
        scope="commercial"
        title="Commercial"
        newJob={{
          label: "New commercial job",
          render: () => <CommercialBooking />,
        }}
      />
    </div>
  );
}

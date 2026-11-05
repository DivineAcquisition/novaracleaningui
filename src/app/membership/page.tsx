import { Suspense } from "react";
import type { Metadata } from "next";

import { CustomerPortalGate } from "@/components/portal/CustomerPortalGate";
import MembershipPage from "@/views/Membership";

export const metadata: Metadata = {
  title: "Membership plans · Novara Cleaning",
  description: "Monthly, every-two-weeks, or weekly house cleaning with a dedicated cleaner on bi-weekly and weekly plans. Prices by home size.",
};

export default function Page() {
  return (
    <CustomerPortalGate>
      <Suspense>
        <MembershipPage />
      </Suspense>
    </CustomerPortalGate>
  );
}

export const dynamic = "force-dynamic";

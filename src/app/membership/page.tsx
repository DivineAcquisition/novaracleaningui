import { Suspense } from "react";

import { CustomerPortalGate } from "@/components/portal/CustomerPortalGate";
import MembershipPage from "@/views/Membership";

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

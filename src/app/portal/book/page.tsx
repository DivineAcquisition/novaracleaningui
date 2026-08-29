import { Suspense } from "react";

import { PortalLayout } from "@/components/portal/PortalLayout";
import MemberBookingPage from "@/views/portal/MemberBooking";

export default function Page() {
  return (
    <PortalLayout>
      <Suspense>
        <MemberBookingPage />
      </Suspense>
    </PortalLayout>
  );
}

export const dynamic = "force-dynamic";

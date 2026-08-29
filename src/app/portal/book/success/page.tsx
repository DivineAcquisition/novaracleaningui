import { Suspense } from "react";

import { PortalLayout } from "@/components/portal/PortalLayout";
import MemberBookingSuccess from "@/views/portal/MemberBookingSuccess";

export default function Page() {
  return (
    <PortalLayout>
      <Suspense fallback={null}>
        <MemberBookingSuccess />
      </Suspense>
    </PortalLayout>
  );
}

export const dynamic = "force-dynamic";

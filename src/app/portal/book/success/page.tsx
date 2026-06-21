import { Suspense } from "react";

import MemberBookingSuccess from "@/views/portal/MemberBookingSuccess";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MemberBookingSuccess />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

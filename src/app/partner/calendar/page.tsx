import { Suspense } from "react";
import PartnerCalendar from "@/views/partner/PartnerCalendar";

export default function Page() {
  return (
    <Suspense>
      <PartnerCalendar />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

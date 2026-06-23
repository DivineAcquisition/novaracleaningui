import { Suspense } from "react";
import PartnerWeeklySchedule from "@/views/partner/PartnerWeeklySchedule";

export default function Page() {
  return (
    <Suspense>
      <PartnerWeeklySchedule />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

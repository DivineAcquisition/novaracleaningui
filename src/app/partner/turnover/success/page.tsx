import { Suspense } from "react";
import PartnerTurnoverSuccess from "@/views/partner/PartnerTurnoverSuccess";

export default function Page() {
  return (
    <Suspense>
      <PartnerTurnoverSuccess />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

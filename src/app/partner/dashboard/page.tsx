import { Suspense } from "react";
import PartnerPortal from "@/views/partner/PartnerPortal";

export default function Page() {
  return (
    <Suspense>
      <PartnerPortal />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

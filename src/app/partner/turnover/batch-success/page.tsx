import { Suspense } from "react";
import PartnerBatchSuccess from "@/views/partner/PartnerBatchSuccess";

export default function Page() {
  return (
    <Suspense>
      <PartnerBatchSuccess />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

import { Suspense } from "react";

import { ContractorLayout } from "@/components/contractor/ContractorLayout";
import MobileDashboardPage from "@/views/cleaner/MobileDashboard";

export default function Page() {
  return (
    <ContractorLayout>
      <Suspense>
        <MobileDashboardPage />
      </Suspense>
    </ContractorLayout>
  );
}

export const dynamic = "force-dynamic";

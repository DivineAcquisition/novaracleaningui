import { Suspense } from "react";

import { ContractorLayout } from "@/components/contractor/ContractorLayout";
import CleanerDashboardPage from "@/views/cleaner/Dashboard";

export default function Page() {
  return (
    <ContractorLayout>
      <Suspense>
        <CleanerDashboardPage />
      </Suspense>
    </ContractorLayout>
  );
}

export const dynamic = "force-dynamic";

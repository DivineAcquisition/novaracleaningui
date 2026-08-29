import { Suspense } from "react";

import { ContractorLayout } from "@/components/contractor/ContractorLayout";
import CleanerTurnoverJobsPage from "@/views/cleaner/TurnoverJobs";

export default function Page() {
  return (
    <ContractorLayout>
      <Suspense>
        <CleanerTurnoverJobsPage />
      </Suspense>
    </ContractorLayout>
  );
}

export const dynamic = "force-dynamic";

import { Suspense } from "react";

import { ContractorLayout } from "@/components/contractor/ContractorLayout";
import TrainingWatchPage from "@/views/cleaner/TrainingWatch";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ContractorLayout>
      <Suspense>
        <TrainingWatchPage />
      </Suspense>
    </ContractorLayout>
  );
}

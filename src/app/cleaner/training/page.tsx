import { Suspense } from "react";

import { ContractorLayout } from "@/components/contractor/ContractorLayout";
import CleanerTrainingPage from "@/views/cleaner/Training";

export default function Page() {
  return (
    <ContractorLayout>
      <Suspense>
        <CleanerTrainingPage />
      </Suspense>
    </ContractorLayout>
  );
}

export const dynamic = "force-dynamic";

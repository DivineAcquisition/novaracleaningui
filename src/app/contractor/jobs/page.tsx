import { Suspense } from "react";
import ContractorJobsPage from "@/views/contractor/Jobs";

export default function Page() {
  return (
    <Suspense>
      <ContractorJobsPage />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

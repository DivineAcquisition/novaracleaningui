import { Suspense } from "react";
import { TourProvider } from "@/components/tour/TourProvider";
import ContractorJobsPage from "@/views/contractor/Jobs";

// This page is outside the portal chrome, so it needs its own provider: the
// pay-and-score walkthrough starts on the dashboard and continues here, and
// the engine parks its place in sessionStorage precisely so it survives the
// layout change on the way over.
export default function Page() {
  return (
    <TourProvider>
      <Suspense>
        <ContractorJobsPage />
      </Suspense>
    </TourProvider>
  );
}

export const dynamic = "force-dynamic";

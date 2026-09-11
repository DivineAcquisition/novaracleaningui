import { Suspense } from "react";
import { TourLauncher } from "@/components/tour/TourLauncher";
import { TourProvider } from "@/components/tour/TourProvider";
import CleanerJobChecklistPage from "@/views/cleaner/JobChecklist";

// The walkthrough engine is mounted here, outside the portal chrome, because
// the checklist and photo walkthroughs are about this screen. Run from here
// they spotlight the real elements; run from the dashboard they can only
// describe them, since this page needs a per-job link from dispatch.
export default function Page() {
  return (
    <TourProvider>
      <Suspense>
        <CleanerJobChecklistPage />
      </Suspense>
      <TourLauncher variant="floating" />
    </TourProvider>
  );
}

export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { TourLauncher } from "@/components/tour/TourLauncher";
import { TourProvider } from "@/components/tour/TourProvider";
import CleanerJobPhotosPage from "@/views/cleaner/JobPhotos";

export default function Page() {
  return (
    <TourProvider>
      <Suspense>
        <CleanerJobPhotosPage />
      </Suspense>
      <TourLauncher variant="floating" />
    </TourProvider>
  );
}

export const dynamic = "force-dynamic";

import { Suspense } from "react";
import CleanerJobPhotosPage from "@/views/cleaner/JobPhotos";

export default function Page() {
  return (
    <Suspense>
      <CleanerJobPhotosPage />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

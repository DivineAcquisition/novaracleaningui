import { Suspense } from "react";
import CleanerTurnoverPhotosPage from "@/views/cleaner/TurnoverPhotos";

export default function Page() {
  return (
    <Suspense>
      <CleanerTurnoverPhotosPage />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

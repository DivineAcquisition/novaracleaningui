import { Suspense } from "react";
import CleanerTurnoverJobsPage from "@/views/cleaner/TurnoverJobs";

export default function Page() {
  return (
    <Suspense>
      <CleanerTurnoverJobsPage />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

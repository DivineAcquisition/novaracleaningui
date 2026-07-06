import { Suspense } from "react";
import CleanerJobChecklistPage from "@/views/cleaner/JobChecklist";

export default function Page() {
  return (
    <Suspense>
      <CleanerJobChecklistPage />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

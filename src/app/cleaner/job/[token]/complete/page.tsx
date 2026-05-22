import { Suspense } from "react";
import CleanerJobCompletionPage from "@/views/cleaner/JobCompletion";

export default function Page() {
  return (
    <Suspense>
      <CleanerJobCompletionPage />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

import { Suspense } from "react";

import CleanerTrainingPage from "@/views/cleaner/Training";

export default function Page() {
  return (
    <Suspense>
      <CleanerTrainingPage />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

import { Suspense } from "react";
import CleanerJobOfferPage from "@/views/cleaner/JobOffer";

export default function Page() {
  return (
    <Suspense>
      <CleanerJobOfferPage />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

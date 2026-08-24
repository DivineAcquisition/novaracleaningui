import { Suspense } from "react";
import CommercialAgreementSign from "@/views/commercial/CommercialAgreementSign";

export default function Page() {
  return (
    <Suspense>
      <CommercialAgreementSign />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

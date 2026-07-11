import { Suspense } from "react";
import CommercialIntake from "@/views/commercial/CommercialIntake";

export default function Page() {
  return (
    <Suspense>
      <CommercialIntake />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

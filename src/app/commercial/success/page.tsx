import { Suspense } from "react";
import CommercialSuccess from "@/views/commercial/CommercialSuccess";

export default function Page() {
  return (
    <Suspense>
      <CommercialSuccess />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

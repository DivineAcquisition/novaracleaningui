import { Suspense } from "react";
import UrgentHireOffer from "@/views/cleaner/UrgentHireOffer";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense>
      <UrgentHireOffer />
    </Suspense>
  );
}

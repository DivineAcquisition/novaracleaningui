import { Suspense } from "react";
import HiringLeadCleaner from "@/views/hiring/HiringLeadCleaner";

export default function Page() {
  return (
    <Suspense>
      <HiringLeadCleaner />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

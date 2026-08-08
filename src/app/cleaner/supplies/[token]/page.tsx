import { Suspense } from "react";
import SupplyChecklist from "@/views/cleaner/SupplyChecklist";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense>
      <SupplyChecklist />
    </Suspense>
  );
}

import { Suspense } from "react";

import PricingSheetPage from "@/views/PricingSheet";

export default function Page() {
  return <PricingSheetPage />;
}

export const dynamic = "force-dynamic";

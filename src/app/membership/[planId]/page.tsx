import { Suspense } from "react";

import PlanDetailPage from "@/views/membership/PlanDetail";

export default function Page() {
  return <PlanDetailPage />;
}

export const dynamic = "force-dynamic";

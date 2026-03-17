import { Suspense } from "react";
import MobileDashboardPage from "@/views/cleaner/MobileDashboard";

export default function Page() {
  return (
    <Suspense>
      <MobileDashboardPage />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

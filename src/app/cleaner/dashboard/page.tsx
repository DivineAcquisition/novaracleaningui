import { Suspense } from "react";

import CleanerDashboardPage from "@/views/cleaner/Dashboard";

export default function Page() {
  return <CleanerDashboardPage />;
}

export const dynamic = "force-dynamic";

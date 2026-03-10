import { Suspense } from "react";

import OnboardingPortalPage from "@/views/cleaner/OnboardingPortal";

export default function Page() {
  return <OnboardingPortalPage />;
}

export const dynamic = "force-dynamic";

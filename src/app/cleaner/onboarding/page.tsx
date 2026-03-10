import { Suspense } from "react";

import CleanerOnboardingPage from "@/views/cleaner/Onboarding";

export default function Page() {
  return <CleanerOnboardingPage />;
}

export const dynamic = "force-dynamic";

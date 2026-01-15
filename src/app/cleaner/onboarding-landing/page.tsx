"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";

const OnboardingLanding = nextDynamic(() => import("@/page-components/cleaner/OnboardingLanding"), {
  ssr: false,
});

export default function Page() {
  return <OnboardingLanding />;
}

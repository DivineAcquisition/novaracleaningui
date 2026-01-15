"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";

const CleanerOnboarding = nextDynamic(() => import("@/page-components/cleaner/Onboarding"), {
  ssr: false,
});

export default function Page() {
  return <CleanerOnboarding />;
}

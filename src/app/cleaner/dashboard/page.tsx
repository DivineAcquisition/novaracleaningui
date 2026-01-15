"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";

const CleanerDashboard = nextDynamic(() => import("@/page-components/cleaner/Dashboard"), {
  ssr: false,
});

export default function Page() {
  return <CleanerDashboard />;
}

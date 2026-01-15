"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";

const MobileDashboard = nextDynamic(() => import("@/page-components/cleaner/MobileDashboard"), {
  ssr: false,
});

export default function Page() {
  return <MobileDashboard />;
}

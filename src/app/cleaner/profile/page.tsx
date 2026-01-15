"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";

const CleanerProfile = nextDynamic(() => import("@/page-components/cleaner/Profile"), {
  ssr: false,
});

export default function Page() {
  return <CleanerProfile />;
}

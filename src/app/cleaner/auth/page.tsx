"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";

const CleanerAuth = nextDynamic(() => import("@/page-components/cleaner/Auth"), {
  ssr: false,
});

export default function Page() {
  return <CleanerAuth />;
}

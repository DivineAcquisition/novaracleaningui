"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";

const IndexPageContent = nextDynamic(() => import("@/page-components/Index"), {
  ssr: false,
});

export default function Page() {
  return <IndexPageContent />;
}

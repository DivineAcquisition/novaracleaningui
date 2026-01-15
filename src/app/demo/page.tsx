"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";

const Demo = nextDynamic(() => import("@/page-components/Demo"), {
  ssr: false,
});

export default function Page() {
  return <Demo />;
}

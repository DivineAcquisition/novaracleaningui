"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";

const CustomQuote = nextDynamic(() => import("@/page-components/book/CustomQuote"), {
  ssr: false,
});

export default function Page() {
  return <CustomQuote />;
}

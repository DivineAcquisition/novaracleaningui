"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";

const MobileJobOffers = nextDynamic(() => import("@/page-components/cleaner/MobileJobOffers"), {
  ssr: false,
});

export default function Page() {
  return <MobileJobOffers />;
}

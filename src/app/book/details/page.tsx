"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";

const PropertyDetails = nextDynamic(() => import("@/page-components/book/PropertyDetails"), {
  ssr: false,
});

export default function Page() {
  return <PropertyDetails />;
}

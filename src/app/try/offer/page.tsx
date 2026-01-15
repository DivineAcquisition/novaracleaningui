"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";

const BookingOffer = nextDynamic(() => import("@/page-components/book/Offer"), {
  ssr: false,
});

export default function Page() {
  return <BookingOffer />;
}

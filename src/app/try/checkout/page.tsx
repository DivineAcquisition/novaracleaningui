"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";

const BookingCheckout = nextDynamic(() => import("@/page-components/book/Checkout"), {
  ssr: false,
});

export default function Page() {
  return <BookingCheckout />;
}

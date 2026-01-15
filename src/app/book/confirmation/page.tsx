"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";

const BookingSuccess = nextDynamic(() => import("@/page-components/book/Success"), {
  ssr: false,
});

export default function Page() {
  return <BookingSuccess />;
}

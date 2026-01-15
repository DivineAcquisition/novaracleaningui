"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";

const BookingZip = nextDynamic(() => import("@/page-components/book/Zip"), {
  ssr: false,
});

export default function Page() {
  return <BookingZip />;
}

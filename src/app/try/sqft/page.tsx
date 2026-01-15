"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";

const BookingHome = nextDynamic(() => import("@/page-components/book/Home"), {
  ssr: false,
});

export default function Page() {
  return <BookingHome />;
}

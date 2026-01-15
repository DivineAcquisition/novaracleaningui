"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";

const BookingIntake = nextDynamic(() => import("@/page-components/admin/BookingIntake"), {
  ssr: false,
});

export default function Page() {
  return <BookingIntake />;
}

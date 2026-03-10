import { Suspense } from "react";

import MemberBookingPage from "@/views/portal/MemberBooking";

export default function Page() {
  return <MemberBookingPage />;
}

export const dynamic = "force-dynamic";

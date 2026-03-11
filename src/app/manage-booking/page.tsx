import { Suspense } from "react";
import ManageBookingPage from "@/views/ManageBooking";

export default function Page() {
  return (
    <Suspense>
      <ManageBookingPage />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

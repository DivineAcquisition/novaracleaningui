import { Suspense } from "react";

import BookingCheckoutPage from "@/views/book/Checkout";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <BookingCheckoutPage />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

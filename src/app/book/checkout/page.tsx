import { Suspense } from "react";

import BookingCheckoutPage from "@/views/book/Checkout";

export default function Page() {
  return <BookingCheckoutPage />;
}

export const dynamic = "force-dynamic";

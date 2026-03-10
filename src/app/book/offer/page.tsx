import { Suspense } from "react";

import BookingOfferPage from "@/views/book/Offer";

export default function Page() {
  return <BookingOfferPage />;
}

export const dynamic = "force-dynamic";

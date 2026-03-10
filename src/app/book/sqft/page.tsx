import { Suspense } from "react";

import BookingHomePage from "@/views/book/Home";

export default function Page() {
  return <BookingHomePage />;
}

export const dynamic = "force-dynamic";

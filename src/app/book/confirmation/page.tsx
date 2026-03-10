import { Suspense } from "react";
import BookingSuccessPage from "@/views/book/Success";

export default function Page() {
  return (
    <Suspense>
      <BookingSuccessPage />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

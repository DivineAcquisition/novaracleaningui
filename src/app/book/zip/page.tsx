import { Suspense } from "react";
import BookingZipPage from "@/views/book/Zip";

export default function Page() {
  return (
    <Suspense>
      <BookingZipPage />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

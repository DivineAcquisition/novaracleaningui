import { Suspense } from "react";
import PropertyDetailsPage from "@/views/book/PropertyDetails";

export default function Page() {
  return (
    <Suspense>
      <PropertyDetailsPage />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

import { Suspense } from "react";
import SalesToolPage from "@/views/admin/SalesTool";

export default function Page() {
  return (
    <Suspense>
      <SalesToolPage />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

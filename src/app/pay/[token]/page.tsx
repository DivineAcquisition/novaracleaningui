import { Suspense } from "react";
import PayPage from "@/views/PayPage";

export default function Page() {
  return (
    <Suspense>
      <PayPage />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

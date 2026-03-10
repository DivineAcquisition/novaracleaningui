import { Suspense } from "react";
import IndexPage from "@/views/Index";

export default function Page() {
  return (
    <Suspense>
      <IndexPage />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

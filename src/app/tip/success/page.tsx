import { Suspense } from "react";
import TipSuccess from "@/views/TipSuccess";

export default function Page() {
  return (
    <Suspense>
      <TipSuccess />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

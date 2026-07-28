import { Suspense } from "react";
import HiringHome from "@/views/hiring/HiringHome";

export default function Page() {
  return (
    <Suspense>
      <HiringHome />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

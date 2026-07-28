import { Suspense } from "react";
import HiringFieldTech from "@/views/hiring/HiringFieldTech";

export default function Page() {
  return (
    <Suspense>
      <HiringFieldTech />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

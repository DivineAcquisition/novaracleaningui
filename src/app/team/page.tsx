import { Suspense } from "react";
import VaOnboarding from "@/views/team/VaOnboarding";

export default function Page() {
  return (
    <Suspense>
      <VaOnboarding />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

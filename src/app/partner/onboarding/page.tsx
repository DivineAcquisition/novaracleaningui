import { Suspense } from "react";
import HostOnboarding from "@/views/partner/HostOnboarding";

export default function Page() {
  return (
    <Suspense>
      <HostOnboarding />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

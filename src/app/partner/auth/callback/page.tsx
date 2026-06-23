import { Suspense } from "react";
import PartnerAuthCallback from "@/views/partner/PartnerAuthCallback";

export default function Page() {
  return (
    <Suspense>
      <PartnerAuthCallback />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

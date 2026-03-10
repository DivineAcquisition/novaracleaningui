import { Suspense } from "react";
import MembershipSuccessPage from "@/views/membership/MembershipSuccess";

export default function Page() {
  return (
    <Suspense>
      <MembershipSuccessPage />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

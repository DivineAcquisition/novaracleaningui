import { Suspense } from "react";
import MembershipPayPage from "@/views/MembershipPayPage";

export default function Page() {
  return (
    <Suspense>
      <MembershipPayPage />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

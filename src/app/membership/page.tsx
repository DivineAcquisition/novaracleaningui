import { Suspense } from "react";

import MembershipPage from "@/views/Membership";

export default function Page() {
  return <MembershipPage />;
}

export const dynamic = "force-dynamic";

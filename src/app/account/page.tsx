import { Suspense } from "react";

import AccountPage from "@/views/Account";

export default function Page() {
  return <AccountPage />;
}

export const dynamic = "force-dynamic";

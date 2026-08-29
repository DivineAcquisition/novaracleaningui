import { Suspense } from "react";

import { PortalLayout } from "@/components/portal/PortalLayout";
import AccountPage from "@/views/Account";

export default function Page() {
  return (
    <PortalLayout>
      <Suspense>
        <AccountPage />
      </Suspense>
    </PortalLayout>
  );
}

export const dynamic = "force-dynamic";

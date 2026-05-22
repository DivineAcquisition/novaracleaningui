import { Suspense } from "react";

import AdminAuthCallback from "@/views/admin/AuthCallback";

export default function Page() {
  return (
    <Suspense>
      <AdminAuthCallback />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

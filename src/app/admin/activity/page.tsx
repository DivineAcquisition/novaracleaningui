import { Suspense } from "react";

import AdminActivityPage from "@/views/admin/Activity";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <Suspense>
        <AdminActivityPage />
      </Suspense>
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

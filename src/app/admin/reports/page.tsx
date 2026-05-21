import { Suspense } from "react";

import AdminReportsPage from "@/views/admin/Reports";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <Suspense>
        <AdminReportsPage />
      </Suspense>
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

import { Suspense } from "react";

import AdminMapPage from "@/views/admin/Map";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <Suspense>
        <AdminMapPage />
      </Suspense>
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

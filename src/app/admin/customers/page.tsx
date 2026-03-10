import { Suspense } from "react";

import AdminCustomersPage from "@/views/admin/Customers";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminCustomersPage />
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

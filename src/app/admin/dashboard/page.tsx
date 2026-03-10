import { Suspense } from "react";

import AdminDashboardPage from "@/views/admin/Dashboard";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminDashboardPage />
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

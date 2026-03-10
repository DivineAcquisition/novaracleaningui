import { Suspense } from "react";

import AdminCleanersPage from "@/views/admin/Cleaners";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminCleanersPage />
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

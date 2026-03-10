import { Suspense } from "react";

import CleanerDirectoryPage from "@/views/admin/CleanerDirectory";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <CleanerDirectoryPage />
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

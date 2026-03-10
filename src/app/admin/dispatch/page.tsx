import { Suspense } from "react";

import DispatchQueuePage from "@/views/admin/DispatchQueue";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <DispatchQueuePage />
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

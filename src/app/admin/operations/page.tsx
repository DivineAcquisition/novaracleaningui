import { Suspense } from "react";
import AdminLayout from "@/components/admin/AdminLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Operations from "@/views/admin/Operations";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminLayout>
        <Suspense>
          <Operations />
        </Suspense>
      </AdminLayout>
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

import { Suspense } from "react";
import AdminLayout from "@/components/admin/AdminLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import AdminDispatch from "@/views/admin/Dispatch";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminLayout>
        <Suspense>
          <AdminDispatch />
        </Suspense>
      </AdminLayout>
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

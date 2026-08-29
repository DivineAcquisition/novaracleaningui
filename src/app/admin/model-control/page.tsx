import { Suspense } from "react";
import AdminLayout from "@/components/admin/AdminLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import ModelControl from "@/views/admin/ModelControl";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin_strict">
      <AdminLayout>
        <Suspense>
          <ModelControl />
        </Suspense>
      </AdminLayout>
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

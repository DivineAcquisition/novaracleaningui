import { Suspense } from "react";
import AdminLayout from "@/components/admin/AdminLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import AdminMap from "@/views/admin/Map";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminLayout>
        <Suspense>
          <AdminMap />
        </Suspense>
      </AdminLayout>
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

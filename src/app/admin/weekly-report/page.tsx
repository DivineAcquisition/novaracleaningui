import { Suspense } from "react";
import AdminLayout from "@/components/admin/AdminLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import WeeklyReport from "@/views/admin/WeeklyReport";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin_strict">
      <AdminLayout>
        <Suspense>
          <WeeklyReport />
        </Suspense>
      </AdminLayout>
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

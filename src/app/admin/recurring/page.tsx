import { Suspense } from "react";
import AdminLayout from "@/components/admin/AdminLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import AdminRecurringSchedules from "@/views/admin/RecurringSchedules";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminLayout>
        <Suspense>
          <AdminRecurringSchedules />
        </Suspense>
      </AdminLayout>
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

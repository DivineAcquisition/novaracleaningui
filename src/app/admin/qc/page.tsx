import AdminLayout from "@/components/admin/AdminLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import QualityControl from "@/views/admin/QualityControl";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminLayout>
        <QualityControl />
      </AdminLayout>
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

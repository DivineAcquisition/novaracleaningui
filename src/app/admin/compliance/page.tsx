import AdminLayout from "@/components/admin/AdminLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import ComplianceCenter from "@/views/admin/ComplianceCenter";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminLayout>
        <ComplianceCenter />
      </AdminLayout>
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

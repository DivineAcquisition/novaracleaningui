import AdminLayout from "@/components/admin/AdminLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import ContractorIntakeAdmin from "@/views/admin/ContractorIntakeAdmin";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminLayout>
        <ContractorIntakeAdmin />
      </AdminLayout>
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

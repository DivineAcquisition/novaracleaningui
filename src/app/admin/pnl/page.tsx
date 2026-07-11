import AdminLayout from "@/components/admin/AdminLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import PnL from "@/views/admin/PnL";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminLayout>
        <PnL />
      </AdminLayout>
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

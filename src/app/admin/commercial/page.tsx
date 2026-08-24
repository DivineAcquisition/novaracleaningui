import { Suspense } from "react";
import AdminLayout from "@/components/admin/AdminLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import CommercialHub from "@/views/admin/CommercialHub";

// Canonical Commercial hub. Old /admin/partner bookmarks redirect here.
export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin_strict">
      <AdminLayout>
        <Suspense>
          <CommercialHub />
        </Suspense>
      </AdminLayout>
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

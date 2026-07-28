import { Suspense } from "react";

import AdminLayout from "@/components/admin/AdminLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import VaPerformance from "@/views/admin/VaPerformance";

export default function Page() {
  // admin_strict: this surface shows every VA's verified numbers, blockers and
  // coaching history. Peers must not see it, and the qualitative fields only
  // stay honest if the audience is the person they're written for.
  return (
    <ProtectedRoute requiredRole="admin_strict">
      <AdminLayout>
        <Suspense>
          <VaPerformance />
        </Suspense>
      </AdminLayout>
    </ProtectedRoute>
  );
}

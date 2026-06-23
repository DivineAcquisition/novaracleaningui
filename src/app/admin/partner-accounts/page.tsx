import { Suspense } from "react";
import AdminLayout from "@/components/admin/AdminLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import PartnerAccounts from "@/views/admin/PartnerAccounts";

// STR Partner Account Management (admin) — manage host partners across their
// lifecycle: pricing, go-live, pauses, revenue, and the needs-attention queue.
export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminLayout>
        <Suspense>
          <PartnerAccounts />
        </Suspense>
      </AdminLayout>
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

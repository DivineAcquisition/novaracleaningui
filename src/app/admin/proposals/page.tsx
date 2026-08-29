import { Suspense } from "react";
import AdminLayout from "@/components/admin/AdminLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import ProposalsHub from "@/views/admin/ProposalsHub";

// Dedicated Proposals tab — parallel to Internal Booking. A proposal request
// is not a booking. VAs submit intake; assignment is paid walkthrough work.
export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminLayout>
        <Suspense>
          <ProposalsHub />
        </Suspense>
      </AdminLayout>
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

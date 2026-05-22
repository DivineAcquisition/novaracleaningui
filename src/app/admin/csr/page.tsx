import { Suspense } from "react";
import AdminLayout from "@/components/admin/AdminLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import VaBooking from "@/views/admin/VaBooking";

// CSR Form — VAs submit a booking on behalf of a customer. Powered by
// the existing book-as-va edge function via the VaBooking wizard.
export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminLayout>
        <Suspense>
          <VaBooking />
        </Suspense>
      </AdminLayout>
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

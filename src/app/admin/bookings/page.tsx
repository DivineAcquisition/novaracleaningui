import { Suspense } from "react";

import AdminBookingsPage from "@/views/admin/Bookings";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminBookingsPage />
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

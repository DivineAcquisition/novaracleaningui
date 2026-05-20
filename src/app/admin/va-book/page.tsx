import { Suspense } from "react";
import VaBooking from "@/views/admin/VaBooking";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <Suspense>
        <VaBooking />
      </Suspense>
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

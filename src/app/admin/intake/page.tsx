import { Suspense } from "react";

import BookingIntakePage from "@/views/admin/BookingIntake";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <BookingIntakePage />
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const AdminCleaners = nextDynamic(() => import("@/page-components/admin/Cleaners"), {
  ssr: false,
});

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminCleaners />
    </ProtectedRoute>
  );
}

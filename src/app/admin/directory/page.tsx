"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const CleanerDirectory = nextDynamic(() => import("@/page-components/admin/CleanerDirectory"), {
  ssr: false,
});

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <CleanerDirectory />
    </ProtectedRoute>
  );
}

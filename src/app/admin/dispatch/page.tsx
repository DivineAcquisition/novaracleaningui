"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const DispatchQueue = nextDynamic(() => import("@/page-components/admin/DispatchQueue"), {
  ssr: false,
});

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <DispatchQueue />
    </ProtectedRoute>
  );
}

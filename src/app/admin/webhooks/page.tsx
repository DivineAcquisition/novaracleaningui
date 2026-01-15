"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const AdminWebhooks = nextDynamic(() => import("@/page-components/admin/WebhookMonitor"), {
  ssr: false,
});

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminWebhooks />
    </ProtectedRoute>
  );
}

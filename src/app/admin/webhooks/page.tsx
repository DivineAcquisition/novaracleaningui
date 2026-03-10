import { Suspense } from "react";

import WebhookMonitorPage from "@/views/admin/WebhookMonitor";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <WebhookMonitorPage />
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

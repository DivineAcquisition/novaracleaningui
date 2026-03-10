import { Suspense } from "react";

import WebhookTesterPage from "@/views/admin/WebhookTester";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <WebhookTesterPage />
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

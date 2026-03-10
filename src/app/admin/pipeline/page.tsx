import { Suspense } from "react";

import LeadPipelinePage from "@/views/admin/LeadPipeline";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <LeadPipelinePage />
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

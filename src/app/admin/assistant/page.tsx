import { Suspense } from "react";
import AdminLayout from "@/components/admin/AdminLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import AssistantKnowledge from "@/views/admin/AssistantKnowledge";

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin_strict">
      <AdminLayout>
        <Suspense>
          <AssistantKnowledge />
        </Suspense>
      </AdminLayout>
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

import { Suspense } from "react";
import AdminLayout from "@/components/admin/AdminLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import WalkthroughIntakeForm from "@/views/walkthrough/WalkthroughIntakeForm";

// VA/admin copy of the tokenized onsite document. Same checklist the
// walkthrough agent opens — additions from either side land on one record.
export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AdminLayout>
        <Suspense>
          <WalkthroughIntakeForm staff />
        </Suspense>
      </AdminLayout>
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

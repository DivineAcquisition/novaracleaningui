"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const WebhookTester = nextDynamic(() => import("@/page-components/admin/WebhookTester"), {
  ssr: false,
});

export default function Page() {
  return (
    <ProtectedRoute requiredRole="admin">
      <WebhookTester />
    </ProtectedRoute>
  );
}

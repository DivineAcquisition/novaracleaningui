import { Suspense } from "react";
import { redirect } from "next/navigation";
import AdminLayout from "@/components/admin/AdminLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import CommercialHub from "@/views/admin/CommercialHub";
import { proposalsHubTab } from "@/lib/commercial-proposal";

// Canonical Accounts hub (was Commercial). Offer send lives on Proposals.
export default function Page({
  searchParams,
}: {
  searchParams: { tab?: string; account?: string };
}) {
  const raw = String(searchParams?.tab || "");
  const tab = raw === "proposals" ? "pipeline" : raw;
  if (tab === "send") {
    redirect(proposalsHubTab("send", searchParams?.account ? { account: searchParams.account } : undefined));
  }
  if (tab === "pipeline") {
    redirect(proposalsHubTab("pipeline"));
  }
  if (tab === "walkthroughs") {
    redirect(proposalsHubTab("price"));
  }

  return (
    <ProtectedRoute requiredRole="admin_strict">
      <AdminLayout>
        <Suspense>
          <CommercialHub />
        </Suspense>
      </AdminLayout>
    </ProtectedRoute>
  );
}

export const dynamic = "force-dynamic";

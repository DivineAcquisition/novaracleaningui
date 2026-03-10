import { Suspense } from "react";

import AdminAuthPage from "@/views/admin/Auth";

export default function Page() {
  return <AdminAuthPage />;
}

export const dynamic = "force-dynamic";

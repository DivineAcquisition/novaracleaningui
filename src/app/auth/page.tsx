import { Suspense } from "react";

import AuthPage from "@/views/Auth";

export default function Page() {
  return <AuthPage />;
}

export const dynamic = "force-dynamic";

import { Suspense } from "react";

import AuthCallbackPage from "@/views/AuthCallback";

export default function Page() {
  return <AuthCallbackPage />;
}

export const dynamic = "force-dynamic";

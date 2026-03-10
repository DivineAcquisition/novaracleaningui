import { Suspense } from "react";

import CleanerAuthCallbackPage from "@/views/cleaner/AuthCallback";

export default function Page() {
  return <CleanerAuthCallbackPage />;
}

export const dynamic = "force-dynamic";

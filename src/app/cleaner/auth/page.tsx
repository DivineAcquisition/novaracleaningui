import { Suspense } from "react";

import CleanerAuthPage from "@/views/cleaner/Auth";

export default function Page() {
  return <CleanerAuthPage />;
}

export const dynamic = "force-dynamic";

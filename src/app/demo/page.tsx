import { Suspense } from "react";

import DemoPage from "@/views/Demo";

export default function Page() {
  return <DemoPage />;
}

export const dynamic = "force-dynamic";

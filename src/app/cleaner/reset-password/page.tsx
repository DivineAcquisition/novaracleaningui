"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";

const CleanerResetPassword = nextDynamic(() => import("@/page-components/cleaner/ResetPassword"), {
  ssr: false,
});

export default function Page() {
  return <CleanerResetPassword />;
}

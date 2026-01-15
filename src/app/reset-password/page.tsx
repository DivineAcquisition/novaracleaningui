"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";

const ResetPasswordPage = nextDynamic(() => import("@/page-components/ResetPassword"), {
  ssr: false,
});

export default function Page() {
  return <ResetPasswordPage />;
}

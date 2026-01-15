"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";

const AuthPage = nextDynamic(() => import("@/page-components/Auth"), {
  ssr: false,
});

export default function Page() {
  return <AuthPage />;
}

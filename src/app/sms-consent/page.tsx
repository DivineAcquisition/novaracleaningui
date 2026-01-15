"use client";
export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";

const SmsConsent = nextDynamic(() => import("@/page-components/SmsConsent"), {
  ssr: false,
});

export default function Page() {
  return <SmsConsent />;
}

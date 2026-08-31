import type { Metadata } from "next";

import HostOnboardingSession from "@/views/partner/HostOnboardingSession";

export const metadata: Metadata = {
  title: "Host partnership setup — Novara Cleaning",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function HostOnboardingSessionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <HostOnboardingSession token={token} />;
}

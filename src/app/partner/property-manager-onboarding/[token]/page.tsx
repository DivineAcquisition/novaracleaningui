import type { Metadata } from "next";

import PropertyManagerOnboardingSession from "@/views/partner/PropertyManagerOnboardingSession";

export const metadata: Metadata = {
  title: "Property management setup — Novara Cleaning",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function PropertyManagerOnboardingSessionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PropertyManagerOnboardingSession token={token} />;
}

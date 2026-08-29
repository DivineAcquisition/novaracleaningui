import type { Metadata } from "next";

import CommercialOnboarding from "@/views/commercial/CommercialOnboarding";

// Tokenized and private: the link in the email is the credential, so this page
// must never be indexed or cached by anything shared.
export const metadata: Metadata = {
  title: "Getting set up — Novara Cleaning",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function CommercialOnboardingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <CommercialOnboarding token={token} />;
}

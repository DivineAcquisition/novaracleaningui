import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { GuidePdfLanding } from "@/views/cleaner/GuidePdfLanding";
import {
  guideByLandingSlug,
  onboardingGuideLandingSlugs,
} from "@/lib/cleaner-onboarding-guides";

export function generateStaticParams() {
  return onboardingGuideLandingSlugs().map((slug) => ({ slug }));
}

export function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Metadata {
  const guide = guideByLandingSlug(params.slug);
  if (!guide) return { title: "Guide", robots: { index: false, follow: false } };
  return {
    title: `${guide.title} | Novara Cleaning`,
    description: guide.lede,
    robots: { index: false, follow: false, nocache: true },
  };
}

export default function Page({ params }: { params: { slug: string } }) {
  const guide = guideByLandingSlug(params.slug);
  if (!guide) notFound();
  return <GuidePdfLanding guideId={guide.id} />;
}

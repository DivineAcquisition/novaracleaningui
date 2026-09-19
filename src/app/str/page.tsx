import { Suspense } from "react";
import type { Metadata } from "next";
import StrLanding from "@/views/str/StrLanding";
import { HERO_HEADLINE, STR_URL } from "@/lib/str-landing/landing";

export const metadata: Metadata = {
  title: "Short-Term Rental Turnover Cleaning — Instant Rate",
  description:
    "Guest-ready turnover cleaning for your short-term rental, priced from our published Property & Rate Schedule bands. Claim your rate and set up in one sitting.",
  alternates: { canonical: STR_URL },
  openGraph: {
    title: "Short-Term Rental Turnover Cleaning",
    description: HERO_HEADLINE,
    url: STR_URL,
  },
};

export default function Page() {
  return (
    <Suspense>
      <StrLanding />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

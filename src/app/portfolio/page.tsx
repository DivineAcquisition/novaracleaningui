import { Suspense } from "react";
import type { Metadata } from "next";
import PortfolioLanding from "@/views/portfolio/PortfolioLanding";
import { HERO_HEADLINE, PORTFOLIO_URL } from "@/lib/property-manager/landing";

export const metadata: Metadata = {
  title: "Rental Property Cleaning — Standing Rates for One Unit or Fifty",
  description:
    "Reliable move-in, move-out, and standard cleaning for rental properties — whether it's one unit or fifty. Instant standing-rate estimate across Maryland, D.C., and Virginia.",
  alternates: { canonical: PORTFOLIO_URL },
  openGraph: {
    title: "Rental Property Cleaning — One Unit or Fifty",
    description: HERO_HEADLINE,
    url: PORTFOLIO_URL,
  },
};

export default function Page() {
  return (
    <Suspense>
      <PortfolioLanding />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

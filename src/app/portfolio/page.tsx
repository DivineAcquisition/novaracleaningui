import { Suspense } from "react";
import type { Metadata } from "next";
import PortfolioLanding from "@/views/portfolio/PortfolioLanding";
import { PORTFOLIO_URL } from "@/lib/property-manager/landing";

export const metadata: Metadata = {
  title: "Property Manager Turnover Cleaning — Standing Rates, No Re-quoting",
  description:
    "One standing rate per rental unit, set once. Consolidated invoicing, before/after photos, and portfolio pricing across Maryland, D.C., and Virginia.",
  alternates: { canonical: PORTFOLIO_URL },
  openGraph: {
    title: "Property Manager Turnover Cleaning — Standing Rates, No Re-quoting",
    description:
      "One standing rate per unit, set once — no re-quoting every turnover. Serving Maryland, Virginia, and D.C.",
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

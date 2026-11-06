import type { Metadata } from "next";
import HomePage from "@/views/home/HomePage";
import { getCoverage } from "@/lib/landing/coverage";
import { getLandingData } from "@/lib/landing/data";

// Main home page. novaracleaning.com and www.novaracleaning.com show this at
// their root (the middleware rewrites "/" to "/home" on those hosts);
// try.novaracleaning.com keeps the booking landing page with the ZIP form.

const TITLE = "Novara Cleaning | Home, Airbnb & Office Cleaning in MD, DC & VA";
const DESCRIPTION =
  "House cleaning, Airbnb turnovers, and office cleaning across Maryland, Washington DC, and Northern Virginia. Prices shown before you book, a written checklist every visit, and a 24-hour re-clean guarantee.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "https://novaracleaning.com" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "https://novaracleaning.com" },
  twitter: { title: TITLE, description: DESCRIPTION },
};

export default async function Page() {
  const [data, coverage] = await Promise.all([getLandingData(), getCoverage()]);
  return <HomePage data={data} coverage={coverage} />;
}

export const dynamic = "force-dynamic";

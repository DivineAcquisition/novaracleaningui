import type { Metadata } from "next";
import { Suspense } from "react";
import IndexPage from "@/views/Index";
import { getLandingData } from "@/lib/landing/data";

export const metadata: Metadata = {
  title: "Novara Cleaning | House Cleaning in Maryland, DC & Virginia",
  description:
    "House cleaning across the DMV with your exact price before you book. Written checklists, a 48-hour re-clean guarantee, and an AI assistant that answers 24/7.",
  alternates: { canonical: "https://novaracleaning.com" },
};

export default async function Page() {
  const data = await getLandingData();
  return (
    <Suspense>
      <IndexPage data={data} />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { Suspense } from "react";
import IndexPage from "@/views/Index";
import { getLandingData } from "@/lib/landing/data";
import { SITE } from "@/lib/landing/content";

export const metadata: Metadata = {
  title: { absolute: SITE.title },
  description: SITE.description,
  alternates: { canonical: "https://novaracleaning.com" },
  openGraph: { title: SITE.title, description: SITE.description },
  twitter: { title: SITE.title, description: SITE.description },
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

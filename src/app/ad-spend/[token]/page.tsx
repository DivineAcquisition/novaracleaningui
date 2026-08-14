import type { Metadata } from "next";
import { Suspense } from "react";

import AdSpendForm from "@/views/ad-spend/AdSpendForm";

export const metadata: Metadata = {
  title: "Monthly ad spend log — Novara",
  robots: { index: false, follow: false, nocache: true },
};

export default function Page({ params }: { params: { token: string } }) {
  return (
    <Suspense>
      <AdSpendForm token={params.token} />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

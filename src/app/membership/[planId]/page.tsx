import type { Metadata } from "next";
import { Suspense } from "react";

import PlanDetailPage from "@/views/membership/PlanDetail";

export const metadata: Metadata = {
  title: "Membership plan · Novara Cleaning",
  description: "Pick your home size to see the monthly price, what each visit includes, and the membership terms.",
};

export default function Page() {
  return <PlanDetailPage />;
}

export const dynamic = "force-dynamic";

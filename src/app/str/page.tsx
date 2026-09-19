import { Suspense } from "react";
import type { Metadata } from "next";
import StrLanding from "@/views/str/StrLanding";
import { STR_URL } from "@/lib/host-landing/landing";

export const metadata: Metadata = {
  title: "Airbnb Turnover Cleaning with Backup Coverage — Novara Cleaning",
  description:
    "Guest-ready turnovers timed to checkout and check-in, with backup coverage if a cleaner can't make it. Instant per-turnover estimate for STR hosts in Maryland, D.C., and Virginia.",
  alternates: { canonical: STR_URL },
  openGraph: {
    title: "Airbnb Turnover Cleaning with Backup Coverage",
    description:
      "Reliability and backup coverage for STR hosts — not just that we clean Airbnbs. Serving Maryland, Virginia, and D.C.",
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

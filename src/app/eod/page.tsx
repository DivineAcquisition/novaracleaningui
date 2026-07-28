import type { Metadata } from "next";

import EodReport from "@/views/eod/EodReport";

export const metadata: Metadata = {
  title: "End of Day — Novara",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <EodReport />;
}

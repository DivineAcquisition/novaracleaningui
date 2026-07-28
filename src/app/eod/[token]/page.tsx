import type { Metadata } from "next";

import EodReport from "@/views/eod/EodReport";

export const metadata: Metadata = {
  title: "End of Day — Novara",
  // The token in the URL is the credential — keep it out of every index.
  robots: { index: false, follow: false, nocache: true },
};

export default function Page({ params }: { params: { token: string } }) {
  return <EodReport token={params.token} />;
}

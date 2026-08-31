import type { Metadata } from "next";

import HostPartnershipAgreementDoc from "@/views/partner/HostPartnershipAgreementDoc";

export const metadata: Metadata = {
  title: "Host Partnership Agreement — Novara Cleaning",
  robots: { index: false, follow: true },
};

export default function HostPartnershipAgreementPage() {
  return <HostPartnershipAgreementDoc />;
}

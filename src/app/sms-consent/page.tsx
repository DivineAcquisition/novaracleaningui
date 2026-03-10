import { Suspense } from "react";

import SmsConsentPage from "@/views/SmsConsent";

export default function Page() {
  return <SmsConsentPage />;
}

export const dynamic = "force-dynamic";

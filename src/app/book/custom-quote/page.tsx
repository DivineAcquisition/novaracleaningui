import { Suspense } from "react";

import CustomQuotePage from "@/views/book/CustomQuote";

export default function Page() {
  return <CustomQuotePage />;
}

export const dynamic = "force-dynamic";

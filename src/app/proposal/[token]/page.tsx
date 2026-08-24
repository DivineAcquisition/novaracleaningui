import { Suspense } from "react";
import ProposalPage from "@/views/commercial/ProposalPage";

export default function Page() {
  return (
    <Suspense>
      <ProposalPage />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

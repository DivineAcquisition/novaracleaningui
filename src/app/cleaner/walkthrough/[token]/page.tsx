import { Suspense } from "react";
import WalkthroughIntakeForm from "@/views/walkthrough/WalkthroughIntakeForm";

export default function Page() {
  return (
    <Suspense>
      <WalkthroughIntakeForm />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

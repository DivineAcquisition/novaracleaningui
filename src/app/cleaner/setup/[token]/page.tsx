import { Suspense } from "react";
import SetupContinue from "@/views/cleaner/SetupContinue";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense>
      <SetupContinue />
    </Suspense>
  );
}

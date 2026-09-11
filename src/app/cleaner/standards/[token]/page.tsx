import { Suspense } from "react";
import StandardsAcknowledge from "@/views/cleaner/StandardsAcknowledge";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense>
      <StandardsAcknowledge />
    </Suspense>
  );
}

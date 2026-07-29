import { Suspense } from "react";
import AgreementSign from "@/views/cleaner/AgreementSign";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense>
      <AgreementSign />
    </Suspense>
  );
}

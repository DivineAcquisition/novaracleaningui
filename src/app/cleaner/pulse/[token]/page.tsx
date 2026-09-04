import { Suspense } from "react";
import PulseCheckForm from "@/views/cleaner/PulseCheckForm";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense>
      <PulseCheckForm />
    </Suspense>
  );
}

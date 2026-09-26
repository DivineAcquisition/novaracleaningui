import { Suspense } from "react";
import W9Link from "@/views/cleaner/W9Link";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense>
      <W9Link />
    </Suspense>
  );
}

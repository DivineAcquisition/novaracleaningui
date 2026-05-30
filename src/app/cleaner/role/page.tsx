import { Suspense } from "react";

import CleanerRoleIntro from "@/views/cleaner/RoleIntro";

export default function Page() {
  return (
    <Suspense>
      <CleanerRoleIntro />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

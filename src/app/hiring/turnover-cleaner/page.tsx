import { Suspense } from "react";
import { HiringRoleDetail } from "@/components/hiring/HiringRoleDetail";

export default function Page() {
  return (
    <Suspense>
      <HiringRoleDetail roleId="turnover_cleaner" />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

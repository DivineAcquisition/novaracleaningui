import { Suspense } from "react";
import RecurringManagePage from "@/views/RecurringManage";

export default function Page() {
  return (
    <Suspense>
      <RecurringManagePage />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

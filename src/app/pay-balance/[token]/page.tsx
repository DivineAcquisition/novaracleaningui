import { Suspense } from "react";
import BalancePayPage from "@/views/BalancePayPage";

export default function Page() {
  return (
    <Suspense>
      <BalancePayPage />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

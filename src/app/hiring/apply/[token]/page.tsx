import { Suspense } from "react";
import { TokenizedApply } from "./ui";

export default function Page({ params }: { params: { token: string } }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-[#F7F5FC] text-sm font-medium text-slate-500">
          Opening your application…
        </div>
      }
    >
      <TokenizedApply token={params.token} />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

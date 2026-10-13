import { Suspense } from "react";
import { ApplicantTypeform } from "@/components/hiring/ApplicantTypeform";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-[#F7F5FC] text-sm font-medium text-slate-500">
          Loading application…
        </div>
      }
    >
      <ApplicantTypeform />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";

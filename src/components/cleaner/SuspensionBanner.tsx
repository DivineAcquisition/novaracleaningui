"use client";

// Portal banner shown while a cleaner is suspended from NEW assignments.
// A suspension never touches portal access, existing kept jobs, or pay for
// completed work — so the cleaner stays logged in and sees exactly where
// they stand: status + end date, per the accountability policy.

import { RiPauseCircleLine } from "@remixicon/react";

export default function SuspensionBanner({
  status,
  suspendedUntil,
}: {
  status: string | null | undefined;
  suspendedUntil: string | null | undefined;
}) {
  if (String(status || "").toLowerCase() !== "suspended") return null;

  const endLabel = suspendedUntil
    ? new Date(suspendedUntil).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex gap-3">
      <RiPauseCircleLine className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
      <div className="text-sm text-amber-900 space-y-1">
        <p className="font-semibold">
          Suspended from new assignments
          {endLabel ? ` until ${endLabel}` : ""}
        </p>
        <p className="text-xs text-amber-800/90">
          You won&apos;t receive new job offers during this period. Any jobs
          kept on your schedule should still be completed as planned, and pay
          for work you&apos;ve already done is unaffected and pays on the
          normal schedule. Your eligibility resumes automatically when the
          suspension ends. Questions? Reply to the notice email we sent you.
        </p>
      </div>
    </div>
  );
}

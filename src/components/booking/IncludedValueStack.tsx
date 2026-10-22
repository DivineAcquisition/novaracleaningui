"use client";

import Link from "next/link";
import { RiCheckLine, RiExternalLinkLine, RiSparklingLine } from "@remixicon/react";
import {
  CHECKLIST_INDEX_PATH,
  VALUE_STACK_HEADLINES,
  checklistPathForServiceType,
} from "@/lib/value-stack";
import { cn } from "@/lib/utils";

type Props = {
  /** Optional service type to deep-link the right checklist. */
  serviceType?: string | null;
  className?: string;
  /** Tighter styling for the compact /pay and /membership-pay cards. */
  compact?: boolean;
};

/**
 * "All that's included" block for sign/pay pages — headlines + link to
 * the cleaning checklist.
 */
export function IncludedValueStack({ serviceType, className, compact }: Props) {
  const checklistHref = checklistPathForServiceType(serviceType);

  return (
    <div
      className={cn(
        "rounded-2xl border border-slate-200 bg-white",
        compact ? "p-4 space-y-3" : "p-5 space-y-4",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <RiSparklingLine className={cn("text-violet-700 shrink-0 mt-0.5", compact ? "w-4 h-4" : "w-5 h-5")} />
        <div>
          <p className={cn("font-semibold text-slate-900", compact ? "text-sm" : "text-base")}>
            All that&apos;s included
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
            More than a clean — photo proof, loyalty credit, your dashboard, and vetted pros.
          </p>
        </div>
      </div>

      <ul className="space-y-1.5">
        {VALUE_STACK_HEADLINES.map((line) => (
          <li key={line} className="flex items-start gap-2 text-xs text-slate-800">
            <RiCheckLine className="h-4 w-4 text-violet-600 shrink-0 mt-0.5" />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2 pt-1">
        <Link
          href={checklistHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-between gap-2 rounded-xl border border-violet-200 bg-violet-50/70 px-3 py-2.5 text-xs font-medium text-violet-800 hover:bg-violet-100 transition-colors"
        >
          <span>See the cleaning checklist</span>
          <RiExternalLinkLine className="w-3.5 h-3.5 shrink-0" />
        </Link>
        <Link
          href={CHECKLIST_INDEX_PATH}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-slate-500 underline text-center hover:text-slate-700"
        >
          Browse all service checklists
        </Link>
      </div>
    </div>
  );
}

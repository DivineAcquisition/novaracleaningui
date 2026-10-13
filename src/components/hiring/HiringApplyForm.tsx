"use client";

// Entry card for the one-question application. The form itself lives at
// /hiring/apply so it can take the full screen, Typeform-style.

import Link from "next/link";
import { RiArrowRightLine, RiCheckboxCircleLine, RiFileTextLine, RiMapPin2Line } from "@remixicon/react";
import { type HiringRoleId } from "@/lib/hiring/roles";
import { HIRING_GRADIENT } from "@/components/hiring/HiringChrome";
import { cn } from "@/lib/utils";

interface Props {
  defaultRole?: HiringRoleId;
  className?: string;
  compact?: boolean;
}

const REQUIREMENTS = [
  { icon: RiMapPin2Line, label: "Your own car — the only transportation we accept" },
  { icon: RiFileTextLine, label: "A valid government-issued photo ID" },
  { icon: RiCheckboxCircleLine, label: "Yes to supplies, and to all three consents" },
];

export function HiringApplyForm({ defaultRole = "field-tech", className, compact }: Props) {
  return (
    <div
      id="apply"
      className={cn(
        "scroll-mt-24 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_12px_40px_-24px_rgba(15,23,42,0.25)] sm:p-7",
        className,
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5C0FFE]">Apply</p>
      <h3 className="mt-1 font-heading text-xl font-bold text-slate-900 sm:text-2xl">
        One question at a time
      </h3>
      {!compact && (
        <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
          A short application. You’ll need a car, a photo ID, and a willingness to get supplies.
        </p>
      )}
      <ul className="mt-5 space-y-2.5">
        {REQUIREMENTS.map((item) => (
          <li key={item.label} className="flex items-start gap-2.5 text-sm text-slate-600">
            <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-[#8F7BFD]" />
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
      <Link
        href={`/hiring/apply?role=${defaultRole}`}
        className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold text-white shadow-[0_12px_28px_-14px_rgba(92,15,254,0.65)] transition hover:opacity-95"
        style={{ background: HIRING_GRADIENT }}
      >
        Start application
        <RiArrowRightLine className="h-4 w-4" />
      </Link>
    </div>
  );
}

"use client";

import type { ReactNode } from "react";
import { RiDownloadLine, RiShieldCheckLine } from "@remixicon/react";

import {
  COMPANY_COI_CARRIER,
  COMPANY_COI_PUBLIC_HREF,
  companyCoiExpiresLabel,
} from "@/lib/company-coi-public";
import { cn } from "@/lib/utils";

type Tone = "inline" | "button" | "quiet";

export function CompanyCoiDownloadLink({
  tone = "inline",
  className,
  children,
  showMeta = false,
}: {
  tone?: Tone;
  className?: string;
  children?: ReactNode;
  showMeta?: boolean;
}) {
  const label = children || "Download our certificate of insurance";
  const href = COMPANY_COI_PUBLIC_HREF;
  const meta = showMeta
    ? `${COMPANY_COI_CARRIER} · current through ${companyCoiExpiresLabel()}`
    : null;

  if (tone === "button") {
    return (
      <span className={cn("inline-flex flex-col items-start gap-1", className)}>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"
        >
          <RiDownloadLine className="h-4 w-4" />
          {label}
        </a>
        {meta && <span className="text-[11px] text-muted-foreground">{meta}</span>}
      </span>
    );
  }

  if (tone === "quiet") {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn("font-semibold text-primary hover:underline", className)}
      >
        {label}
      </a>
    );
  }

  return (
    <span className={cn("inline-flex flex-col items-start gap-0.5", className)}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
      >
        <RiShieldCheckLine className="h-3.5 w-3.5 shrink-0" />
        {label}
      </a>
      {meta && <span className="pl-5 text-[11px] text-muted-foreground">{meta}</span>}
    </span>
  );
}

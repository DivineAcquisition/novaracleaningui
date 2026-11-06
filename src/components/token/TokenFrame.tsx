"use client";

// Shared frame for pages opened from a tokenized link (pay, photos, tips,
// job offers, onboarding …). Brand bar with the logo and full company name,
// a label for what the page is, a phone number for help, the page column,
// and a footer with the policy links. Visual only: each page keeps its own
// content, steps and actions.

import type { ReactNode } from "react";
import { RiPhoneLine } from "@/components/icons";
import { SUPPORT_PHONE } from "@/config/brand-config";
import { cn } from "@/lib/utils";

export type TokenAudience = "customer" | "cleaner" | "partner" | "team";

const POLICY_LINKS: Record<TokenAudience, { href: string; label: string }[]> = {
  customer: [
    { href: "https://novaracleaning.com/terms", label: "Terms" },
    { href: "https://novaracleaning.com/privacy", label: "Privacy" },
    { href: "https://novaracleaning.com/refund-policy", label: "Refunds" },
    { href: "https://novaracleaning.com/cancellation-policy", label: "Cancellations" },
  ],
  partner: [
    { href: "https://novaracleaning.com/terms", label: "Terms" },
    { href: "https://novaracleaning.com/privacy", label: "Privacy" },
  ],
  cleaner: [
    { href: "/hiring/policies/contractor-terms", label: "Contractor terms" },
    { href: "/hiring/policies/applicant-privacy", label: "Privacy" },
    { href: "/hiring/policies/text-messages", label: "Text messages" },
  ],
  team: [],
};

export function TokenFrame({
  label,
  audience = "customer",
  width = "md",
  children,
  className,
  bare = false,
}: {
  /** What the page is, e.g. "Deposit", "Job offer", "Photo report". */
  label?: string;
  audience?: TokenAudience;
  /** Content column width. */
  width?: "sm" | "md" | "lg" | "xl";
  children: ReactNode;
  className?: string;
  /** Frame only (brand bar + background), no padded column. */
  bare?: boolean;
}) {
  const col = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" }[width];
  const links = POLICY_LINKS[audience];
  return (
    <div className="relative min-h-screen bg-[#FAFAFC] font-sans text-[#0B0A11] antialiased">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[280px] bg-gradient-to-b from-[#F3EEFF] to-transparent" />
      <header className="relative z-20 border-b border-[#E9E7EE] bg-white/85 backdrop-blur-md">
        <div className={cn("mx-auto flex h-14 items-center justify-between gap-3 px-4", bare ? "max-w-5xl" : col)}>
          <span className="flex min-w-0 items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/novara-logo.png" alt="" className="h-8 w-8 shrink-0 rounded-[9px]" />
            <span className="whitespace-nowrap text-[14.5px] font-semibold tracking-[-0.02em]">Novara Cleaning</span>
            {label ? (
              <span className="hidden truncate rounded-md bg-[#F3EEFF] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5A1FD6] min-[380px]:inline">
                {label}
              </span>
            ) : null}
          </span>
          {audience !== "team" ? (
            <a
              href={SUPPORT_PHONE.tel}
              aria-label={`Call ${SUPPORT_PHONE.display}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-[9px] border border-[#E9E7EE] bg-white px-2.5 py-1.5 text-[12.5px] font-medium hover:bg-[#F6F5F9]"
            >
              <RiPhoneLine className="h-4 w-4 text-[#6810FE]" />
              <span className="hidden sm:inline">{SUPPORT_PHONE.display}</span>
              <span className="sm:hidden">Help</span>
            </a>
          ) : null}
        </div>
      </header>
      {bare ? (
        <div className={cn("relative z-10", className)}>{children}</div>
      ) : (
        <main className={cn("relative z-10 mx-auto w-full px-4 py-6 sm:py-8", col, className)}>{children}</main>
      )}
      <footer className="relative z-10 mx-auto max-w-5xl px-4 pb-10 pt-4 text-center text-[12px] text-[#5F5B6B]">
        <p>
          Questions? Call <a href={SUPPORT_PHONE.tel} className="font-medium text-[#0B0A11] underline-offset-2 hover:underline">{SUPPORT_PHONE.display}</a> · Novara Cleaning LLC
        </p>
        {links.length ? (
          <p className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
            {links.map((l) => (
              <a key={l.href} href={l.href} className="hover:text-[#0B0A11]">
                {l.label}
              </a>
            ))}
          </p>
        ) : null}
      </footer>
    </div>
  );
}

/** Small "secure and protected" row shown near payment forms. */
export function PaymentTrustRow({ lines }: { lines: string[] }) {
  return (
    <ul className="flex flex-wrap items-center justify-center gap-2">
      {lines.map((l) => (
        <li key={l} className="inline-flex items-center gap-1.5 rounded-full border border-[#E9E7EE] bg-white px-3 py-1 text-[11.5px] font-medium text-[#0B0A11]">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#6810FE]" />
          {l}
        </li>
      ))}
    </ul>
  );
}

// Customer sign-in frame in the landing style: what the account does on the
// left, the form on the right. Staff, cleaner, and admin sign-ins keep
// AuthScaffold; this shell is for customers only.

import type { ReactNode } from "react";
import Link from "next/link";
import { RiArrowLeftLine, RiCheckLine } from "@/components/icons";
import { cn } from "@/lib/utils";

export const authField =
  "block h-12 w-full rounded-[10px] border border-[#E9E7EE] bg-white px-4 text-[15px] text-[#0B0A11] placeholder:text-[#5F5B6B]/70 transition focus:border-[#6810FE]/50 focus:outline-none focus:ring-[3px] focus:ring-[#6810FE]/15 disabled:opacity-60";
export const authLabel = "mb-1.5 block text-[13px] font-medium text-[#0B0A11]";
export const authPrimary =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-[9px] bg-gradient-to-b from-[#7A2BFF] to-[#5A0BE6] px-5 text-[15px] font-medium text-white shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_10px_24px_-10px_rgba(104,16,254,0.75)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6810FE] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
export const authOutline =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-[9px] border border-[#E9E7EE] bg-white px-5 text-[15px] font-medium text-[#0B0A11] transition hover:bg-[#F6F5F9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6810FE] focus-visible:ring-offset-2 disabled:opacity-60";

const ACCOUNT_POINTS = [
  "See your upcoming visits and past cleans",
  "Reschedule or cancel from one place",
  "Use membership credits and pause or resume a plan",
  "Update your password and billing",
];

export function CustomerAuthShell({
  eyebrow = "Your account",
  title,
  lead,
  children,
  footer,
}: {
  eyebrow?: string;
  title: string;
  lead: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="landing flex min-h-screen flex-col bg-white font-sans text-[#0B0A11] antialiased">
      <header className="border-b border-[#E9E7EE] px-5 sm:px-6 lg:px-8">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Novara Cleaning home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/novara-logo.png" alt="" width={34} height={34} className="h-[34px] w-[34px] rounded-[9px]" />
            <span className="text-[16px] font-semibold tracking-[-0.02em]">Novara Cleaning</span>
          </Link>
          <Link href="/" className="inline-flex items-center gap-1.5 text-[14px] text-[#5F5B6B] hover:text-[#0B0A11]">
            <RiArrowLeftLine className="h-4 w-4" aria-hidden="true" />
            Back to the website
          </Link>
        </div>
      </header>

      <main className="relative flex-1 px-5 py-12 sm:px-6 sm:py-20 lg:px-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(55%_60%_at_85%_0%,rgba(104,16,254,0.07),transparent_70%)]"
        />
        <div className="relative mx-auto grid max-w-6xl items-start gap-12 lg:grid-cols-[1fr_minmax(0,440px)] lg:gap-20">
          <div className="hidden lg:block">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5A1FD6]">{eyebrow}</p>
            <h1 className="max-w-lg text-[3.2rem] font-medium leading-[1.04] tracking-[-0.035em]">{title}</h1>
            <p className="mt-5 max-w-md text-[17px] leading-relaxed text-[#5F5B6B]">{lead}</p>
            <ul className="mt-10 max-w-md space-y-3 border-t border-[#E9E7EE] pt-8">
              {ACCOUNT_POINTS.map((p, i) => (
                <li key={p} className="flex gap-3 text-[15px]">
                  <span className="pt-0.5 font-mono text-[13px] text-[#8E5BFF]">{String(i + 1).padStart(2, "0")}</span>
                  <span className="flex gap-2">
                    <RiCheckLine className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#6810FE]" aria-hidden="true" />
                    {p}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="lg:hidden">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5A1FD6]">{eyebrow}</p>
            </div>
            <div className="relative overflow-hidden rounded-2xl border border-[#E9E7EE] bg-white p-6 shadow-[0_0_72px_-28px_rgba(104,16,254,0.5)] sm:p-8">
              <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-[#6810FE]/[0.07] to-transparent" />
              <div className="relative">{children}</div>
            </div>
            {footer ? <div className="mt-6">{footer}</div> : null}
          </div>
        </div>
      </main>

      <footer className="border-t border-[#E9E7EE] bg-[#F6F5F9] px-5 py-6 text-[12.5px] text-[#5F5B6B] sm:px-6 lg:px-8">
        <div className={cn("mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3")}>
          <span>© {new Date().getFullYear()} Novara Cleaning LLC</span>
          <span className="flex flex-wrap gap-4">
            <a href="https://novaracleaning.com/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-[#0B0A11]">
              Privacy
            </a>
            <a href="https://novaracleaning.com/terms" target="_blank" rel="noopener noreferrer" className="hover:text-[#0B0A11]">
              Terms
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}

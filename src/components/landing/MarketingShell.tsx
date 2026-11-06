// Shared frame for every public marketing page: the landing header and footer,
// Inter headings, and an optional phone call / price bar.

import type { ReactNode } from "react";
import Link from "next/link";
import { RiArrowLeftLine } from "@/components/icons";
import { cn } from "@/lib/utils";
import { SiteHeader, StickyMobileBar } from "./Chrome";
import { SiteFooter } from "./Footer";
import { Eyebrow, gutter, shell, subhead } from "./primitives";

export function MarketingShell({ children, mobileBar = true }: { children: ReactNode; mobileBar?: boolean }) {
  return (
    <div className="landing min-h-screen bg-white font-sans text-ink antialiased">
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
      {mobileBar ? <StickyMobileBar /> : null}
    </div>
  );
}

/** Title block for inner pages. Smaller than the landing hero. */
export const pageTitle =
  "text-[2.3rem] font-medium leading-[1.06] tracking-[-0.035em] text-ink sm:text-5xl md:text-[3.4rem] md:leading-[1.04]";

export function PageHero({
  back,
  eyebrow,
  title,
  lead,
  children,
  aside,
}: {
  back?: { href: string; label: string };
  eyebrow?: string;
  title: string;
  lead?: string;
  children?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className={cn(gutter, "relative pb-14 pt-10 sm:pb-20 sm:pt-14")}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(55%_60%_at_85%_0%,rgba(104,16,254,0.07),transparent_70%)]"
      />
      <div className={cn(shell, "relative grid items-start gap-10", aside ? "lg:grid-cols-[1.05fr_0.95fr]" : undefined)}>
        <div>
          {back ? (
            <Link href={back.href} className="mb-8 inline-flex items-center gap-1.5 text-[14px] text-ink-muted hover:text-ink">
              <RiArrowLeftLine className="h-4 w-4" aria-hidden="true" />
              {back.label}
            </Link>
          ) : null}
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <h1 className={cn(pageTitle, "max-w-3xl")}>{title}</h1>
          {lead ? <p className={cn(subhead, "mt-5 max-w-2xl")}>{lead}</p> : null}
          {children}
        </div>
        {aside}
      </div>
    </section>
  );
}

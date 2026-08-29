"use client";

import type { ReactNode } from "react";
import Link from "next/link";

import { BrandAtmosphere } from "@/components/brand/atmosphere";

export function PublicPortalChrome({
  badge,
  children,
  action,
}: {
  badge: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="relative min-h-screen bg-background text-foreground font-sans">
      <BrandAtmosphere />
      <header className="relative z-10 sticky top-0 border-b border-[color:var(--hairline)] bg-background/80 backdrop-blur-xl hairline-glow">
        <div className="container max-w-3xl mx-auto h-14 px-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <img src="/novara-email-logo.png" alt="Novara" className="h-[22px] w-auto" />
            <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-primary bg-brand-50">
              {badge}
            </span>
          </Link>
          {action}
        </div>
      </header>
      <main className="relative z-10 container max-w-3xl mx-auto px-4 py-8 md:py-12">{children}</main>
    </div>
  );
}

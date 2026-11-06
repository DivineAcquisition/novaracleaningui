"use client";

import type { ReactNode } from "react";
import Link from "next/link";


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
    <div className="relative min-h-screen bg-[#FAFAFC] text-foreground font-sans antialiased">
      <header className="relative z-10 sticky top-0 border-b border-[color:var(--hairline)] bg-card/90 backdrop-blur-md">
        <div className="container max-w-3xl mx-auto h-14 px-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <img src="/novara-logo.png" alt="" className="h-8 w-8 rounded-[9px]" />
            <span className="whitespace-nowrap text-[14.5px] font-semibold tracking-[-0.02em] text-foreground">Novara Cleaning</span>
            <span className="rounded-md bg-[#F3EEFF] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[#5A1FD6]">
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

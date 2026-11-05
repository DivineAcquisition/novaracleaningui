"use client";

// Every "get my price" button on the page leads to the same place: the hero
// ZIP card, which starts the booking flow.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { scrollToBooking } from "./PriceExplorer";

export function BookCtaButton({
  children,
  variant = "solid",
  tone = "default",
  className,
}: {
  children: ReactNode;
  variant?: "solid" | "outline";
  tone?: "default" | "inverse";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={scrollToBooking}
      className={cn(
        "inline-flex h-12 items-center justify-center gap-2 rounded-lg px-5 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        tone === "inverse"
          ? "bg-white text-brand-950 hover:bg-white/90 focus-visible:ring-white focus-visible:ring-offset-primary"
          : variant === "outline"
            ? "border border-border bg-background text-foreground hover:border-primary focus-visible:ring-ring"
            : "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </button>
  );
}

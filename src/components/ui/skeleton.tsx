"use client";

import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-lg bg-brand-50", className)}
      role="status"
      aria-label="Loading content"
      {...props}
    />
  );
}

export { Skeleton };

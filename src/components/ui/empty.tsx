import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

function Empty({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col items-center justify-center gap-4 rounded-xl border border-dashed p-8 text-center",
        className,
      )}
      {...props}
    />
  );
}

function EmptyHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex max-w-sm flex-col items-center gap-2", className)} {...props} />;
}

function EmptyMedia({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mb-1 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-5",
        className,
      )}
      {...props}
    />
  );
}

function EmptyTitle({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-sm font-semibold text-foreground", className)} {...props} />;
}

function EmptyDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-xs leading-relaxed text-muted-foreground", className)} {...props} />;
}

function EmptyContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap items-center justify-center gap-2", className)} {...props} />;
}

export { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent };

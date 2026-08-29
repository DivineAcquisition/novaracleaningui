import { cn } from "@/lib/utils";

/** Shared open/close motion for Radix overlays. */
export const POPOVER_MOTION =
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2";

/** Coss-style floating surface — hairline, inner rim, brand shadow. */
export function popoverSurface(className?: string) {
  return cn("popover-surface z-50 overflow-hidden p-1 text-popover-foreground", POPOVER_MOTION, className);
}

export function menuItemClass(className?: string) {
  return cn("menu-item", className);
}

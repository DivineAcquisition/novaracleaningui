import type { ElementType, HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type PanelProps = HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "article" | "li";
};

/**
 * Coss-style content surface. One chrome for admin cards, marketing blocks,
 * and settings panels — the `.panel` class lives in globals.css so utilities
 * on the element still win.
 */
export function Panel({
  as: Component = "div",
  className,
  ...props
}: PanelProps) {
  const Tag = Component as ElementType;
  return <Tag className={cn("panel panel-hover rounded-2xl", className)} {...props} />;
}

"use client";

import {
  useCallback,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { motion, useMotionTemplate, useMotionValue } from "motion/react";

import { MAGIC_SPOTLIGHT } from "@/lib/brand";
import { cn } from "@/lib/utils";

type MagicCardProps = {
  children?: ReactNode;
  className?: string;
  gradientSize?: number;
  gradientColor?: string;
  gradientOpacity?: number;
};

export function MagicCard({
  children,
  className,
  gradientSize = 240,
  gradientColor = MAGIC_SPOTLIGHT,
  gradientOpacity = 0.85,
}: MagicCardProps) {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const hover = useMotionValue(0);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      mouseX.set(event.clientX - rect.left);
      mouseY.set(event.clientY - rect.top);
    },
    [mouseX, mouseY],
  );

  const spotlight = useMotionTemplate`radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px, ${gradientColor}, transparent 68%)`;

  return (
    <div
      className={cn("relative", className)}
      onPointerEnter={() => hover.set(gradientOpacity)}
      onPointerLeave={() => hover.set(0)}
      onPointerMove={onPointerMove}
    >
      {children}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[1] rounded-[inherit]"
        style={{ background: spotlight, opacity: hover }}
      />
    </div>
  );
}

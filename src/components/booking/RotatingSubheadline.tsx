"use client";

import { useEffect, useState } from "react";
import {
  RiFlashlightLine,
  RiPhoneFill,
  RiCalendarCheckLine,
} from "@remixicon/react";

// Three value-prop messages that rotate under the main headline on the
// zip entry page. The order matches the brief — "no call required" is the
// hero message; the other two reinforce the same idea from different
// angles.
const MESSAGES = [
  {
    Icon: RiPhoneFill,
    text: "No call required — book 100% online.",
  },
  {
    Icon: RiFlashlightLine,
    text: "Instant pricing — see your quote in seconds.",
  },
  {
    Icon: RiCalendarCheckLine,
    text: "Next-available slots open as soon as tomorrow.",
  },
] as const;

interface RotatingSubheadlineProps {
  intervalMs?: number;
  className?: string;
}

/**
 * Rotates through three conversion-focused value props under the page
 * headline. Uses our primary purple color, fades between messages, and
 * respects `prefers-reduced-motion`.
 */
export function RotatingSubheadline({
  intervalMs = 3000,
  className = "",
}: RotatingSubheadlineProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % MESSAGES.length),
      prefersReducedMotion ? intervalMs * 2 : intervalMs,
    );
    return () => window.clearInterval(id);
  }, [intervalMs]);

  const { Icon, text } = MESSAGES[index];

  return (
    <div
      className={`flex items-center justify-center gap-2 text-sm md:text-base font-medium text-primary ${className}`}
      aria-live="polite"
      aria-atomic="true"
    >
      <span
        key={index}
        className="inline-flex items-center gap-2 animate-fade-in"
      >
        <Icon className="h-4 w-4 md:h-5 md:w-5 shrink-0" />
        <span>{text}</span>
      </span>
    </div>
  );
}

// Visual building blocks for the landing page: section shell, eyebrow, product
// frame, status chips, and button recipes. Light page, ink text, Novara purple
// for actions and highlights.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const gutter = "px-5 sm:px-6 lg:px-8";
export const shell = "mx-auto max-w-6xl";

export const displayTitle =
  "font-sans text-[2.6rem] font-medium leading-[1.04] tracking-[-0.035em] text-ink sm:text-6xl md:text-[4.1rem] md:leading-[1.02]";
export const sectionTitle =
  "font-sans max-w-3xl text-[1.85rem] font-medium leading-tight tracking-[-0.03em] text-ink sm:text-[2.6rem] sm:leading-[1.1]";
export const lead = "max-w-2xl text-[15px] leading-relaxed text-ink-muted sm:text-base";
export const subhead = "text-[15px] leading-relaxed text-ink-muted sm:text-lg";

export const btnPrimary =
  "inline-flex h-12 items-center justify-center gap-2 rounded-[9px] bg-gradient-to-b from-[#7A2BFF] to-[#5A0BE6] px-5 text-[15px] font-medium text-white shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_10px_24px_-10px_rgba(104,16,254,0.75)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6810FE] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
export const btnOutline =
  "inline-flex h-12 items-center justify-center gap-2 rounded-[9px] border border-line bg-white px-5 text-[15px] font-medium text-ink transition hover:bg-[#F6F5F9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6810FE] focus-visible:ring-offset-2";

export const panel = "rounded-xl border border-line bg-white shadow-[0_16px_40px_-28px_rgba(11,10,17,0.28)]";
export const inset = "rounded-lg border border-line bg-[#F6F5F9]";
export const cardGlow = "shadow-[0_0_72px_-28px_rgba(104,16,254,0.55)]";

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5A1FD6]", className)}>
      {children}
    </p>
  );
}

export function Section({
  id,
  eyebrow,
  headline,
  lead: leadText,
  children,
  center = false,
  className,
}: {
  id?: string;
  eyebrow?: string;
  headline: string;
  lead?: string;
  children: ReactNode;
  center?: boolean;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className={cn(gutter, "scroll-mt-20 border-t border-line py-20 sm:py-28", className)}
    >
      <div className={shell}>
        {eyebrow ? <Eyebrow className={center ? "text-center" : undefined}>{eyebrow}</Eyebrow> : null}
        <h2 id={id ? `${id}-title` : undefined} className={cn(sectionTitle, center && "mx-auto text-center")}>
          {headline}
        </h2>
        {leadText ? <p className={cn(lead, "mt-4", center && "mx-auto text-center")}>{leadText}</p> : null}
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

export type ChipTone = "neutral" | "good" | "warn" | "brand" | "solid";

const CHIP: Record<ChipTone, string> = {
  neutral: "border-line bg-[#F6F5F9] text-ink-muted",
  good: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warn: "border-amber-200 bg-amber-50 text-amber-700",
  brand: "border-[#E3D7FF] bg-[#F3EEFF] text-[#5A1FD6]",
  solid: "border-[#6810FE] bg-[#6810FE] text-white",
};

export function Chip({
  tone = "neutral",
  children,
  className,
  dot = false,
}: {
  tone?: ChipTone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        CHIP[tone],
        className,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/** A product window: traffic-light dots, an optional "sample data" pill, and a soft purple wash. */
export function Frame({
  children,
  label,
  className,
  glow = false,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-line bg-white p-5 sm:p-6", glow ? cardGlow : "shadow-[0_24px_50px_-30px_rgba(11,10,17,0.35)]", className)}>
      {glow ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#6810FE]/[0.10] to-transparent" />
      ) : null}
      <div className="relative">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex gap-1.5" aria-hidden="true">
            <span className="h-2 w-2 rounded-full bg-[#DAD7E2]" />
            <span className="h-2 w-2 rounded-full bg-[#DAD7E2]" />
            <span className="h-2 w-2 rounded-full bg-[#8E5BFF]" />
          </div>
          {label ? <Chip>{label}</Chip> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Number label used on lists and cards: 01, 02 … */
export function Index({ n, className }: { n: number; className?: string }) {
  return <span className={cn("font-mono text-[13px] text-[#8E5BFF]", className)}>{String(n).padStart(2, "0")}</span>;
}

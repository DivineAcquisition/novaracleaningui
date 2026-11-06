// "One team. Every kind of clean." Service cards grouped like an org chart,
// each with its live starting price where one exists. Server-rendered.

import Link from "next/link";
import { RiArrowRightUpLine } from "@/components/icons";
import { SERVICES } from "@/lib/landing/content";
import { startingOnlinePrice, type LandingPrices } from "@/lib/landing/prices";
import { cn } from "@/lib/utils";
import { dollars } from "./format";
import { Chip, Section } from "./primitives";

function fromPrice(prices: LandingPrices, key: "standard" | "deep" | "moveInOut" | "plan" | null): string | null {
  if (!key) return null;
  if (key === "plan") {
    const monthly = prices.bands
      .map((b) => prices.membership[b.id]?.monthly)
      .filter((v): v is number => typeof v === "number" && v > 0);
    return monthly.length ? `from ${dollars(Math.min(...monthly))}/mo` : null;
  }
  const v = startingOnlinePrice(prices, key);
  return v ? `from ${dollars(v)}` : null;
}

export function Services({ prices }: { prices: LandingPrices }) {
  let n = 0;
  return (
    <Section id={SERVICES.id} headline={SERVICES.headline} lead={SERVICES.lead}>
      <div className="grid gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
        {SERVICES.groups.map((group) => (
          <div key={group.id}>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5A1FD6]">{group.label}</p>
            <ul className="space-y-3">
              {group.items.map((item) => {
                n += 1;
                const price = fromPrice(prices, item.priceKey);
                const external = item.href.startsWith("http");
                const first = n === 1;
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className={cn(
                        "group block rounded-2xl border bg-white p-4 transition hover:border-[#C9B6FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6810FE]",
                        first ? "border-[#E3D7FF] shadow-[0_0_60px_-28px_rgba(104,16,254,0.6)]" : "border-line shadow-[0_16px_40px_-32px_rgba(11,10,17,0.35)]",
                      )}
                      {...(external ? { target: "_blank", rel: "noopener" } : {})}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[13px] text-[#8E5BFF]">{String(n).padStart(2, "0")}</span>
                        {price ? <Chip tone={first ? "good" : "neutral"}>{price}</Chip> : <Chip>Quote online</Chip>}
                      </div>
                      <p className="mt-2 flex items-center justify-between gap-2 text-[17px] font-medium tracking-[-0.02em] text-ink">
                        {item.name}
                        <RiArrowRightUpLine className="h-4 w-4 text-ink-muted transition group-hover:text-[#6810FE]" aria-hidden="true" />
                      </p>
                      <p className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">{item.body}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

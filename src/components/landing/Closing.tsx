// Pricing, FAQ, final call to action, and footer. Server-rendered.

import Link from "next/link";
import { RiArrowDownSLine, RiArrowRightLine, RiPhoneLine } from "@/components/icons";
import { INBOUND_PHONE } from "@/config/brand-config";
import { FAQ, FINAL_CTA, PRICING } from "@/lib/landing/content";
import { startingOnlinePrice, type LandingPrices } from "@/lib/landing/prices";
import { cn } from "@/lib/utils";
import { PriceButton } from "./Chrome";
import { dollars } from "./format";
import { Section, btnOutline, gutter, lead, sectionTitle, shell } from "./primitives";

function Includes({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-4 space-y-2 text-[14.5px] leading-relaxed text-ink-muted">
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

export function Pricing({ prices }: { prices: LandingPrices }) {
  const once = startingOnlinePrice(prices, "standard");
  const monthly = prices.bands
    .map((b) => prices.membership[b.id]?.monthly)
    .filter((v): v is number => typeof v === "number" && v > 0);
  const planFrom = monthly.length ? Math.min(...monthly) : 0;
  return (
    <Section id={PRICING.id} headline={PRICING.headline}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="relative overflow-hidden rounded-2xl border border-line bg-white p-6 shadow-[0_0_72px_-28px_rgba(104,16,254,0.55)]">
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-[#6810FE]/[0.08] to-transparent" />
          <div className="relative">
            <h3 className="text-[26px] font-medium tracking-[-0.02em] text-ink">{PRICING.once.name}</h3>
            <p className="mt-2 text-[18px] text-ink">{PRICING.once.priceLabel(dollars(once))}</p>
            <Includes items={PRICING.once.includes} />
            <p className="mt-4 text-[14px] leading-relaxed text-ink-muted">{PRICING.once.note}</p>
            <PriceButton className="mt-6">{PRICING.once.cta}</PriceButton>
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-white p-6 shadow-[0_16px_40px_-30px_rgba(11,10,17,0.35)]">
          <h3 className="text-[26px] font-medium tracking-[-0.02em] text-ink">{PRICING.plan.name}</h3>
          <p className="mt-2 text-[18px] text-ink">{PRICING.plan.priceLabel(dollars(planFrom))}</p>
          <Includes items={PRICING.plan.includes} />
          <p className="mt-4 text-[14px] leading-relaxed text-ink-muted">
            {PRICING.plan.note}
            {prices.firstMonthFeeCents > 0 ? ` The deep clean adds ${dollars(prices.firstMonthFeeCents)} to the first month.` : ""}
          </p>
          <Link href={PRICING.plan.href} className={cn(btnOutline, "mt-6")}>
            {PRICING.plan.cta}
            <RiArrowRightLine className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </Section>
  );
}

export function Faq() {
  return (
    <Section id={FAQ.id} headline={FAQ.headline}>
      <div className="mx-auto max-w-3xl rounded-2xl border border-line bg-white px-6 shadow-[0_16px_40px_-32px_rgba(11,10,17,0.3)] sm:px-8">
        {FAQ.items.map((item) => (
          <details key={item.q} className="group border-b border-line last:border-b-0 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[16px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6810FE]">
              {item.q}
              <RiArrowDownSLine className="h-5 w-5 flex-shrink-0 text-ink-muted transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <p className="-mt-1 pb-5 text-[14.5px] leading-relaxed text-ink-muted">{item.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

export function faqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}

export function FinalCta() {
  return (
    <section className={cn(gutter, "border-t border-line py-20 sm:py-28")}>
      <div className={shell}>
        <div className="relative mx-auto max-w-3xl overflow-hidden rounded-2xl border border-line bg-white p-8 text-center shadow-[0_0_80px_-28px_rgba(104,16,254,0.55)] sm:p-12">
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#6810FE]/[0.10] to-transparent" />
          <div className="relative">
            <h2 className={cn(sectionTitle, "mx-auto text-center")}>{FINAL_CTA.headline}</h2>
            <p className={cn(lead, "mx-auto mt-4 text-center")}>{FINAL_CTA.body}</p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <PriceButton>{FINAL_CTA.primary}</PriceButton>
              <a href={INBOUND_PHONE.tel} className={btnOutline}>
                <RiPhoneLine className="h-4 w-4 text-[#6810FE]" aria-hidden="true" />
                {FINAL_CTA.secondary} {INBOUND_PHONE.display}
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export { SiteFooter } from "./Footer";

// Public landing page (try.novaracleaning.com).
//
// Server component. Copy lives in src/lib/landing/content.ts; live numbers come
// from getLandingData() (src/lib/landing/data.ts). Interactive pieces are small
// client islands under src/components/landing.

import { INBOUND_PHONE } from "@/config/brand-config";
import { AgentFlow } from "@/components/landing/AgentFlow";
import { SiteHeader, StickyMobileBar } from "@/components/landing/Chrome";
import { FinalCta, Faq, Pricing, SiteFooter, faqJsonLd } from "@/components/landing/Closing";
import { dollars } from "@/components/landing/format";
import { HeroBookingCard } from "@/components/landing/HeroBookingCard";
import { Hosts } from "@/components/landing/Hosts";
import { HowRun } from "@/components/landing/HowRun";
import { NovaSection } from "@/components/landing/NovaSection";
import { Problem, Standard } from "@/components/landing/Story";
import { Promises } from "@/components/landing/Promises";
import { QuoteReport } from "@/components/landing/QuoteReport";
import { QuoteStudio } from "@/components/landing/QuoteStudio";
import { Services } from "@/components/landing/Services";
import { Eyebrow, displayTitle, gutter, shell, subhead } from "@/components/landing/primitives";
import { HERO } from "@/lib/landing/content";
import { type LandingData, startingPrice, visibleProof } from "@/lib/landing/data";
import { cn } from "@/lib/utils";

export default function IndexPage({ data }: { data: LandingData }) {
  const { prices, stats } = data;
  const band = prices.bands.find((b) => b.id === "1000_1500") || prices.bands[0];
  const deep = band ? prices.base[band.id]?.deep || startingPrice(prices, "deep") : startingPrice(prices, "deep");
  const oven = prices.addOns.find((a) => a.id === "oven");
  const proof = visibleProof(stats);

  return (
    <div className="landing min-h-screen bg-white font-sans text-ink antialiased">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd()) }} />
      <SiteHeader />

      <main id="main">
        {/* Hero */}
        <section className={cn(gutter, "relative pb-16 pt-12 sm:pb-24 sm:pt-20")}>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_60%_at_80%_0%,rgba(104,16,254,0.07),transparent_70%)]"
          />
          <div className={cn(shell, "relative grid items-start gap-12 lg:grid-cols-[1.05fr_0.95fr]")}>
            <div>
              <Eyebrow>{HERO.eyebrow}</Eyebrow>
              <h1 className={displayTitle}>{HERO.headline}</h1>
              <p className={cn(subhead, "mt-6 max-w-xl")}>{HERO.supporting}</p>
              <div className="mt-8">
                <HeroBookingCard />
              </div>
              <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-ink-muted">{HERO.trust}</p>
              <p className="mt-3 text-[14px] text-ink-muted">
                Rather talk?{" "}
                <a href="#nova" className="font-medium text-ink underline-offset-4 hover:underline">
                  {HERO.secondaryCta}
                </a>{" "}
                or call{" "}
                <a href={INBOUND_PHONE.tel} className="font-medium text-ink underline-offset-4 hover:underline">
                  {INBOUND_PHONE.display}
                </a>
                .
              </p>
              {proof.rating || proof.completedCleans ? (
                <p className="mt-6 flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-5 text-[14px] text-ink">
                  {proof.rating ? (
                    <span>
                      {proof.rating.average.toFixed(1)} average from {proof.rating.count} post-visit ratings
                    </span>
                  ) : null}
                  {proof.completedCleans ? <span>{proof.completedCleans.toLocaleString("en-US")} cleans completed</span> : null}
                </p>
              ) : null}
            </div>
            {band ? <QuoteStudio baseCents={deep} extraCents={oven?.cents || 0} /> : null}
          </div>
        </section>

        <AgentFlow />
        <Problem />
        <Standard />
        <HowRun />
        <NovaSection deep={dollars(deep)} bandLabel={band?.label || ""} oven={oven ? dollars(oven.cents) : null} />
        <QuoteReport prices={prices} />
        <Services prices={prices} />
        <Hosts />
        <Promises />
        <Pricing prices={prices} />
        <Faq />
        <FinalCta />
      </main>

      <SiteFooter />
      <StickyMobileBar />
    </div>
  );
}

// Public landing page (try.novaracleaning.com).
//
// Server component. Numbers come from getLandingData() (src/lib/landing/data.ts):
// prices from the active pricing config, proof numbers from completed jobs and
// post-visit ratings, shown only once they clear their thresholds.
// Interactive pieces are small client islands under src/components/landing.

import Link from "next/link";
import { RiPhoneLine, RiSparklingLine } from "@remixicon/react";
import { BookingFooter } from "@/components/booking/BookingFooter";
import { AfterYouBook } from "@/components/landing/AfterYouBook";
import { dollars } from "@/components/landing/format";
import { HeroBookingCard } from "@/components/landing/HeroBookingCard";
import { HostsSection } from "@/components/landing/HostsSection";
import { NovaVoice } from "@/components/landing/NovaVoice";
import { PriceExplorer } from "@/components/landing/PriceExplorer";
import { Faq, FinalCta, Guarantee, Plans, ProofStrip, faqJsonLd } from "@/components/landing/Sections";
import { StickyMobileBar } from "@/components/landing/StickyMobileBar";
import { WhatsIncluded } from "@/components/landing/WhatsIncluded";
import { INBOUND_PHONE } from "@/config/brand-config";
import { startingPrice, type LandingData } from "@/lib/landing/data";

function SectionHeading({ eyebrow, title, body, id }: { eyebrow: string; title: string; body?: string; id: string }) {
  return (
    <div className="mb-8 max-w-2xl space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-primary">{eyebrow}</p>
      <h2 id={id} className="font-heading text-3xl font-bold leading-tight text-foreground md:text-4xl [text-wrap:balance]">
        {title}
      </h2>
      {body && <p className="text-muted-foreground">{body}</p>}
    </div>
  );
}

export default function IndexPage({ data }: { data: LandingData }) {
  const { prices, stats } = data;
  const standardFrom = startingPrice(prices, "standard");
  const deepFrom = startingPrice(prices, "deep");
  const sampleBand = prices.bands.find((b) => b.id === "1000_1500") || prices.bands[0];
  const sampleDeep = sampleBand ? prices.base[sampleBand.id]?.deep || deepFrom : deepFrom;
  const oven = prices.addOns.find((a) => a.id === "oven");

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd()) }}
      />

      {/* Offer bar */}
      <div className="bg-brand-950 px-4 py-2 text-center text-sm text-white">
        <RiSparklingLine className="mr-1.5 inline h-4 w-4 -translate-y-px text-brand-300" aria-hidden="true" />
        New customers: <strong>15% off</strong> a standard clean, <strong>25% off</strong> a deep clean.
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Novara Cleaning home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/novara-logo.png" alt="" width={36} height={36} className="h-9 w-9 rounded-xl" />
            <span className="font-heading text-lg font-bold tracking-tight text-foreground">
              Novara<span className="text-primary">Cleaning</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-4" aria-label="Main">
            <a href="#pricing" className="hidden px-2 py-2 text-sm text-muted-foreground hover:text-foreground md:inline">
              Pricing
            </a>
            <a href="#included" className="hidden px-2 py-2 text-sm text-muted-foreground hover:text-foreground md:inline">
              What&rsquo;s included
            </a>
            <Link href="/str" className="hidden px-2 py-2 text-sm text-muted-foreground hover:text-foreground md:inline">
              Airbnb hosts
            </Link>
            <a
              href={INBOUND_PHONE.tel}
              className="hidden items-center gap-1.5 px-2 py-2 text-sm font-medium text-foreground sm:inline-flex"
            >
              <RiPhoneLine className="h-4 w-4 text-primary" aria-hidden="true" />
              {INBOUND_PHONE.display}
            </a>
            <Link
              href="/auth"
              className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:border-primary"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-border/60">
          <div
            className="pointer-events-none absolute inset-0 [background-image:radial-gradient(rgba(104,16,254,0.14)_1px,transparent_1.4px)] [background-size:18px_18px] [mask-image:radial-gradient(70%_80%_at_30%_30%,#000_20%,transparent_75%)]"
            aria-hidden="true"
          />
          <div className="relative mx-auto grid max-w-6xl gap-x-10 gap-y-6 px-4 py-10 md:py-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <h1 className="font-heading text-[2.35rem] font-extrabold leading-[1.08] tracking-tight text-foreground md:text-5xl lg:col-start-1 lg:row-start-1 lg:self-end lg:text-6xl [text-wrap:balance]">
              A spotless home, with your exact price before you book.
            </h1>
            <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
              <HeroBookingCard />
            </div>
            <div className="space-y-6 lg:col-start-1 lg:row-start-2 lg:self-start">
              <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
                House cleaning across Maryland, DC and Northern Virginia. Every visit follows a written checklist, and
                if anything&rsquo;s missed we re-clean it free within 48 hours.
              </p>
              <dl className="flex flex-wrap gap-x-8 gap-y-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Standard clean</dt>
                  <dd className="font-heading text-2xl font-bold text-foreground">from {dollars(standardFrom)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Deep clean</dt>
                  <dd className="font-heading text-2xl font-bold text-foreground">from {dollars(deepFrom)}</dd>
                </div>
              </dl>
              <p className="text-sm text-muted-foreground">
                Rather talk?{" "}
                <a href={INBOUND_PHONE.tel} className="font-semibold text-foreground underline-offset-2 hover:underline">
                  Call {INBOUND_PHONE.display}
                </a>
                . Nova, our AI assistant, answers 24/7.
              </p>
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-6xl space-y-20 px-4 py-14 md:space-y-28 md:py-20">
          <ProofStrip stats={stats} />

          <section id="pricing" aria-labelledby="pricing-h" className="scroll-mt-24">
            <SectionHeading
              id="pricing-h"
              eyebrow="Pricing"
              title="See what your clean costs, line by line."
              body="These are the starting prices our booking system uses. Pick your home size and type of clean."
            />
            <PriceExplorer prices={prices} />
          </section>

          <section aria-labelledby="nova-h">
            <SectionHeading
              id="nova-h"
              eyebrow="Answered day and night"
              title="Call any time. Nova picks up."
              body="Nova is our AI assistant. It quotes your home, answers questions about what's included, and books your visit, even at 11 PM."
            />
            {sampleBand && (
              <NovaVoice
                deepStartingPrice={dollars(sampleDeep)}
                bandLabel={sampleBand.label}
                ovenPrice={oven ? dollars(oven.cents) : null}
              />
            )}
          </section>

          <section aria-labelledby="after-h" className="grid gap-10 md:grid-cols-[0.9fr_1.1fr]">
            <SectionHeading
              id="after-h"
              eyebrow="How it works"
              title="What happens after you book."
              body="Pricing, scheduling and cleaner matching run automatically, so you're booked in minutes and always know what's next."
            />
            <AfterYouBook />
          </section>

          <section id="included" aria-labelledby="included-h" className="scroll-mt-24">
            <SectionHeading
              id="included-h"
              eyebrow="What's included"
              title="The checklist your cleaner works from."
            />
            <WhatsIncluded />
          </section>

          <section aria-label="Airbnb and short-term rental hosts">
            <HostsSection />
          </section>

          <section aria-labelledby="plans-h">
            <SectionHeading id="plans-h" eyebrow="Plans" title="Book once, or keep it clean every two weeks." />
            <Plans prices={prices} />
          </section>

          <section aria-label="Re-clean guarantee">
            <Guarantee />
          </section>

          <section aria-labelledby="faq-h" className="grid gap-8 md:grid-cols-[0.8fr_1.2fr]">
            <SectionHeading id="faq-h" eyebrow="Questions" title="Good to know before you book." />
            <Faq />
          </section>

          <FinalCta standardFrom={standardFrom} />
        </div>
      </main>

      <BookingFooter clearMobileBar />
      <StickyMobileBar />
    </div>
  );
}

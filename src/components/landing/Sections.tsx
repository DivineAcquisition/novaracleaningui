// Server-rendered landing sections. Every number here is passed in from
// getLandingData(); plan benefits match src/views/Membership.tsx and the
// policies match the receptionist knowledge base.

import Link from "next/link";
import {
  RiArrowRightLine,
  RiCalendarCheckLine,
  RiCheckLine,
  RiPhoneLine,
  RiPriceTag3Line,
  RiRefreshLine,
  RiStarFill,
  RiUserHeartLine,
} from "@remixicon/react";
import { INBOUND_PHONE } from "@/config/brand-config";
import type { LandingPrices, LandingStats } from "@/lib/landing/data";
import { visibleProof } from "@/lib/landing/data";
import { dollars } from "./format";
import { BookCtaButton } from "./BookCtaButton";

// ─── Proof strip ────────────────────────────────────────────────────────────

export function ProofStrip({ stats }: { stats: LandingStats | null }) {
  const proof = visibleProof(stats);
  const items: Array<{ icon: typeof RiCheckLine; title: string; body: string }> = [];
  if (proof.rating) {
    items.push({
      icon: RiStarFill,
      title: `${proof.rating.average.toFixed(1)} average rating`,
      body: `From ${proof.rating.count} post-visit ratings`,
    });
  }
  if (proof.completedCleans) {
    items.push({
      icon: RiCheckLine,
      title: `${proof.completedCleans.toLocaleString("en-US")} cleans completed`,
      body: "Across Maryland, DC and Virginia",
    });
  }
  items.push(
    { icon: RiPriceTag3Line, title: "Exact price up front", body: "Before you pay, no surprises" },
    { icon: RiPhoneLine, title: "Answered 24/7", body: "Nova picks up day and night" },
    { icon: RiRefreshLine, title: "48-hour re-clean", body: "Anything missed, fixed free" },
    { icon: RiUserHeartLine, title: "Your own cleaner", body: "On bi-weekly and weekly plans" },
  );
  return (
    <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-4">
      {items.slice(0, 4).map((item) => (
        <li key={item.title} className="flex items-start gap-3 bg-card p-4 md:p-5">
          <item.icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="font-semibold leading-tight text-foreground">{item.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground md:text-sm">{item.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Plans ──────────────────────────────────────────────────────────────────

export function Plans({ prices }: { prices: LandingPrices }) {
  const band = prices.bands.find((b) => b.id === "1000_1500") || prices.bands[0];
  if (!band) return null;
  const once = prices.base[band.id]?.standard || 0;
  const biweekly = prices.membership[band.id]?.biweekly;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6">
          <div>
            <p className="font-heading text-lg font-bold text-foreground">One-time clean</p>
            <p className="text-sm text-muted-foreground">Book a single visit, any time.</p>
          </div>
          <p className="font-heading text-4xl font-extrabold tabular-nums text-foreground">
            {dollars(once)}
            <span className="ml-1 text-sm font-medium text-muted-foreground">per visit</span>
          </p>
          <ul className="space-y-2 text-sm">
            {["No commitment", "48-hour re-clean guarantee", "New customers: 15% off a standard clean"].map((f) => (
              <li key={f} className="flex gap-2">
                <RiCheckLine className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" aria-hidden="true" />
                {f}
              </li>
            ))}
          </ul>
          <BookCtaButton variant="outline" className="mt-auto">Book one clean</BookCtaButton>
        </div>

        {biweekly != null && (
          <div className="relative flex flex-col gap-4 rounded-2xl border-2 border-primary bg-card p-6">
            <span className="absolute -top-3 left-5 rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground">
              Most popular
            </span>
            <div>
              <p className="font-heading text-lg font-bold text-foreground">Glow Bi-Weekly membership</p>
              <p className="text-sm text-muted-foreground">Two cleans a month with your own cleaner.</p>
            </div>
            <p className="font-heading text-4xl font-extrabold tabular-nums text-foreground">
              {dollars(biweekly)}
              <span className="ml-1 text-sm font-medium text-muted-foreground">per month</span>
            </p>
            <ul className="space-y-2 text-sm">
              {[
                "2 cleans a month, up to 3 hours each",
                "Dedicated cleaner match",
                "25% off deep cleans and add-ons",
                "Free rescheduling, pause when you need to",
              ].map((f) => (
                <li key={f} className="flex gap-2">
                  <RiCheckLine className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" aria-hidden="true" />
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/membership"
              className="mt-auto inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              See membership plans
              <RiArrowRightLine className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Prices shown for a {band.label} home before your ZIP code and home condition.
        {prices.firstMonthFeeCents > 0 &&
          ` Memberships start with a deep clean in the first month (${dollars(prices.firstMonthFeeCents)}).`}
      </p>
    </div>
  );
}

// ─── Guarantee ──────────────────────────────────────────────────────────────

export function Guarantee() {
  return (
    <div className="grid items-center gap-8 rounded-3xl border border-border bg-card p-6 md:grid-cols-[auto_1fr] md:p-10">
      <svg viewBox="0 0 120 120" className="mx-auto h-32 w-32 md:h-40 md:w-40" role="img" aria-label="48-hour re-clean guarantee">
        <defs>
          <path id="seal-circle" d="M60,60 m-44,0 a44,44 0 1,1 88,0 a44,44 0 1,1 -88,0" />
        </defs>
        <circle cx="60" cy="60" r="57" fill="#16043F" />
        <circle cx="60" cy="60" r="34" fill="#6810FE" />
        <text fontSize="9.2" fontWeight="600" fill="#CFC6EE" letterSpacing="2.1" fontFamily="var(--font-inter), Inter, sans-serif">
          <textPath href="#seal-circle">RE-CLEAN GUARANTEE · FREE · NO FORMS ·</textPath>
        </text>
        <text x="60" y="63" textAnchor="middle" fontSize="27" fontWeight="800" fill="#fff" fontFamily="var(--font-jakarta), sans-serif">48</text>
        <text x="60" y="77" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff" fontFamily="var(--font-inter), Inter, sans-serif">HOURS</text>
      </svg>
      <div className="space-y-3">
        <h2 className="font-heading text-3xl font-bold text-foreground md:text-4xl">
          If something&rsquo;s missed, we come back. Free.
        </h2>
        <p className="max-w-xl text-muted-foreground">
          Tell us within 48 hours of your clean and we&rsquo;ll send a cleaner back to re-clean those areas at no
          charge. Reply to your visit text, or call us.
        </p>
      </div>
    </div>
  );
}

// ─── FAQ ────────────────────────────────────────────────────────────────────

export const FAQS: Array<{ q: string; a: string }> = [
  {
    q: "How is my price calculated?",
    a: "Your price comes from your home's size, the type of clean, your ZIP code, and the condition your home is in. You see the exact total before you pay.",
  },
  {
    q: "Do I need to be home?",
    a: "No. Many customers leave a door code or a key. You'll get text updates about your visit.",
  },
  {
    q: "Is Nova a real person?",
    a: "No. Nova is our AI assistant. It answers calls day and night and can quote and book. If you ask for a person, our team follows up with you.",
  },
  {
    q: "What if something gets missed?",
    a: "Tell us within 48 hours and we'll come back to re-clean it free.",
  },
  {
    q: "What's your cancellation policy?",
    a: "Cancel more than 24 hours before your visit for a full refund. Inside 24 hours there's a $50 short-notice fee.",
  },
  {
    q: "Which areas do you serve?",
    a: "Homes across Maryland, Washington DC and Northern Virginia. Enter your ZIP code to check yours.",
  },
];

export function Faq() {
  return (
    <div className="divide-y divide-border rounded-2xl border border-border bg-card">
      {FAQS.map((item) => (
        <details key={item.q} className="group px-5 py-1 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {item.q}
            <span className="text-xl leading-none text-primary transition-transform group-open:rotate-45" aria-hidden="true">
              +
            </span>
          </summary>
          <p className="pb-4 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
        </details>
      ))}
    </div>
  );
}

export function faqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

// ─── Final CTA ──────────────────────────────────────────────────────────────

export function FinalCta({ standardFrom }: { standardFrom: number }) {
  return (
    <div className="flex flex-col items-start justify-between gap-6 rounded-3xl bg-primary p-6 text-primary-foreground md:flex-row md:items-center md:p-10">
      <div className="space-y-2">
        <h2 className="font-heading text-3xl font-bold md:text-4xl">Get your exact price in a minute.</h2>
        <p className="text-primary-foreground/85">
          Standard cleans from {dollars(standardFrom)}. Or call Nova at {INBOUND_PHONE.display}.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <BookCtaButton tone="inverse">
          <RiCalendarCheckLine className="h-5 w-5" aria-hidden="true" />
          Get my price
        </BookCtaButton>
        <a
          href={INBOUND_PHONE.tel}
          className="inline-flex h-12 items-center gap-2 rounded-lg border border-white/40 px-5 font-semibold text-white hover:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <RiPhoneLine className="h-5 w-5" aria-hidden="true" />
          Call
        </a>
      </div>
    </div>
  );
}

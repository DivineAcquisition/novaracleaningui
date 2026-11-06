"use client";

// One membership plan (/membership/[planId]). Pick a home size to see the
// monthly price checkout will charge, then continue into the booking flow
// with ?membership=<plan>&homeSize=<band>, exactly as before.

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { RiArrowRightLine, RiArrowRightUpLine, RiCheckLine } from "@/components/icons";
import { HOME_SIZES } from "@/config/brand-config";
import { MarketingShell, PageHero } from "@/components/landing/MarketingShell";
import { Chip, Index, Section, btnOutline, btnPrimary } from "@/components/landing/primitives";
import { MEMBERSHIP_COPY, PLANS, PLAN_ORDER, planFrom, planPrice, type PlanId } from "@/lib/landing/membership";
import { cn } from "@/lib/utils";

export default function PlanDetail() {
  const { planId } = useParams<{ planId: string }>();
  const router = useRouter();
  const [homeSize, setHomeSize] = useState("1501_2000");

  const id = planId as PlanId;
  const plan = PLANS[id];
  if (!plan) {
    return (
      <MarketingShell mobileBar={false}>
        <PageHero
          back={{ href: "/membership", label: "All plans" }}
          title="We couldn't find that plan."
          lead="Pick one of the three membership plans."
        >
          <Link href="/membership" className={cn(btnPrimary, "mt-8")}>
            See all plans
          </Link>
        </PageHero>
      </MarketingShell>
    );
  }

  const sizes = HOME_SIZES.filter((s) => s.basePrice > 0 && planPrice(id, s.id) > 0);
  const price = planPrice(id, homeSize);
  const selected = sizes.find((s) => s.id === homeSize);
  const others = PLAN_ORDER.filter((p) => p !== id);
  const fee = MEMBERSHIP_COPY.firstMonthFee;

  const handleContinue = () => {
    const params = new URLSearchParams({ membership: id, homeSize });
    router.push(`/book/zip?${params.toString()}`);
  };

  return (
    <MarketingShell mobileBar={false}>
      <PageHero
        back={{ href: "/membership", label: "All plans" }}
        eyebrow={`Membership · ${plan.cadence}`}
        title={`${plan.name}.`}
        lead={plan.tagline}
        aside={
          <div className="relative overflow-hidden rounded-2xl border border-line bg-white p-5 shadow-[0_0_72px_-28px_rgba(104,16,254,0.55)] sm:p-6">
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-[#6810FE]/[0.08] to-transparent" />
            <div className="relative">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5A1FD6]">Your monthly price</p>
                {plan.popular ? <Chip tone="good" dot>Most popular</Chip> : null}
              </div>
              <fieldset className="mt-4">
                <legend className="mb-2 text-[12px] font-medium text-ink-muted">Home size</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {sizes.map((s) => (
                    <label key={s.id} className="cursor-pointer">
                      <input
                        type="radio"
                        name="home-size"
                        value={s.id}
                        checked={homeSize === s.id}
                        onChange={() => setHomeSize(s.id)}
                        className="peer sr-only"
                      />
                      <span className="block rounded-lg border border-line bg-white px-2.5 py-2 transition peer-checked:border-[#C9B6FF] peer-checked:bg-[#F7F4FF] peer-focus-visible:ring-2 peer-focus-visible:ring-[#6810FE]">
                        <span className="block text-[12.5px] font-medium text-ink">{s.sqftRange} sq ft</span>
                        <span className="block text-[11.5px] text-ink-muted">
                          {s.bedrooms} BR · ${planPrice(id, s.id)}/mo
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <ul className="mt-5 divide-y divide-dashed divide-line border-t border-line text-[14px]">
                <li className="flex justify-between py-2.5">
                  <span className="text-ink">
                    {plan.name}
                    {selected ? ` · ${selected.sqftRange} sq ft` : ""}
                  </span>
                  <span className="font-medium tabular-nums text-ink">${price}/mo</span>
                </li>
                <li className="flex justify-between py-2.5 text-ink-muted">
                  <span>First-month deep clean</span>
                  <span className="tabular-nums">+${fee} once</span>
                </li>
              </ul>
              <div className="mt-2 flex items-end justify-between border-t border-ink pt-3">
                <span className="text-[13px] text-ink-muted">First month</span>
                <span className="text-[30px] font-medium tracking-[-0.03em] tabular-nums text-ink">${price + fee}</span>
              </div>
              <button type="button" onClick={handleContinue} className={cn(btnPrimary, "mt-5 w-full")}>
                Continue at ${price}/mo
                <RiArrowRightLine className="h-4 w-4" aria-hidden="true" />
              </button>
              <p className="mt-3 text-[12.5px] text-ink-muted">
                Then ${price} a month. Cancel with 14 days&rsquo; notice before your next billing date.
              </p>
            </div>
          </div>
        }
      >
        <ul className="mt-8 space-y-2.5">
          {plan.benefits.map((b) => (
            <li key={b} className="flex gap-3 text-[15px] text-ink">
              <RiCheckLine className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#6810FE]" aria-hidden="true" />
              {b}
            </li>
          ))}
        </ul>
        <Link href="/checklist/recurring" className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-medium text-[#5A1FD6] hover:underline">
          See what every visit includes
          <RiArrowRightUpLine className="h-4 w-4" aria-hidden="true" />
        </Link>
      </PageHero>

      <Section id="how" headline={MEMBERSHIP_COPY.howHeadline} lead={MEMBERSHIP_COPY.howLead}>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {MEMBERSHIP_COPY.steps.map((s, i) => (
            <li key={s.title} className="rounded-2xl border border-line bg-white p-4 shadow-[0_16px_40px_-32px_rgba(11,10,17,0.35)]">
              <Index n={i + 1} />
              <h3 className="mt-2 text-[17px] font-medium tracking-[-0.02em] text-ink">{s.title}</h3>
              <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="terms" headline="The terms, in plain words.">
        <ul className="grid gap-3 sm:grid-cols-2">
          {MEMBERSHIP_COPY.terms.map((t) => (
            <li key={t} className="rounded-xl border border-line bg-white p-4 text-[14.5px] leading-relaxed text-ink shadow-[0_16px_40px_-32px_rgba(11,10,17,0.35)]">
              {t}
            </li>
          ))}
        </ul>
        <a
          href={MEMBERSHIP_COPY.termsLink.href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-medium text-[#5A1FD6] hover:underline"
        >
          {MEMBERSHIP_COPY.termsLink.label}
          <RiArrowRightUpLine className="h-4 w-4" aria-hidden="true" />
        </a>

        <div className="mt-14">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5A1FD6]">Other plans</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {others.map((o) => (
              <li key={o}>
                <Link
                  href={`/membership/${o}`}
                  className="group flex items-center justify-between rounded-2xl border border-line bg-white p-4 shadow-[0_16px_40px_-32px_rgba(11,10,17,0.35)] hover:border-[#C9B6FF]"
                >
                  <span>
                    <span className="block text-[16px] font-medium tracking-[-0.02em] text-ink">{PLANS[o].name}</span>
                    <span className="block text-[13.5px] text-ink-muted">
                      {PLANS[o].cadence} · from ${planFrom(o)}/mo
                    </span>
                  </span>
                  <RiArrowRightUpLine className="h-4 w-4 text-ink-muted group-hover:text-[#6810FE]" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          <Link href={MEMBERSHIP_COPY.oneTime.href} className={cn(btnOutline, "mt-6")}>
            {MEMBERSHIP_COPY.oneTime.link}
          </Link>
        </div>
      </Section>
    </MarketingShell>
  );
}

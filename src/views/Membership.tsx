"use client";

// Membership plans (/membership). Logged-out visitors get the marketing page;
// signed-in customers see the same plans inside their account, with their
// subscription status and pause / resume at the top.

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { RiArrowRightLine, RiArrowRightUpLine, RiCheckLine, RiPauseCircleLine, RiPlayCircleLine } from "@/components/icons";
import { useAuth } from "@/contexts/AuthContext";
import { PauseResumeDialog } from "@/components/membership/PauseResumeDialog";
import { MarketingShell, PageHero } from "@/components/landing/MarketingShell";
import { Chip, Index, Section, btnOutline, btnPrimary } from "@/components/landing/primitives";
import { MEMBERSHIP_COPY, PLANS, PLAN_ORDER, planFrom } from "@/lib/landing/membership";
import { cn } from "@/lib/utils";

function PlanCards() {
  return (
    <ul className="grid gap-4 lg:grid-cols-3">
      {PLAN_ORDER.map((id, i) => {
        const plan = PLANS[id];
        return (
          <li key={id}>
            <Link
              href={`/membership/${id}`}
              className={cn(
                "group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-white p-6 transition hover:border-[#C9B6FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6810FE]",
                plan.popular ? "border-[#E3D7FF] shadow-[0_0_72px_-28px_rgba(104,16,254,0.6)]" : "border-line shadow-[0_16px_40px_-30px_rgba(11,10,17,0.35)]",
              )}
            >
              {plan.popular ? (
                <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-[#6810FE]/[0.08] to-transparent" />
              ) : null}
              <div className="relative flex items-center justify-between">
                <Index n={i + 1} />
                {plan.popular ? <Chip tone="good" dot>Most popular</Chip> : <Chip>{plan.cadence}</Chip>}
              </div>
              <h2 className="relative mt-3 flex items-center justify-between text-[24px] font-medium tracking-[-0.02em] text-ink">
                {plan.name}
                <RiArrowRightUpLine className="h-5 w-5 text-ink-muted transition group-hover:text-[#6810FE]" aria-hidden="true" />
              </h2>
              <p className="relative mt-1 text-[14.5px] leading-relaxed text-ink-muted">{plan.tagline}</p>
              <p className="relative mt-5 text-[18px] text-ink">
                From <span className="text-[34px] font-medium tracking-[-0.03em]">${planFrom(id)}</span>
                <span className="text-ink-muted"> per month</span>
              </p>
              <ul className="relative mt-5 flex-1 space-y-2 border-t border-line pt-5">
                {plan.benefits.map((b) => (
                  <li key={b} className="flex gap-2.5 text-[14px] text-ink">
                    <RiCheckLine className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#6810FE]" aria-hidden="true" />
                    {b}
                  </li>
                ))}
              </ul>
              <span className={cn(plan.popular ? btnPrimary : btnOutline, "relative mt-6 w-full")}>
                See prices for your home
                <RiArrowRightLine className="h-4 w-4" aria-hidden="true" />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Compare() {
  const rows: Array<{ label: string; values: string[] }> = [
    { label: "Cleans a month", values: PLAN_ORDER.map((id) => String(PLANS[id].credits)) },
    { label: "Time per clean", values: PLAN_ORDER.map((id) => PLANS[id].hours) },
    { label: "Discount", values: PLAN_ORDER.map((id) => PLANS[id].discount) },
    { label: "Dedicated cleaner", values: ["No", "Yes", "Yes, plus your time slot"] },
    { label: "Starting price", values: PLAN_ORDER.map((id) => `$${planFrom(id)}/mo`) },
  ];
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-white shadow-[0_16px_40px_-32px_rgba(11,10,17,0.35)]">
      <table className="w-full min-w-[620px] text-left text-[14px]">
        <thead>
          <tr className="border-b border-line bg-[#FAFAFC]">
            <th scope="col" className="px-5 py-3.5 font-medium text-ink-muted">
              <span className="sr-only">Feature</span>
            </th>
            {PLAN_ORDER.map((id) => (
              <th key={id} scope="col" className="px-5 py-3.5 font-medium text-ink">
                {PLANS[id].name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-line last:border-b-0">
              <th scope="row" className="px-5 py-3.5 font-normal text-ink-muted">
                {r.label}
              </th>
              {r.values.map((v, i) => (
                <td key={i} className={cn("px-5 py-3.5 text-ink", i === 1 && "bg-[#F7F4FF]")}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SubscriptionStatus({ onManage }: { onManage: () => void }) {
  const { subscription } = useAuth();
  if (!subscription?.subscribed) return null;
  const paused = subscription.is_paused;
  return (
    <div
      className={cn(
        "mb-8 flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between",
        paused ? "border-amber-200 bg-amber-50/70" : "border-emerald-200 bg-emerald-50/60",
      )}
    >
      <div>
        <p className="flex items-center gap-2 text-[16px] font-medium text-ink">
          <Chip tone={paused ? "warn" : "good"} dot>
            {paused ? "Paused" : "Active"}
          </Chip>
          {paused ? "Your membership is paused." : "You have an active membership."}
        </p>
        <p className="mt-1 text-[14px] text-ink-muted">
          {paused
            ? `While paused you are not charged and no cleans are issued.${
                subscription.resumes_at ? ` Resumes ${new Date(subscription.resumes_at).toLocaleDateString()}.` : ""
              }`
            : "Pause any time from here. Your cleaner and schedule are kept."}
        </p>
      </div>
      <button type="button" onClick={onManage} className={cn(paused ? btnPrimary : btnOutline, "h-11")}>
        {paused ? <RiPlayCircleLine className="h-4 w-4" aria-hidden="true" /> : <RiPauseCircleLine className="h-4 w-4" aria-hidden="true" />}
        {paused ? "Resume" : "Pause"}
      </button>
    </div>
  );
}

function Body({ signedIn, onManage }: { signedIn: boolean; onManage: () => void }): ReactNode {
  const c = MEMBERSHIP_COPY;
  return (
    <>
      {signedIn ? (
        <div className="px-1 pb-4 pt-2">
          <SubscriptionStatus onManage={onManage} />
          <h1 className="text-[2rem] font-medium tracking-[-0.03em] text-ink">Membership plans</h1>
          <p className="mt-2 max-w-2xl text-[15px] text-ink-muted">{c.lead}</p>
          <div className="mt-8">
            <PlanCards />
          </div>
        </div>
      ) : (
        <>
          <PageHero eyebrow={c.eyebrow} title={c.headline} lead={c.lead}>
            <p className="mt-6 text-[14px] text-ink-muted">
              {c.oneTime.text}{" "}
              <Link href={c.oneTime.href} className="font-medium text-ink underline-offset-4 hover:underline">
                {c.oneTime.link}
              </Link>
              .
            </p>
          </PageHero>
          <section className="px-5 pb-6 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-6xl">
              <PlanCards />
              <p className="mt-4 text-[13px] text-ink-muted">
                Prices depend on your home&rsquo;s size. Every plan adds a ${c.firstMonthFee} deep clean to the first month.
              </p>
            </div>
          </section>
        </>
      )}

      <Section id="how" headline={c.howHeadline} lead={c.howLead}>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {c.steps.map((s, i) => (
            <li key={s.title} className="rounded-2xl border border-line bg-white p-4 shadow-[0_16px_40px_-32px_rgba(11,10,17,0.35)]">
              <Index n={i + 1} />
              <h3 className="mt-2 text-[17px] font-medium tracking-[-0.02em] text-ink">{s.title}</h3>
              <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="compare" headline={c.compareHeadline}>
        <Compare />
        <div className="mt-8 rounded-2xl border border-line bg-[#FAFAFC] p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5A1FD6]">Membership terms</p>
          <ul className="mt-3 space-y-1.5">
            {c.terms.map((t) => (
              <li key={t} className="flex gap-2.5 text-[14px] text-ink">
                <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#8E5BFF]" aria-hidden="true" />
                {t}
              </li>
            ))}
          </ul>
          <a href={c.termsLink.href} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-[#5A1FD6] hover:underline">
            {c.termsLink.label}
            <RiArrowRightUpLine className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </Section>
    </>
  );
}

export default function Membership() {
  const { user, subscription, checkSubscription } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const dialog = (
    <PauseResumeDialog
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      isPaused={subscription?.is_paused || false}
      resumesAt={subscription?.resumes_at}
      onSuccess={checkSubscription}
    />
  );

  if (user) {
    return (
      <div className="landing mx-auto max-w-6xl font-sans text-ink">
        <Body signedIn onManage={() => setDialogOpen(true)} />
        {dialog}
      </div>
    );
  }
  return (
    <MarketingShell>
      <Body signedIn={false} onManage={() => setDialogOpen(true)} />
      {dialog}
    </MarketingShell>
  );
}

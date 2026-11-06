// Public checklist page (/checklist/[slug]). Server component in the landing
// style. Every line comes from src/lib/checklists.ts, the list the crews use.

import Link from "next/link";
import { RiAddLine, RiArrowRightLine, RiArrowRightUpLine, RiPhoneLine } from "@/components/icons";
import { INBOUND_PHONE } from "@/config/brand-config";
import { MarketingShell, PageHero } from "@/components/landing/MarketingShell";
import { Chip, Index, Section, btnOutline, btnPrimary, gutter, shell } from "@/components/landing/primitives";
import { CHECKLISTS, CHECKLIST_SLUGS, type Checklist } from "@/lib/checklists";
import { cn } from "@/lib/utils";

function countItems(checklist: Checklist) {
  return checklist.sections.reduce((n, s) => n + s.items.length, 0);
}

function ScopeSummary({ checklist }: { checklist: Checklist }) {
  const total = countItems(checklist);
  const max = Math.max(...checklist.sections.map((s) => s.items.length));
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-white p-5 shadow-[0_0_72px_-28px_rgba(104,16,254,0.5)] sm:p-6">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-[#6810FE]/[0.08] to-transparent" />
      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5A1FD6]">Scope · {checklist.name}</p>
          <Chip tone="good">{total} tasks</Chip>
        </div>
        <ul className="mt-5 space-y-3">
          {checklist.sections.map((s, i) => (
            <li key={s.title}>
              <a href={`#area-${i + 1}`} className="group block">
                <div className="flex items-center justify-between text-[14px]">
                  <span className="flex items-center gap-2.5 text-ink group-hover:text-[#5A1FD6]">
                    <Index n={i + 1} />
                    {s.title}
                  </span>
                  <span className="font-mono text-[12px] text-ink-muted">{s.items.length}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#F0EEF5]">
                  <div className="h-full rounded-full bg-[#8E5BFF]" style={{ width: `${Math.max(8, (s.items.length / max) * 100)}%` }} />
                </div>
              </a>
            </li>
          ))}
        </ul>
        <dl className="mt-6 grid gap-2 border-t border-line pt-5 sm:grid-cols-3">
          {[
            { label: "Time", value: checklist.meta.estimatedTime },
            { label: "Best for", value: checklist.meta.bestFor },
            { label: "Frequency", value: checklist.meta.frequency },
          ].map((f) => (
            <div key={f.label} className="rounded-lg border border-line bg-[#FAFAFC] px-3 py-2">
              <dt className="text-[11px] text-ink-muted">{f.label}</dt>
              <dd className="mt-0.5 text-[13px] leading-snug text-ink">{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

export default function ChecklistView({ checklist }: { checklist: Checklist }) {
  const commercial = checklist.family === "commercial";
  const bookLabel = commercial ? "Request a quote" : "Book this clean";
  const total = countItems(checklist);
  const others = CHECKLIST_SLUGS.filter((s) => s !== checklist.slug && CHECKLISTS[s].family === checklist.family).map(
    (s) => CHECKLISTS[s],
  );
  const tagline = checklist.tagline.replace(/\s+—\s+/g, ". ").replace(/(^|\.\s+)([a-z])/g, (_m, pre: string, c: string) => pre + c.toUpperCase());

  return (
    <MarketingShell mobileBar={false}>
      <PageHero
        back={{ href: "/checklist", label: "All checklists" }}
        eyebrow={commercial ? "Commercial checklist" : "Home checklist"}
        title={`${checklist.name}.`}
        lead={`${tagline}. ${checklist.description}`}
        aside={<ScopeSummary checklist={checklist} />}
      >
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href={checklist.bookingHref} className={btnPrimary}>
            {bookLabel}
            <RiArrowRightLine className="h-4 w-4" aria-hidden="true" />
          </Link>
          <a href={INBOUND_PHONE.tel} className={btnOutline}>
            <RiPhoneLine className="h-4 w-4 text-[#6810FE]" aria-hidden="true" />
            Call {INBOUND_PHONE.display}
          </a>
        </div>
      </PageHero>

      <Section
        id="tasks"
        headline="Every task, in the order it gets done."
        lead={`${total} tasks across ${checklist.sections.length} areas. This is the list your ${commercial ? "crew" : "cleaner"} works from, and the list you can hold us to.`}
      >
        <div className="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
          <nav aria-label="Areas" className="lg:sticky lg:top-24 lg:self-start">
            <ol className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-1 lg:overflow-visible">
              {checklist.sections.map((s, i) => (
                <li key={s.title} className="shrink-0">
                  <a
                    href={`#area-${i + 1}`}
                    className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5 text-[13.5px] text-ink-muted hover:text-ink lg:border-0 lg:bg-transparent lg:px-0"
                  >
                    <Index n={i + 1} />
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="space-y-4">
            {checklist.sections.map((s, i) => (
              <section
                key={s.title}
                id={`area-${i + 1}`}
                aria-labelledby={`area-${i + 1}-title`}
                className="scroll-mt-24 overflow-hidden rounded-2xl border border-line bg-white shadow-[0_16px_40px_-32px_rgba(11,10,17,0.35)]"
              >
                <div className="flex items-center justify-between gap-3 border-b border-line bg-[#FAFAFC] px-5 py-3.5">
                  <h3 id={`area-${i + 1}-title`} className="flex items-center gap-3 text-[18px] font-medium tracking-[-0.02em] text-ink">
                    <Index n={i + 1} />
                    {s.title}
                  </h3>
                  <Chip>{s.items.length} tasks</Chip>
                </div>
                <ul className="grid sm:grid-cols-2">
                  {s.items.map((item) => (
                    <li key={item} className="flex gap-3 border-b border-line px-5 py-3 text-[14.5px] leading-snug text-ink sm:odd:border-r">
                      <span className="mt-0.5 grid h-4 w-4 flex-shrink-0 place-items-center rounded border border-[#6810FE] bg-[#6810FE]">
                        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                          <path d="M2.5 6.2l2.3 2.3 4.7-5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {checklist.notIncluded.length > 0 ? (
              <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-[17px] font-medium tracking-[-0.02em] text-ink">{checklist.notIncludedHeading.replace(/\s*—.*$/, "")}</h3>
                  <Chip tone="warn">Not on this list</Chip>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {checklist.notIncluded.map((item) => (
                    <li key={item} className="flex gap-2.5 text-[14px] text-ink">
                      <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
                {checklist.recommendedNextSlug ? (
                  <Link
                    href={`/checklist/${checklist.recommendedNextSlug}`}
                    className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-[#5A1FD6] hover:underline"
                  >
                    {checklist.recommendedNextLabel}
                    <RiArrowRightLine className="h-4 w-4" aria-hidden="true" />
                  </Link>
                ) : null}
              </section>
            ) : null}

            {checklist.addOns.length > 0 ? (
              <section className="rounded-2xl border border-line bg-white p-5">
                <h3 className="text-[17px] font-medium tracking-[-0.02em] text-ink">Add-ons</h3>
                <p className="mt-1 text-[14px] text-ink-muted">Add any of these when you book. Each one is priced on its own line.</p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {checklist.addOns.map((a) => (
                    <li key={a} className="inline-flex items-center gap-1.5 rounded-full border border-[#E3D7FF] bg-[#F7F4FF] px-3 py-1.5 text-[13px] text-[#4A0CD0]">
                      <RiAddLine className="h-3.5 w-3.5" aria-hidden="true" />
                      {a}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      </Section>

      <section className={cn(gutter, "border-t border-line py-20 sm:py-24")}>
        <div className={shell}>
          <div className="relative mx-auto max-w-3xl overflow-hidden rounded-2xl border border-line bg-white p-8 text-center shadow-[0_0_80px_-28px_rgba(104,16,254,0.55)] sm:p-12">
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#6810FE]/[0.10] to-transparent" />
            <div className="relative">
              <h2 className="text-[1.85rem] font-medium leading-tight tracking-[-0.03em] text-ink sm:text-[2.4rem]">
                {commercial ? "Tell us about the site." : "This is the list. Book it."}
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-ink-muted">
                {commercial
                  ? "Share the square footage and schedule and we price it per visit. The crew works this list."
                  : "Your exact price is shown before you pay. If anything on this list is missed, we re-clean it free within 48 hours."}
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link href={checklist.bookingHref} className={btnPrimary}>
                  {bookLabel}
                  <RiArrowRightLine className="h-4 w-4" aria-hidden="true" />
                </Link>
                <a href={INBOUND_PHONE.tel} className={btnOutline}>
                  <RiPhoneLine className="h-4 w-4 text-[#6810FE]" aria-hidden="true" />
                  Call Nova
                </a>
              </div>
            </div>
          </div>

          {others.length ? (
            <div className="mt-16">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5A1FD6]">
                {commercial ? "Other commercial scopes" : "Other home checklists"}
              </p>
              <ul className="grid gap-3 sm:grid-cols-3">
                {others.map((o) => (
                  <li key={o.slug}>
                    <Link
                      href={`/checklist/${o.slug}`}
                      className="group block h-full rounded-2xl border border-line bg-white p-4 shadow-[0_16px_40px_-32px_rgba(11,10,17,0.35)] hover:border-[#C9B6FF]"
                    >
                      <p className="flex items-center justify-between text-[16px] font-medium tracking-[-0.02em] text-ink">
                        {o.name}
                        <RiArrowRightUpLine className="h-4 w-4 text-ink-muted group-hover:text-[#6810FE]" aria-hidden="true" />
                      </p>
                      <p className="mt-1 text-[13.5px] text-ink-muted">{countItems(o)} tasks</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>
    </MarketingShell>
  );
}

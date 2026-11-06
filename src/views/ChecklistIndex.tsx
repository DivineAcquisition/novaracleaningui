// Public checklist index (/checklist). Server component in the landing style.

import Link from "next/link";
import { RiArrowRightLine, RiArrowRightUpLine, RiCheckLine } from "@/components/icons";
import { MarketingShell, PageHero } from "@/components/landing/MarketingShell";
import { Chip, Frame, Index, Section } from "@/components/landing/primitives";
import {
  CHECKLISTS,
  COMMERCIAL_CHECKLIST_SLUGS,
  RESIDENTIAL_CHECKLIST_SLUGS,
  type Checklist,
  type ChecklistSlug,
} from "@/lib/checklists";
import { cn } from "@/lib/utils";

function countItems(c: Checklist) {
  return c.sections.reduce((n, s) => n + s.items.length, 0);
}

function sentence(tagline: string) {
  return tagline.replace(/\s+—\s+/g, ". ").replace(/•/g, "·").replace(/(^|\.\s+)([a-z])/g, (_m, pre: string, c: string) => pre + c.toUpperCase());
}

function Preview() {
  const c = CHECKLISTS["standard-clean"];
  const kitchen = c.sections[0];
  return (
    <Frame glow label="From the Standard checklist">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5A1FD6]">Standard clean · {kitchen.title}</p>
        <Chip tone="good">{countItems(c)} tasks</Chip>
      </div>
      <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
        {kitchen.items.slice(0, 6).map((item) => (
          <li key={item} className="flex gap-3 px-4 py-2.5 text-[14px] text-ink">
            <RiCheckLine className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#6810FE]" aria-hidden="true" />
            {item}
          </li>
        ))}
      </ul>
      <Link href="/checklist/standard-clean" className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-[#5A1FD6] hover:underline">
        Open the full list
        <RiArrowRightLine className="h-4 w-4" aria-hidden="true" />
      </Link>
    </Frame>
  );
}

function Family({ id, headline, lead, slugs, start }: { id: string; headline: string; lead: string; slugs: ChecklistSlug[]; start: number }) {
  return (
    <Section id={id} headline={headline} lead={lead}>
      <ul className="grid gap-4 md:grid-cols-2">
        {slugs.map((slug, i) => {
          const c = CHECKLISTS[slug];
          const first = i === 0;
          return (
            <li key={slug}>
              <Link
                href={`/checklist/${slug}`}
                className={cn(
                  "group flex h-full flex-col rounded-2xl border bg-white p-5 transition hover:border-[#C9B6FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6810FE]",
                  first ? "border-[#E3D7FF] shadow-[0_0_60px_-28px_rgba(104,16,254,0.6)]" : "border-line shadow-[0_16px_40px_-32px_rgba(11,10,17,0.35)]",
                )}
              >
                <div className="flex items-center justify-between">
                  <Index n={start + i} />
                  <Chip tone={first ? "good" : "neutral"}>{countItems(c)} tasks</Chip>
                </div>
                <p className="mt-2 flex items-center justify-between gap-2 text-[21px] font-medium tracking-[-0.02em] text-ink">
                  {c.name}
                  <RiArrowRightUpLine className="h-5 w-5 text-ink-muted transition group-hover:text-[#6810FE]" aria-hidden="true" />
                </p>
                <p className="mt-1 text-[14.5px] leading-relaxed text-ink-muted">{sentence(c.tagline)}.</p>
                <dl className="mt-4 grid grid-cols-3 gap-2">
                  {[
                    { label: "Time", value: c.meta.estimatedTime.split(" for ")[0] },
                    { label: "Areas", value: String(c.sections.length) },
                    { label: "Frequency", value: c.meta.frequency.split(",")[0] },
                  ].map((f) => (
                    <div key={f.label} className="rounded-lg border border-line bg-[#FAFAFC] px-2.5 py-2">
                      <dt className="text-[11px] text-ink-muted">{f.label}</dt>
                      <dd className="mt-0.5 truncate text-[12.5px] text-ink">{f.value}</dd>
                    </div>
                  ))}
                </dl>
                <ul className="mt-4 flex-1 space-y-1.5 border-t border-line pt-4">
                  {c.sections[0]?.items.slice(0, 3).map((item) => (
                    <li key={item} className="flex gap-2 text-[13.5px] text-ink-muted">
                      <RiCheckLine className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#6810FE]" aria-hidden="true" />
                      <span className="line-clamp-1">{item}</span>
                    </li>
                  ))}
                </ul>
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export default function ChecklistIndex() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Checklists"
        title="The list is the promise."
        lead="Every service has a written checklist. It is what your cleaner works from, and it is what you can hold us to. Open one to see every task."
        aside={<Preview />}
      />
      <Family
        id="homes"
        headline="Homes"
        lead="Standard, Deep, Move-in/out, and Recurring. Each one adds to the list before it."
        slugs={RESIDENTIAL_CHECKLIST_SLUGS}
        start={1}
      />
      <Family
        id="commercial"
        headline="Commercial and offices"
        lead="Light, Standard, and Detailed build on each other. Office adds desk and lock-up rules for after-hours work."
        slugs={COMMERCIAL_CHECKLIST_SLUGS}
        start={RESIDENTIAL_CHECKLIST_SLUGS.length + 1}
      />
    </MarketingShell>
  );
}

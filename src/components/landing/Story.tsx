// Problem and "How we work" sections. Server-rendered.

import Link from "next/link";
import {
  RiAlarmWarningLine,
  RiArrowRightLine,
  RiCheckLine,
  RiChatOffLine,
  RiFileList3Line,
  RiPhoneLine,
  RiPriceTag3Line,
  RiQuestionLine,
} from "@remixicon/react";
import { CHECKLISTS } from "@/lib/checklists";
import { PROBLEM, STANDARD } from "@/lib/landing/content";
import { Index, Section, lead, panel } from "./primitives";

const PAIN_ICONS = [
  RiPhoneLine,
  RiPriceTag3Line,
  RiQuestionLine,
  RiChatOffLine,
];

function ScatteredScene() {
  const { tabs, activeTab, note, flags, stamp } = PROBLEM.scene;
  return (
    <div
      className="rounded-xl border border-line bg-[#F6F5F9] p-3 sm:p-4"
      aria-label="An example of a typical cleaning quote"
    >
      <div className="mb-2 flex gap-1.5 px-1" aria-hidden="true">
        <span className="h-2 w-2 rounded-full bg-[#DAD7E2]" />
        <span className="h-2 w-2 rounded-full bg-[#DAD7E2]" />
        <span className="h-2 w-2 rounded-full bg-[#DAD7E2]" />
      </div>
      <div className="flex gap-1 overflow-hidden">
        {tabs.map((tab, i) => (
          <span
            key={tab}
            className={
              i === activeTab
                ? "truncate rounded-t-md border border-b-0 border-line bg-white px-3 py-2 text-[12px] text-ink"
                : "hidden truncate rounded-t-md border border-b-0 border-transparent bg-[#EDEBF2] px-3 py-2 text-[12px] text-ink-muted sm:inline"
            }
          >
            {tab}
          </span>
        ))}
      </div>
      <div className="relative rounded-b-lg rounded-tr-lg border border-line bg-white p-4">
        <p className="pr-16 text-[15px] text-ink">{note}</p>
        <span className="absolute right-4 top-4 rotate-[8deg] rounded-md border-2 border-amber-500 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-600">
          {stamp}
        </span>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {flags.map((flag) => (
            <span
              key={flag}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-[#FAFAFC] px-2 py-1 text-[11.5px] text-ink-muted"
            >
              <RiAlarmWarningLine
                className="h-3.5 w-3.5 text-amber-500"
                aria-hidden="true"
              />
              {flag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Problem() {
  return (
    <Section id={PROBLEM.id} headline={PROBLEM.headline}>
      <div className="grid items-start gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
        <div className="min-w-0 space-y-6">
          <ScatteredScene />
          <div className="space-y-4 text-[15px] leading-relaxed text-ink-muted sm:text-base">
            <p>{PROBLEM.opening}</p>
            <p>{PROBLEM.scattered}</p>
          </div>
        </div>
        <ol className="space-y-3">
          {PROBLEM.pains.map((pain, i) => {
            const Icon = PAIN_ICONS[i % PAIN_ICONS.length];
            return (
              <li key={pain} className={`${panel} flex items-start gap-4 p-4`}>
                <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg border border-line bg-[#F6F5F9]">
                  <Icon className="h-4 w-4 text-[#6810FE]" aria-hidden="true" />
                </span>
                <p className="pt-1.5 text-[15px] text-ink">
                  <Index n={i + 1} className="mr-2" />
                  {pain}
                </p>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="mt-10 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-6 text-[15px] text-ink sm:text-base">
        <span className="font-medium">{PROBLEM.bridge.text}</span>
        <a
          href={PROBLEM.bridge.href}
          className="inline-flex items-center gap-1.5 font-medium text-[#5A1FD6] underline-offset-4 hover:underline"
        >
          {PROBLEM.bridge.link}
          <RiArrowRightLine className="h-4 w-4" aria-hidden="true" />
        </a>
      </p>
    </Section>
  );
}

function ChecklistDocument() {
  const checklist = CHECKLISTS["standard-clean"];
  const total = checklist.sections.reduce((n, s) => n + s.items.length, 0);
  return (
    <figure>
      <div className="relative">
        <div
          className="absolute inset-0 translate-x-3 translate-y-3 rotate-[1.5deg] rounded-2xl border border-line bg-[#F6F5F9]"
          aria-hidden="true"
        />
        <div className="relative rounded-2xl border border-line bg-white p-6 shadow-[0_24px_50px_-30px_rgba(11,10,17,0.35)]">
          <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
            <div className="flex items-center gap-2.5">
              <RiFileList3Line
                className="h-5 w-5 text-[#6810FE]"
                aria-hidden="true"
              />
              <p className="text-[15px] font-medium text-ink">
                {checklist.name}
              </p>
            </div>
            <span className="font-mono text-[12px] text-ink-muted">
              {total} tasks
            </span>
          </div>
          <div className="mt-4 space-y-5">
            {checklist.sections.map((section) => (
              <div key={section.title}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                  {section.title}
                </p>
                <ul className="space-y-1.5">
                  {section.items.slice(0, 4).map((item) => (
                    <li
                      key={item}
                      className="flex gap-2.5 text-[14px] text-ink"
                    >
                      <span className="mt-0.5 grid h-4 w-4 flex-shrink-0 place-items-center rounded border border-[#6810FE] bg-[#6810FE]">
                        <RiCheckLine
                          className="h-3 w-3 text-white"
                          aria-hidden="true"
                        />
                      </span>
                      {item}
                    </li>
                  ))}
                  {section.items.length > 4 ? (
                    <li className="pl-[26px] text-[13px] text-ink-muted">
                      + {section.items.length - 4} more
                    </li>
                  ) : null}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="mt-6 flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-muted">
        <span>{STANDARD.documentLabel}</span>
        <Link
          href={STANDARD.documentLink.href}
          className="inline-flex items-center gap-1 font-medium text-[#5A1FD6] hover:underline"
        >
          {STANDARD.documentLink.label}
          <RiArrowRightLine className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </figcaption>
    </figure>
  );
}

export function Standard() {
  return (
    <section
      id={STANDARD.id}
      aria-labelledby="standard-title"
      className="scroll-mt-20 border-t border-line px-5 py-20 sm:px-6 sm:py-28 lg:px-8"
    >
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <ChecklistDocument />
        <div>
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5A1FD6]">
            {STANDARD.eyebrow}
          </p>
          <h2
            id="standard-title"
            className="text-[1.85rem] font-medium leading-tight tracking-[-0.03em] text-ink sm:text-[2.6rem] sm:leading-[1.1]"
          >
            {STANDARD.headline}
          </h2>
          <div className={`${lead} mt-5 space-y-4`}>
            {STANDARD.paragraphs.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
          <dl className="mt-8 grid gap-x-8 gap-y-6 border-t border-line pt-8 sm:grid-cols-2">
            {STANDARD.tenets.map((t, i) => (
              <div key={t.id} className="flex gap-3">
                <Index n={i + 1} className="pt-0.5" />
                <div>
                  <dt className="text-[15px] font-medium text-ink">
                    {t.title}
                  </dt>
                  <dd className="mt-1 text-[14px] leading-relaxed text-ink-muted">
                    {t.body}
                  </dd>
                </div>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

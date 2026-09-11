"use client";

// ─── The addendum, rendered ──────────────────────────────────────────────────
//
// One component for every surface that shows the Contractor Standards: the
// texted acknowledgment page, the onboarding wizard, and the admin preview.
// Shared rather than duplicated because a contractor acknowledging a document
// that differs — even in emphasis — from the one an admin later enforces is
// the failure mode this whole feature exists to prevent.
//
// Rendered from src/lib/contractor-standards.ts. Nothing here decides what the
// standards say; it only decides how they read on a phone at 7am.

import { RiCheckLine, RiCloseLine, RiErrorWarningLine } from "@remixicon/react";

import {
  CONTRACTOR_STANDARDS_EDITION,
  CONTRACTOR_STANDARDS_PREAMBLE,
  CONTRACTOR_STANDARDS_SECTIONS,
  CONTRACTOR_STANDARDS_SUBTITLE,
  CONTRACTOR_STANDARDS_TITLE,
  type StandardsList,
  type StandardsSection,
} from "@/lib/contractor-standards";

const TONE: Record<
  StandardsList["tone"],
  { icon: typeof RiCheckLine | null; iconClass: string; titleClass: string }
> = {
  required: { icon: RiCheckLine, iconClass: "text-emerald-600", titleClass: "text-emerald-900" },
  prohibited: { icon: RiCloseLine, iconClass: "text-rose-600", titleClass: "text-rose-900" },
  neutral: { icon: null, iconClass: "", titleClass: "text-slate-900" },
};

function List({ list }: { list: StandardsList }) {
  const tone = TONE[list.tone];
  const Icon = tone.icon;
  return (
    <div className="space-y-1.5">
      {list.title ? (
        <p className={`text-xs font-semibold uppercase tracking-wide ${tone.titleClass}`}>
          {list.title}
        </p>
      ) : null}
      <ul className="space-y-1.5">
        {list.items.map((item) => (
          <li key={item} className="flex gap-2 text-sm leading-relaxed text-slate-700">
            {Icon ? (
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone.iconClass}`} aria-hidden />
            ) : (
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" aria-hidden />
            )}
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({ section, index }: { section: StandardsSection; index: number }) {
  return (
    <section id={`standards-${section.id}`} className="space-y-3 border-t border-slate-200 pt-5">
      <h3 className="text-sm font-semibold text-slate-900">
        <span className="text-slate-400">{index + 1}.</span> {section.heading}
      </h3>

      {section.lede ? (
        <p className="text-sm leading-relaxed text-slate-600">{section.lede}</p>
      ) : null}

      {section.lists.map((list, i) => (
        <List key={list.title || `list-${i}`} list={list} />
      ))}

      {/* The consequence, out of the bullet flow. These are the lines people
          skim past in a list and then dispute the enforcement of. */}
      {(section.emphasis || []).map((line) => (
        <p
          key={line}
          className="flex gap-2 rounded-lg bg-slate-100 p-3 text-sm font-medium leading-relaxed text-slate-800"
        >
          <RiErrorWarningLine className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          <span>{line}</span>
        </p>
      ))}
    </section>
  );
}

export default function ContractorStandardsDocument({
  showHeader = true,
  className,
}: {
  /** Off when the surrounding page already titles the document. */
  showHeader?: boolean;
  className?: string;
}) {
  return (
    <article className={`space-y-5 ${className || ""}`}>
      {showHeader ? (
        <header className="space-y-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {CONTRACTOR_STANDARDS_TITLE}
            </h2>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">
              {CONTRACTOR_STANDARDS_EDITION}
            </p>
          </div>
          <p className="text-xs leading-relaxed text-slate-500">{CONTRACTOR_STANDARDS_SUBTITLE}</p>
        </header>
      ) : null}

      <p className="text-sm leading-relaxed text-slate-600">{CONTRACTOR_STANDARDS_PREAMBLE}</p>

      {CONTRACTOR_STANDARDS_SECTIONS.map((section, index) => (
        <Section key={section.id} section={section} index={index} />
      ))}
    </article>
  );
}

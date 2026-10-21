"use client";

import Link from "next/link";
import { hiringApplyUrl } from "@/lib/site-hosts";
import type { PublicRoleCard } from "@/lib/contractor-roles";
import { HIRING_GRADIENT } from "@/components/hiring/HiringChrome";

export function RoleHiringCards({ cards }: { cards: PublicRoleCard[] }) {
  return (
    <div className="grid gap-4">
      {cards.map((card) => (
        <article key={card.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_16px_40px_-32px_rgba(15,23,42,0.45)]">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-heading text-2xl font-bold text-slate-900">{card.name}</h3>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
              {card.tag}
            </span>
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-700">{card.shortDescription}</p>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <h4 className="text-sm font-semibold text-slate-900">What you'll do</h4>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {card.whatYoullDo.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-900">What you'll need</h4>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {card.whatYoullNeed.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </div>
          </div>
          <p className="mt-5 text-sm font-semibold text-[#5C0FFE]">Pay: {card.payLine}</p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link href={card.detailPath} className="inline-flex h-11 items-center rounded-full border border-slate-200 px-5 text-sm font-semibold text-slate-800">
              Read {card.name}
            </Link>
            {card.applyQuery ? (
              <a href={hiringApplyUrl(`?role=${card.applyQuery}`)} className="inline-flex h-11 items-center rounded-full px-5 text-sm font-semibold text-white" style={{ background: HIRING_GRADIENT }}>
                Apply
              </a>
            ) : card.closedNotice ? (
              <p className="text-sm font-medium text-slate-600">{card.closedNotice}</p>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

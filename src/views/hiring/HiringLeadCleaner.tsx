"use client";

import Link from "next/link";
import { RiArrowLeftLine, RiCheckboxCircleFill } from "@remixicon/react";
import { SEO } from "@/components/SEO";
import { roleById } from "@/lib/hiring/roles";
import { hiringApplyUrl } from "@/lib/site-hosts";
import { HiringFooter, HiringNav, HiringShell, HIRING_GRADIENT } from "@/components/hiring/HiringChrome";
import { LEAD_GUARDRAILS } from "@/lib/contractor-intake/lead";

const role = roleById("lead-cleaner");

export default function HiringLeadCleaner() {
  return (
    <HiringShell>
      <SEO
        title="Lead Cleaner"
        description="Lead Cleaner is open. Lead jobs pay 47% of the job. Solo jobs stay at your tier rate. Apply on the Novara hiring site."
        canonical="https://hiring.novaracleaning.com/hiring/lead-cleaner"
      />
      <HiringNav ctaHref={hiringApplyUrl("?role=lead-cleaner")} ctaLabel="Apply" />
      <main className="mx-auto max-w-3xl px-5 py-12 sm:px-6 sm:py-16">
        <Link href="/hiring" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-slate-900">
          <RiArrowLeftLine className="h-4 w-4" aria-hidden />
          All roles
        </Link>
        <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5C0FFE]">Open · DMV</p>
        <h1 className="mt-3 font-heading text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">{role.title}</h1>
        <p className="mt-4 text-lg leading-relaxed text-slate-600">{role.summary}</p>
        <a href={hiringApplyUrl("?role=lead-cleaner")} className="mt-8 inline-flex h-12 items-center rounded-full px-6 text-sm font-semibold text-white" style={{ background: HIRING_GRADIENT }}>
          Start the Lead Cleaner application
        </a>

        <section className="mt-12">
          <h2 className="font-heading text-2xl font-bold text-slate-900">What the role is</h2>
          <ul className="mt-4 space-y-3">
            {role.highlights.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-slate-700">
                <RiCheckboxCircleFill className="mt-0.5 h-4 w-4 shrink-0 text-[#5C0FFE]" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 className="font-heading text-xl font-bold text-slate-900">Guardrails</h2>
          <ul className="mt-4 space-y-2 text-sm leading-relaxed text-slate-700">
            {LEAD_GUARDRAILS.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <p className="mt-4 text-sm text-slate-600">
            A person reviews every Lead Cleaner application. Outside applicants who pass start as a cleaner on the Lead Track and are reviewed for lead status after they meet the minimums.
          </p>
        </section>
      </main>
      <HiringFooter />
    </HiringShell>
  );
}

"use client";

import {
  AGREEMENT_CLAUSES,
  COMPANY_LEGAL_NAME,
  IMPORTANT_NOTICE,
  PAYMENT_OPTIONS,
} from "@/lib/host-onboarding/agreement";

export default function HostPartnershipAgreementDoc() {
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-violet-600">
          {COMPANY_LEGAL_NAME}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Host Partnership Agreement</h1>
        <p className="mt-2 text-sm text-slate-500">
          Part One. The per-property rate schedule in Section 17 is attached to the tokenized
          onboarding session after your rates are set.
        </p>

        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">
          <p className="font-semibold">Important Notice</p>
          <p className="mt-1">{IMPORTANT_NOTICE}</p>
        </div>

        <div className="mt-8 space-y-6">
          {AGREEMENT_CLAUSES.map(([heading, copy]) => (
            <section key={heading}>
              <h2 className="text-base font-semibold">{heading}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{copy}</p>
            </section>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold">Section 6.2 — payment options</h2>
          <ul className="mt-3 space-y-3">
            {Object.values(PAYMENT_OPTIONS).map((o) => (
              <li key={o.key}>
                <p className="text-sm font-semibold">{o.title}</p>
                <p className="text-sm leading-relaxed text-slate-600">{o.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </article>
    </div>
  );
}

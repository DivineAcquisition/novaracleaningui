// Airbnb / short-term-rental hosts. The turnover flow and checklist points come
// from the STR turnover checklist the crews work from. Links to /str for the
// host estimate and the partner portal.

import Link from "next/link";
import { RiArrowRightLine } from "@remixicon/react";

const FLOW = [
  { title: "Guest checks out", body: "You request the turnover in the partner portal." },
  { title: "Crew assigned", body: "Matched to the property, the checkout time, and the next check-in." },
  { title: "Turnover checklist", body: "Linens, restock to your spec, guest-left items, appliances, Wi-Fi, door codes." },
  { title: "8–12 photos sent", body: "Kitchen, each bathroom, each bedroom, and living area, plus anything we found." },
  { title: "Ready for check-in", body: "Damage or missing items are reported right away, not after the next guest." },
];

export function HostsSection() {
  return (
    <div className="grid items-start gap-8 rounded-3xl bg-brand-950 p-6 text-white md:grid-cols-[1fr_1.1fr] md:p-10">
      <div className="space-y-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-white/60">
          For Airbnb and short-term rental hosts
        </p>
        <h2 className="font-heading text-3xl font-bold leading-tight text-white md:text-4xl">
          Turnovers done to your standard, with photo proof every time.
        </h2>
        <p className="max-w-md text-white/75">
          Get a per-turnover price for each property in seconds, then manage requests in the partner portal.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/str"
            className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-brand-950 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-950"
          >
            Price my property
            <RiArrowRightLine className="h-4 w-4" aria-hidden="true" />
          </Link>
          <a
            href="https://partner.novaracleaning.com"
            className="inline-flex items-center rounded-lg border border-white/25 px-4 py-2.5 text-sm font-semibold text-white hover:border-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            Host sign in
          </a>
        </div>
      </div>

      <ol className="relative space-y-5">
        <span
          className="absolute bottom-3 left-[11px] top-3 w-0.5 overflow-hidden rounded bg-white/15"
          aria-hidden="true"
        >
          <span className="landing-beam absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-[#B49AFE] to-transparent" />
        </span>
        {FLOW.map((step, i) => (
          <li key={step.title} className="relative grid grid-cols-[24px_1fr] gap-4">
            <span
              className="relative z-10 mt-0.5 grid h-6 w-6 place-items-center rounded-full border border-white/30 bg-brand-950 font-mono text-[11px] text-white/80"
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <div>
              <p className="font-semibold text-white">{step.title}</p>
              <p className="text-sm text-white/70">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

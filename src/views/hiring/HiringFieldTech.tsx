"use client";

// ─── hiring.novaracleaning.com/hiring/field-tech ────────────────────────────
//
// Primary Field Tech role page. Also hosts Specialized Contractors + Commercial
// Cleaner as active evergreen lists (applicants selected when needed).

import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCheckboxCircleFill,
  RiMapPin2Line,
} from "@remixicon/react";
import { SEO } from "@/components/SEO";
import { roleById, type HiringRoleId } from "@/lib/hiring/roles";
import {
  EvergreenBadge,
  HiringFooter,
  HiringNav,
  HiringShell,
  HIRING_GRADIENT,
} from "@/components/hiring/HiringChrome";
import { HiringApplyForm } from "@/components/hiring/HiringApplyForm";

const field = roleById("field-tech");
const specialized = roleById("specialized-contractors");
const commercial = roleById("commercial-cleaner");

export default function HiringFieldTech() {
  const searchParams = useSearchParams();
  const defaultRole = useMemo<HiringRoleId>(() => {
    const q = (searchParams.get("role") || "").trim() as HiringRoleId;
    if (q === "specialized-contractors" || q === "commercial-cleaner" || q === "field-tech") return q;
    return "field-tech";
  }, [searchParams]);

  return (
    <HiringShell>
      <SEO
        title="Field Tech Role"
        description="Join Novara Cleaning as a Field Tech independent contractor. Flexible DMV jobs, revenue-share pay, plus evergreen Specialized Contractor and Commercial Cleaner lists."
        canonical="https://hiring.novaracleaning.com/hiring/field-tech"
      />
      <HiringNav ctaHref="#apply" />

      <section className="relative overflow-hidden border-b border-slate-200/80">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 50% at 20% 0%, rgba(143,123,253,0.18), transparent 55%)," +
              "linear-gradient(180deg, #FFFFFF, #FAFAFC)",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-5 py-12 sm:px-6 sm:py-16">
          <Link
            href="/hiring"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-800"
          >
            <RiArrowLeftLine className="h-4 w-4" />
            All roles
          </Link>
          <p className="nv-hire-rise mt-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5C0FFE]">
            Open role
          </p>
          <h1 className="nv-hire-rise nv-hire-rise-d1 mt-3 font-jakarta text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
            {field.title}
          </h1>
          <p className="nv-hire-rise nv-hire-rise-d2 mt-4 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
            {field.summary}
          </p>
          <div className="nv-hire-rise nv-hire-rise-d3 mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <RiMapPin2Line className="h-4 w-4 text-[#8F7BFD]" />
              {field.location}
            </span>
            <span>{field.type}</span>
            <span>{field.pay}</span>
          </div>
          <div className="nv-hire-rise nv-hire-rise-d3 mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              href="#apply"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full px-7 text-sm font-semibold uppercase tracking-[0.04em] text-white shadow-[0_14px_34px_-14px_rgba(92,15,254,0.7)] transition hover:opacity-95"
              style={{ background: HIRING_GRADIENT }}
            >
              Apply now
              <RiArrowRightLine className="h-4 w-4" />
            </a>
            <a
              href="#evergreen"
              className="inline-flex h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Evergreen roles
            </a>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-5 py-14 sm:px-6 sm:py-16">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          <div className="space-y-12">
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5C0FFE]">
                Why Field Tech
              </p>
              <h2 className="mt-2 font-jakarta text-2xl font-bold text-slate-900 sm:text-3xl">
                Flexible work. Real payouts. You’re in control.
              </h2>
              <ul className="mt-6 space-y-3">
                {field.highlights.map((item) => (
                  <li key={item} className="flex gap-3 text-sm leading-relaxed text-slate-600 sm:text-[15px]">
                    <RiCheckboxCircleFill className="mt-0.5 h-5 w-5 shrink-0 text-[#5C0FFE]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5C0FFE]">
                What we expect
              </p>
              <h2 className="mt-2 font-jakarta text-2xl font-bold text-slate-900">
                Show up sharp. Leave homes spotless.
              </h2>
              <ul className="mt-6 space-y-3">
                {field.expectations.map((item) => (
                  <li key={item} className="flex gap-3 text-sm leading-relaxed text-slate-600 sm:text-[15px]">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#8F7BFD]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* Evergreen roles on the Field Tech page */}
            <section id="evergreen" className="scroll-mt-24 space-y-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">
                  Also recruiting
                </p>
                <h2 className="mt-2 font-jakarta text-2xl font-bold text-slate-900">
                  Evergreen contractor lists
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
                  These roles stay open as an <strong className="font-semibold text-slate-800">active evergreen list</strong> —
                  we review every applicant and select contractors when demand opens. Applying keeps
                  you in consideration; it is not a standing daily roster.
                </p>
              </div>

              {[specialized, commercial].map((role) => (
                <article
                  key={role.id}
                  id={role.slug}
                  className="scroll-mt-24 rounded-2xl border border-dashed border-slate-300 bg-white p-5 sm:p-6"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-jakarta text-lg font-bold text-slate-900 sm:text-xl">
                      {role.title}
                    </h3>
                    <EvergreenBadge />
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{role.summary}</p>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <RiMapPin2Line className="h-3.5 w-3.5 text-[#8F7BFD]" />
                      {role.location}
                    </span>
                    <span>{role.type}</span>
                    <span>{role.pay}</span>
                  </div>
                  <ul className="mt-4 space-y-2">
                    {role.highlights.slice(0, 3).map((h) => (
                      <li key={h} className="flex gap-2 text-sm text-slate-600">
                        <RiCheckboxCircleFill className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={`/hiring/field-tech?role=${role.id}#apply`}
                    className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[#5C0FFE] hover:underline"
                  >
                    Apply for {role.shortTitle}
                    <RiArrowRightLine className="h-4 w-4" />
                  </Link>
                </article>
              ))}
            </section>
          </div>

          <div className="lg:sticky lg:top-24">
            <HiringApplyForm key={defaultRole} defaultRole={defaultRole} />
          </div>
        </div>
      </main>

      <HiringFooter />
    </HiringShell>
  );
}

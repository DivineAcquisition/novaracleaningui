"use client";

// ─── hiring.novaracleaning.com — open positions ─────────────────────────────

import Link from "next/link";
import { RiArrowRightLine, RiMapPin2Line, RiSparklingLine } from "@remixicon/react";
import { SEO } from "@/components/SEO";
import { HIRING_ROLES } from "@/lib/hiring/roles";
import {
  EvergreenBadge,
  HiringFooter,
  HiringNav,
  HiringShell,
  HIRING_GRADIENT,
} from "@/components/hiring/HiringChrome";
import { Particles } from "@/components/magicui/particles";
import { BRAND } from "@/lib/brand";
import { HiringApplyForm } from "@/components/hiring/HiringApplyForm";

export default function HiringHome() {
  const open = HIRING_ROLES.filter((r) => !r.evergreen);
  const evergreen = HIRING_ROLES.filter((r) => r.evergreen);

  return (
    <HiringShell>
      <SEO
        title="Careers"
        description="Join Novara Cleaning as an independent contractor. Open Field Tech roles across the DMV, plus evergreen Specialized Contractor and Commercial Cleaner lists."
        canonical="https://hiring.novaracleaning.com/hiring"
      />
      <HiringNav />

      {/* Hero — brand-first, one composition */}
      <section className="relative overflow-hidden">
        <Particles
          className="absolute inset-0 z-0"
          quantity={36}
          color={BRAND.primary}
          ease={80}
          size={0.45}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(70% 55% at 50% -10%, rgba(143,123,253,0.22), transparent 60%)," +
              "radial-gradient(45% 40% at 90% 20%, rgba(92,15,254,0.08), transparent 55%)," +
              "linear-gradient(180deg, #FFFFFF 0%, #FAFAFC 100%)",
          }}
        />
        <div
          aria-hidden
          className="nv-hire-drift pointer-events-none absolute -right-24 top-8 h-72 w-72 rounded-full bg-[#8F7BFD]/15 blur-3xl"
        />
        <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-20">
          <p className="nv-hire-rise text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            Now hiring
          </p>
          <h1 className="nv-hire-rise nv-hire-rise-d1 mt-4 font-heading text-[2.35rem] font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-5xl md:text-[3.4rem]">
            Novara<span className="text-primary">Cleaning</span>
          </h1>
          <p className="nv-hire-rise nv-hire-rise-d2 mt-4 max-w-xl text-lg font-medium text-slate-700 sm:text-xl">
            Build a flexible cleaning business with us.
          </p>
          <p className="nv-hire-rise nv-hire-rise-d3 mt-3 max-w-lg text-[15px] leading-relaxed text-slate-500 sm:text-base">
            Independent contractor roles across the DMV — revenue-share pay, jobs near you, and a
            team that backs you up.
          </p>
          <div className="nv-hire-rise nv-hire-rise-d3 mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href="#positions"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold text-white shadow-[0_14px_34px_-14px_rgba(92,15,254,0.7)] transition hover:opacity-95"
              style={{ background: HIRING_GRADIENT }}
            >
              Browse open roles
              <RiArrowRightLine className="h-4 w-4" />
            </a>
            <Link
              href="/hiring/field-tech"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Field Tech role
            </Link>
          </div>
        </div>
      </section>

      {/* Open positions */}
      <main id="positions" className="scroll-mt-24 mx-auto max-w-6xl px-5 pb-20 sm:px-6">
        <div className="mb-8 max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5C0FFE]">
            Open positions
          </p>
          <h2 className="mt-2 font-jakarta text-2xl font-bold text-slate-900 sm:text-3xl">
            Find where you fit
          </h2>
          <p className="mt-2 text-sm text-slate-500 sm:text-base">
            {open.length} open role{open.length === 1 ? "" : "s"} · {evergreen.length} evergreen
            lists (selected when needed)
          </p>
        </div>

        <div className="grid gap-4">
          {open.map((role) => (
            <Link
              key={role.id}
              href={`/hiring/${role.slug}`}
              className="group block rounded-2xl border border-slate-200/90 bg-white p-5 transition hover:border-[#8F7BFD]/50 hover:shadow-[0_16px_40px_-28px_rgba(92,15,254,0.45)] sm:p-6"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-jakarta text-lg font-bold text-slate-900 sm:text-xl">
                      {role.title}
                    </h3>
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#5C0FFE]/8 px-2.5 py-0.5 text-[11px] font-semibold text-[#5C0FFE]">
                      <RiSparklingLine className="h-3 w-3" />
                      Open
                    </span>
                  </div>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
                    {role.tagline}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs font-medium text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <RiMapPin2Line className="h-3.5 w-3.5 text-[#8F7BFD]" />
                      {role.location}
                    </span>
                    <span>{role.type}</span>
                    <span>{role.pay}</span>
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 self-start text-sm font-semibold text-[#5C0FFE] transition group-hover:gap-2">
                  View role
                  <RiArrowRightLine className="h-4 w-4" />
                </span>
              </div>
            </Link>
          ))}

          {evergreen.map((role) => (
            <Link
              key={role.id}
              href={`/hiring/field-tech?role=${role.id}#apply`}
              className="group block rounded-2xl border border-dashed border-slate-300 bg-white/70 p-5 transition hover:border-amber-300 hover:bg-white sm:p-6"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-jakarta text-lg font-bold text-slate-900 sm:text-xl">
                      {role.title}
                    </h3>
                    <EvergreenBadge />
                  </div>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
                    {role.tagline} Applicants are selected when needed.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs font-medium text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <RiMapPin2Line className="h-3.5 w-3.5 text-[#8F7BFD]" />
                      {role.location}
                    </span>
                    <span>{role.type}</span>
                    <span>{role.pay}</span>
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 self-start text-sm font-semibold text-slate-600 transition group-hover:gap-2 group-hover:text-[#5C0FFE]">
                  Learn more
                  <RiArrowRightLine className="h-4 w-4" />
                </span>
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-16 grid gap-10 lg:grid-cols-[1fr_1.05fr] lg:items-start">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5C0FFE]">
              How it works
            </p>
            <h2 className="mt-2 font-jakarta text-2xl font-bold text-slate-900">
              Apply once. We reach out when it’s a fit.
            </h2>
            <ol className="mt-6 space-y-4 text-sm text-slate-600">
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#5C0FFE]/10 text-xs font-bold text-[#5C0FFE]">
                  1
                </span>
                <span>Submit the short application for the role that matches you.</span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#5C0FFE]/10 text-xs font-bold text-[#5C0FFE]">
                  2
                </span>
                <span>Our team screens for reliability, zone fit, and experience.</span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#5C0FFE]/10 text-xs font-bold text-[#5C0FFE]">
                  3
                </span>
                <span>
                  Selected contractors get a tokenized onboarding link — agreement, payouts, and
                  portal access. No intro video required.
                </span>
              </li>
            </ol>
          </div>
          <HiringApplyForm defaultRole="field-tech" />
        </div>
      </main>

      <HiringFooter />
    </HiringShell>
  );
}

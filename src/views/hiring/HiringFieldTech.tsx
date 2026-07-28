"use client";

// ─── hiring.novaracleaning.com/hiring/field-tech ────────────────────────────
//
// Field Tech role page. Hosts the former /cleaner/role intro (must-watch video
// + role copy + supply checklist) before apply. Specialized Contractors +
// Commercial Cleaner remain evergreen lists (selected when needed).

import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCheckboxCircleFill,
  RiDownload2Line,
  RiFileTextLine,
  RiMapPin2Line,
  RiMoneyDollarCircleLine,
  RiCalendarScheduleLine,
  RiShieldCheckLine,
} from "@remixicon/react";
import { SEO } from "@/components/SEO";
import { WistiaPlayer } from "@/components/cleaner/WistiaPlayer";
import { roleById, type HiringRoleId } from "@/lib/hiring/roles";
import {
  EvergreenBadge,
  HiringFooter,
  HiringNav,
  HiringShell,
  HIRING_GRADIENT,
} from "@/components/hiring/HiringChrome";
import { HiringApplyForm } from "@/components/hiring/HiringApplyForm";

const SUPPLY_CHECKLIST_PDF = "/NovaraCleaning_Supply_Checklist_dd14.pdf";

const field = roleById("field-tech");
const specialized = roleById("specialized-contractors");
const commercial = roleById("commercial-cleaner");

const HIGHLIGHTS = [
  {
    icon: RiMoneyDollarCircleLine,
    title: "Revenue-share pay",
    body: "Earn a percentage of every job's revenue — 35% to start, rising to 45% as you prove yourself. The more jobs you ace, the more you make per clean.",
  },
  {
    icon: RiCalendarScheduleLine,
    title: "You set your availability",
    body: "Accept the jobs that fit your schedule. We text you offers nearby; tap accept and the address + details unlock in your dashboard.",
  },
  {
    icon: RiMapPin2Line,
    title: "Work in your area",
    body: "We route jobs based on your home base and service ZIPs, so you spend less time driving and more time earning.",
  },
  {
    icon: RiShieldCheckLine,
    title: "Independent & in control",
    body: "You're an independent contractor: you bring your own supplies and run your own clean, backed by Novara's scheduling, payments, and support.",
  },
];

const EXPECTATIONS = [
  "Show up on time and check in through the app when you arrive.",
  "Follow the job's cleaning checklist and our quality standards.",
  "Bring your own supplies (see the checklist below).",
  "Treat every home and customer with care and professionalism.",
  "Upload before/after photos and mark the job complete when done.",
];

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
        description="Join Novara Cleaning as a Field Tech independent contractor. Watch the role intro, then apply. Evergreen Specialized Contractor and Commercial Cleaner lists also open."
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
            Here&apos;s a quick look at what cleaning with Novara is all about —
            how the work flows, how you get paid, and exactly what you&apos;ll
            need to bring to your first job.
          </p>
          <div className="nv-hire-rise nv-hire-rise-d3 mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <RiMapPin2Line className="h-4 w-4 text-[#8F7BFD]" />
              {field.location}
            </span>
            <span>{field.type}</span>
            <span>{field.pay}</span>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-5 py-14 sm:px-6 sm:py-16">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          <div className="space-y-10">
            {/* Must-watch — before apply */}
            <section className="space-y-3">
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <p className="font-bold uppercase tracking-wide text-amber-800">
                  Must watch before you apply
                </p>
                <p className="mt-1 text-amber-900/90">
                  Watch this short intro first — it covers the role, pay, and what you need to bring.
                  Then submit your application below.
                </p>
              </div>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 shadow-sm">
                <WistiaPlayer mediaId="9toazzorrp" aspect={1.6783216783216783} />
              </div>
              <p className="text-sm text-slate-500">A 2-minute intro to cleaning with Novara.</p>
            </section>

            <section>
              <h2 className="font-jakarta text-2xl font-bold text-slate-900">What the role is</h2>
              <p className="mt-2 text-slate-600">
                You&apos;re an independent cleaning contractor. Novara brings you the customers,
                scheduling, and payments — you bring the supplies and a great clean.
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {HIGHLIGHTS.map((h) => (
                  <div key={h.title} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#5C0FFE]/10 text-[#5C0FFE]">
                        <h.icon className="h-5 w-5" />
                      </span>
                      <div>
                        <p className="font-semibold text-slate-900">{h.title}</p>
                        <p className="mt-0.5 text-sm text-slate-600">{h.body}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
              <h2 className="font-jakarta text-lg font-bold text-slate-900">
                What we expect on every job
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Simple standards that keep our customers happy and our cleaners booked.
              </p>
              <ul className="mt-4 space-y-2">
                {EXPECTATIONS.map((e) => (
                  <li key={e} className="flex items-start gap-2.5 text-sm text-slate-700">
                    <RiCheckboxCircleFill className="mt-0.5 h-4 w-4 shrink-0 text-[#5C0FFE]" />
                    <span>{e}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl border border-[#5C0FFE]/20 bg-[rgba(92,15,254,0.04)] p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ background: HIRING_GRADIENT }}>
                  <RiFileTextLine className="h-6 w-6" />
                </span>
                <div className="flex-1">
                  <h2 className="font-jakarta text-lg font-bold text-slate-900">
                    Download the supply checklist
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-600">
                    As an independent contractor you provide your own supplies. This checklist covers
                    everything you need before your first job.
                  </p>
                </div>
                <a
                  href={SUPPLY_CHECKLIST_PDF}
                  download="Novara-Cleaning-Supply-Checklist.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold text-white"
                  style={{ background: HIRING_GRADIENT }}
                >
                  <RiDownload2Line className="h-4 w-4" />
                  Download PDF
                </a>
              </div>
            </section>

            {/* Evergreen roles */}
            <section id="evergreen" className="scroll-mt-24 space-y-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">
                  Also recruiting
                </p>
                <h2 className="mt-2 font-jakarta text-2xl font-bold text-slate-900">
                  Evergreen contractor lists
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
                  These roles stay open as an{" "}
                  <strong className="font-semibold text-slate-800">active evergreen list</strong> —
                  we review every applicant and select contractors when demand opens.
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

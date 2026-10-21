import Link from "next/link";
import { HiringFooter, HiringNav, HiringShell, HIRING_GRADIENT } from "@/components/hiring/HiringChrome";
import { hiringApplyUrl } from "@/lib/site-hosts";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <HiringShell>
      <HiringNav ctaHref={hiringApplyUrl("?role=turnover-cleaner")} ctaLabel="Apply" />
      <main className="mx-auto max-w-3xl px-5 py-12">
        <Link href="/hiring" className="text-sm font-semibold text-slate-500">All roles</Link>
        <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5C0FFE]">Independent Contractor</p>
        <h1 className="mt-3 font-heading text-4xl font-extrabold">Turnover Cleaner</h1>
        <p className="mt-4 text-lg text-slate-600">Short-term rental and rental-unit turnovers, with same-day windows. The application opens when a pay rate is set.</p>
        <a href={hiringApplyUrl("?role=turnover-cleaner")} className="mt-8 inline-flex h-12 items-center rounded-full px-6 text-sm font-semibold text-white" style={{ background: HIRING_GRADIENT }}>
          Start the Turnover Cleaner application
        </a>
      </main>
      <HiringFooter />
    </HiringShell>
  );
}

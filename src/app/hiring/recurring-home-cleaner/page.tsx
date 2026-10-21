import Link from "next/link";
import { HiringFooter, HiringNav, HiringShell, HIRING_GRADIENT } from "@/components/hiring/HiringChrome";
import { hiringApplyUrl } from "@/lib/site-hosts";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <HiringShell>
      <HiringNav ctaHref={hiringApplyUrl("?role=recurring-home-cleaner")} ctaLabel="Apply" />
      <main className="mx-auto max-w-3xl px-5 py-12">
        <Link href="/hiring" className="text-sm font-semibold text-slate-500">All roles</Link>
        <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5C0FFE]">Independent Contractor</p>
        <h1 className="mt-3 font-heading text-4xl font-extrabold">Recurring Home Cleaner</h1>
        <p className="mt-4 text-lg text-slate-600">Residential only. Weekly and biweekly homes. This track is voluntary. The application opens when a pay rate is set.</p>
        <a href={hiringApplyUrl("?role=recurring-home-cleaner")} className="mt-8 inline-flex h-12 items-center rounded-full px-6 text-sm font-semibold text-white" style={{ background: HIRING_GRADIENT }}>
          Start the Recurring Home Cleaner application
        </a>
      </main>
      <HiringFooter />
    </HiringShell>
  );
}

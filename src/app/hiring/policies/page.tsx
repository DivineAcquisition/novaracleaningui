import type { Metadata } from "next";
import Link from "next/link";
import { RiArrowRightUpLine, RiFileTextLine } from "@/components/icons";
import { HiringFooter, HiringNav, HiringShell } from "@/components/hiring/HiringChrome";
import { hiringPolicyHref } from "@/components/legal/HiringPolicyPage";
import { gutter, shell } from "@/components/landing/primitives";
import { HIRING_CONTACT, HIRING_POLICIES, HIRING_POLICY_UPDATED } from "@/content/hiring-policies";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: { absolute: "Hiring Policies | Novara Cleaning Careers" },
  description: "Privacy, background checks, contractor terms, text messages, and equal opportunity for people who apply to clean with Novara.",
  alternates: { canonical: "https://hiring.novaracleaning.com/policies" },
};

export default function Page() {
  return (
    <HiringShell>
      <div className="landing min-h-screen bg-white font-sans text-ink antialiased">
        <HiringNav ctaHref="/hiring#positions" ctaLabel="Open roles" />
        <main id="main">
          <section className={cn(gutter, "border-b border-line bg-gradient-to-b from-[#F5F0FF] to-white pb-12 pt-12 sm:pt-16")}>
            <div className={shell}>
              <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5A1FD6]">
                <RiFileTextLine className="h-4 w-4" />
                Novara Cleaning careers
              </p>
              <h1 className="mt-3 text-[2.2rem] font-semibold leading-tight tracking-[-0.035em] text-ink sm:text-[3rem]">Hiring policies</h1>
              <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-ink-muted">
                What we collect when you apply, how background checks work, the terms of contractor work, our text messages, and our
                commitment to equal opportunity. Questions: {HIRING_CONTACT}.
              </p>
              <p className="mt-4 text-[13px] text-ink-muted">Last updated {HIRING_POLICY_UPDATED}</p>
            </div>
          </section>
          <section className={cn(gutter, "py-14")}>
            <ul className={cn(shell, "grid gap-4 sm:grid-cols-2 lg:grid-cols-3")}>
              {HIRING_POLICIES.map((p) => (
                <li key={p.slug}>
                  <Link href={hiringPolicyHref(p.slug)} className="group flex h-full flex-col rounded-2xl border border-line bg-white p-6 transition hover:border-[#C9B6FF] hover:shadow-[0_16px_40px_-28px_rgba(104,16,254,0.5)]">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#F3EEFF] text-[#6810FE]">
                      <RiFileTextLine className="h-5 w-5" />
                    </span>
                    <span className="mt-4 flex items-center justify-between gap-2 text-[17px] font-semibold tracking-[-0.01em] text-ink">
                      {p.title}
                      <RiArrowRightUpLine className="h-4 w-4 text-ink-muted transition group-hover:text-[#6810FE]" />
                    </span>
                    <span className="mt-1.5 text-[14px] leading-relaxed text-ink-muted">{p.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </main>
        <HiringFooter />
      </div>
    </HiringShell>
  );
}

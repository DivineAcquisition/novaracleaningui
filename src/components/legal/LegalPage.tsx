// Policy page layout: title, last-updated date, table of contents, the
// policy text, and cards linking the other policies in the same family.
// Header and footer are passed in so customer and hiring policies each keep
// their own site chrome.

import type { ReactNode } from "react";
import Link from "next/link";
import { RiArrowRightUpLine, RiCalendarLine, RiFileTextLine } from "@/components/icons";
import { gutter, shell } from "@/components/landing/primitives";
import { cn } from "@/lib/utils";
import { LegalDocument, legalToc, parseLegal } from "./LegalDocument";

export interface RelatedPolicy {
  title: string;
  href: string;
  summary: string;
}

export function LegalPage({
  eyebrow,
  title,
  summary,
  updated,
  text,
  related,
  header,
  footer,
  notice,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  updated: string;
  text: string;
  related: RelatedPolicy[];
  header: ReactNode;
  footer: ReactNode;
  /** Optional short box above the policy text. */
  notice?: ReactNode;
}) {
  const blocks = parseLegal(text);
  const toc = legalToc(blocks);
  return (
    <div className="landing min-h-screen bg-white font-sans text-ink antialiased">
      {header}
      <main id="main">
        <section className={cn(gutter, "border-b border-line bg-gradient-to-b from-[#F5F0FF] to-white pb-10 pt-12 sm:pt-16")}>
          <div className={shell}>
            <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5A1FD6]">
              <RiFileTextLine className="h-4 w-4" />
              {eyebrow}
            </p>
            <h1 className="mt-3 text-[2.2rem] font-semibold leading-tight tracking-[-0.035em] text-ink sm:text-[3rem]">{title}</h1>
            <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-ink-muted">{summary}</p>
            <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1 text-[13px] text-ink-muted">
              <RiCalendarLine className="h-4 w-4 text-[#6810FE]" />
              Last updated {updated}
            </p>
          </div>
        </section>

        <div className={cn(gutter, "py-12 sm:py-16")}>
          <div className={cn(shell, "grid gap-10 lg:grid-cols-[240px_minmax(0,1fr)]")}>
            {toc.length > 1 ? (
              <nav aria-label="On this page" className="hidden lg:block">
                <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pr-2">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted">On this page</p>
                  <ol className="space-y-1 border-l border-line">
                    {toc.map((h) => (
                      <li key={h.id}>
                        <a href={`#${h.id}`} className="-ml-px block border-l border-transparent py-1 pl-3 text-[13px] leading-snug text-ink-muted transition hover:border-[#6810FE] hover:text-ink">
                          {h.text}
                        </a>
                      </li>
                    ))}
                  </ol>
                </div>
              </nav>
            ) : (
              <div className="hidden lg:block" />
            )}
            <article className="min-w-0 max-w-3xl">
              {notice ? <div className="mb-8">{notice}</div> : null}
              {toc.length > 1 ? (
                <details className="mb-8 rounded-xl border border-line bg-[#FAFAFC] px-4 py-3 lg:hidden">
                  <summary className="cursor-pointer text-[14px] font-medium text-ink">On this page</summary>
                  <ol className="mt-3 space-y-1.5">
                    {toc.map((h) => (
                      <li key={h.id}>
                        <a href={`#${h.id}`} className="text-[13.5px] text-ink-muted hover:text-ink">
                          {h.text}
                        </a>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
              <LegalDocument blocks={blocks} />
            </article>
          </div>
        </div>

        {related.length ? (
          <section aria-labelledby="related-title" className={cn(gutter, "border-t border-line bg-[#FAFAFC] py-14")}>
            <div className={shell}>
              <h2 id="related-title" className="text-[1.3rem] font-semibold tracking-[-0.02em] text-ink">
                Related policies
              </h2>
              <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {related.map((r) => (
                  <li key={r.href}>
                    <Link href={r.href} className="group flex h-full flex-col rounded-2xl border border-line bg-white p-5 transition hover:border-[#C9B6FF]">
                      <span className="flex items-center justify-between gap-2 text-[16px] font-semibold tracking-[-0.01em] text-ink">
                        {r.title}
                        <RiArrowRightUpLine className="h-4 w-4 text-ink-muted transition group-hover:text-[#6810FE]" />
                      </span>
                      <span className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">{r.summary}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}
      </main>
      {footer}
    </div>
  );
}

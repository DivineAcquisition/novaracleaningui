import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SignedOut } from "@/components/docs/SignedOut";
import { getDocsAccess } from "@/lib/docs/auth";
import { getAllDocs, getDoc } from "@/lib/docs/content";
import { docsFlash } from "@/lib/docs/flash";
import { renderDoc } from "@/lib/docs/render";

export const dynamic = "force-dynamic";

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const doc = getDoc(params.slug);
  return {
    title: doc?.title ?? "Guide",
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function DocPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { error?: string };
}) {
  // The gate is repeated here on purpose. A Next.js layout is NOT a security
  // boundary: it and its pages render in parallel, so a layout that returns
  // early still emits the page's HTML into the response. The guide text has
  // to be gated where it is produced.
  const access = await getDocsAccess();
  if (!access.allowed) {
    return <SignedOut reason={access.reason ?? "signed_out"} flash={docsFlash(searchParams.error)} />;
  }

  const doc = getDoc(params.slug);
  if (!doc) notFound();

  const html = renderDoc(doc.body);
  const all = getAllDocs();
  const idx = all.findIndex((d) => d.slug === doc.slug);
  const prev = idx > 0 ? all[idx - 1] : null;
  const next = idx >= 0 && idx < all.length - 1 ? all[idx + 1] : null;

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="mb-4 text-[11px] text-muted-foreground">
        <Link href="/docs" className="hover:text-foreground">
          Workspace guides
        </Link>
        <span className="mx-1.5">/</span>
        <span>{doc.area}</span>
      </nav>

      <header className="mb-6 border-b border-[color:var(--hairline)] pb-5">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">
          {doc.title}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{doc.summary}</p>
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 text-[12px] text-muted-foreground">
          {doc.where && (
            <div className="flex gap-1.5">
              <dt className="font-semibold text-foreground/70">Where:</dt>
              <dd>
                <code className="rounded bg-muted px-1.5 py-0.5">{doc.where}</code>
              </dd>
            </div>
          )}
          <div className="flex gap-1.5">
            <dt className="font-semibold text-foreground/70">Who can see it:</dt>
            <dd>{doc.whoCanSee}</dd>
          </div>
          {doc.lastVerified && (
            <div className="flex gap-1.5">
              <dt className="font-semibold text-foreground/70">Last verified:</dt>
              <dd>{doc.lastVerified}</dd>
            </div>
          )}
        </dl>
      </header>

      {doc.headings.length > 2 && (
        <details className="mb-8 rounded-xl border border-[color:var(--hairline)] bg-muted/30 px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-foreground">
            What's in this guide
          </summary>
          <ul className="mt-2 space-y-1">
            {doc.headings
              .filter((h) => h.level === 2)
              .map((h) => (
                <li key={h.id}>
                  <a
                    href={`#${h.id}`}
                    className="text-sm text-muted-foreground hover:text-primary hover:underline"
                  >
                    {h.text}
                  </a>
                </li>
              ))}
          </ul>
        </details>
      )}

      {/* Repo-authored markdown, reviewed in pull requests — no user input. */}
      <article className="doc-body" dangerouslySetInnerHTML={{ __html: html }} />

      <footer className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-[color:var(--hairline)] pt-6 text-sm">
        {prev ? (
          <Link href={`/docs/${prev.slug}`} className="text-muted-foreground hover:text-primary">
            ← {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`/docs/${next.slug}`} className="text-muted-foreground hover:text-primary">
            {next.title} →
          </Link>
        ) : (
          <span />
        )}
      </footer>
    </div>
  );
}

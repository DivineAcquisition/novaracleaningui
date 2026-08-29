import type { Metadata } from "next";
import Link from "next/link";

import { SignedOut } from "@/components/docs/SignedOut";
import { getDocsAccess } from "@/lib/docs/auth";
import { getDiscrepancies } from "@/lib/docs/discrepancies";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Known discrepancies",
  robots: { index: false, follow: false, nocache: true },
};

export default async function DiscrepanciesPage() {
  // Gated here as well as in the layout — see the note in [slug]/page.tsx.
  const access = await getDocsAccess();
  if (!access.allowed) return <SignedOut reason={access.reason ?? "signed_out"} />;

  const items = getDiscrepancies();
  const drift = items.filter((i) => i.kind === "drift");
  const unverified = items.filter((i) => i.kind === "unverified");

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="mb-4 text-[11px] text-muted-foreground">
        <Link href="/docs" className="hover:text-foreground">
          Workspace guides
        </Link>
        <span className="mx-1.5">/</span>
        <span>Known discrepancies</span>
      </nav>

      <header className="mb-6 border-b border-[color:var(--hairline)] pb-5">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">
          Known discrepancies
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Every place where an existing document, a label on a screen, or an older piece of the
          system disagrees with what the code actually does. These were found while writing the
          guides and are recorded rather than quietly resolved — picking a side without the
          business deciding would just move the error somewhere harder to find.
        </p>
        <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
          This page is assembled from the guides themselves. Fix a discrepancy, remove the note
          from its guide, and it disappears from here.
        </p>
      </header>

      <div className="mb-8 rounded-xl border border-[color:var(--hairline)] border-l-[3px] border-l-[hsl(200,80%,45%)] bg-[hsl(200,80%,45%,0.06)] p-4 text-sm leading-relaxed">
        <p className="font-semibold text-foreground">This list is not complete yet</p>
        <p className="mt-1.5 text-muted-foreground">
          The comparisons below are between the code, the live configuration, and the labels on
          the screens — they were found by reading the system against itself. The policy and
          spec documents in Google Drive were <strong>not</strong> compared, because the Drive
          connection was not available when these guides were written.
        </p>
        <p className="mt-2 text-muted-foreground">
          So: nothing here is speculative, but there may well be more. Someone with Drive access
          should read the guides against the policy and pricing documents and add anything that
          disagrees.
        </p>
      </div>

      {items.length === 0 ? (
        <p className="rounded-xl border border-[color:var(--hairline)] bg-muted/40 p-4 text-sm text-muted-foreground">
          Nothing outstanding. Every guide currently agrees with the code it describes.
        </p>
      ) : (
        <>
          <section>
            <h2 className="font-heading text-xl font-bold tracking-tight text-foreground">
              To reconcile ({drift.length})
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Two sources say different things. Someone needs to decide which is right and change
              the other.
            </p>
            <ul className="mt-4 space-y-4">
              {drift.map((item, i) => (
                <li
                  key={`${item.docSlug}-${i}`}
                  className="rounded-xl border border-[color:var(--hairline)] border-l-[3px] border-l-[hsl(280,70%,50%)] bg-[hsl(280,70%,50%,0.05)] p-4"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <h3 className="font-semibold text-foreground">{item.title}</h3>
                    <Link
                      href={`/docs/${item.docSlug}`}
                      className="text-[11px] text-primary hover:underline"
                    >
                      {item.docTitle} →
                    </Link>
                  </div>
                  <div
                    className="doc-body mt-2 text-sm"
                    dangerouslySetInnerHTML={{ __html: item.html }}
                  />
                </li>
              ))}
            </ul>
          </section>

          {unverified.length > 0 && (
            <section className="mt-10">
              <h2 className="font-heading text-xl font-bold tracking-tight text-foreground">
                Needs confirmation ({unverified.length})
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Behaviour we could not establish by reading the code. Nothing here has been
                guessed at in the guides.
              </p>
              <ul className="mt-4 space-y-4">
                {unverified.map((item, i) => (
                  <li
                    key={`${item.docSlug}-u-${i}`}
                    className="rounded-xl border border-[color:var(--hairline)] border-l-[3px] border-l-[hsl(200,80%,45%)] bg-[hsl(200,80%,45%,0.05)] p-4"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <h3 className="font-semibold text-foreground">{item.title}</h3>
                      <Link
                        href={`/docs/${item.docSlug}`}
                        className="text-[11px] text-primary hover:underline"
                      >
                        {item.docTitle} →
                      </Link>
                    </div>
                    <div
                      className="doc-body mt-2 text-sm"
                      dangerouslySetInnerHTML={{ __html: item.html }}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

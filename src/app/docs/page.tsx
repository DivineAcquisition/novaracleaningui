import Link from "next/link";

import { SignedOut } from "@/components/docs/SignedOut";
import { getDocsAccess } from "@/lib/docs/auth";
import { getAllDocs, getPricingExamples } from "@/lib/docs/content";

export const dynamic = "force-dynamic";

export default async function DocsIndex() {
  // Repeated deliberately — see the note in [slug]/page.tsx. A layout that
  // returns early does not stop its page from rendering into the response.
  const access = await getDocsAccess();
  if (!access.allowed) return <SignedOut reason={access.reason ?? "signed_out"} />;

  const docs = getAllDocs();
  const pricing = getPricingExamples();

  const oldest = docs
    .map((d) => d.lastVerified)
    .filter(Boolean)
    .sort()[0];

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-8">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
          How the tool works
        </p>
        <h1 className="mt-1 font-heading text-3xl font-bold tracking-tight text-foreground">
          Novara workspace guides
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          One guide per section of the admin workspace: what it does, how to use it step by
          step, where the numbers come from, and the things that most often trip people up.
          Everything here was written by reading the code that actually runs, so it describes
          the screen you have in front of you rather than the screen someone once planned.
        </p>
      </header>

      <div className="mb-8 rounded-xl border border-[color:var(--hairline)] bg-muted/40 p-4 text-sm leading-relaxed text-muted-foreground">
        <p>
          <strong className="text-foreground">These are not the policy documents.</strong> The
          policy and pricing knowledge base tells you what we promise a customer and what the
          rules are. These guides tell you which buttons produce that outcome. When the two
          disagree, the policy document wins on what we should do, and these guides win on
          what the software currently does — and anywhere we found the two out of step, the
          guide says so in a marked box.
        </p>
        {oldest && (
          <p className="mt-3">
            Every guide carries the date it was last checked against the code. The oldest in
            the set right now is <strong className="text-foreground">{oldest}</strong>. Screens
            change; if a guide looks wrong, trust the screen and flag the guide.
          </p>
        )}
      </div>

      <Link
        href="/docs/discrepancies"
        className="mb-8 block rounded-xl border border-[color:var(--hairline)] border-l-[3px] border-l-[hsl(280,70%,50%)] bg-[hsl(280,70%,50%,0.06)] p-4 transition-colors hover:bg-[hsl(280,70%,50%,0.1)]"
      >
        <p className="font-semibold text-foreground">Known discrepancies →</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Places where an older document, a label on a screen, or a legacy part of the system
          disagrees with what the code actually does. Collected in one list so they can be
          worked through rather than rediscovered one confused conversation at a time.
        </p>
      </Link>

      <ul className="space-y-3">
        {docs.map((doc) => (
          <li key={doc.slug}>
            <Link
              href={`/docs/${doc.slug}`}
              className="block rounded-xl border border-[color:var(--hairline)] bg-card p-4 transition-colors hover:border-primary/30 hover:bg-brand-50/40"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="font-heading text-base font-semibold tracking-tight text-foreground">
                  {doc.title}
                </h2>
                {doc.where && (
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {doc.where}
                  </code>
                )}
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {doc.whoCanSee}
                </span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{doc.summary}</p>
              {doc.lastVerified && (
                <p className="mt-2 text-[11px] text-muted-foreground/80">
                  Last verified against the code on {doc.lastVerified}
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>

      {pricing && (
        <p className="mt-8 text-[11px] leading-relaxed text-muted-foreground">
          Pricing figures throughout these guides are generated from pricing configuration
          version {pricing.configVersion}, read from the live system on{" "}
          {pricing.snapshotCapturedAt.slice(0, 10)}, and run through the same calculation the
          booking screen uses. They are not typed in by hand.
        </p>
      )}
    </div>
  );
}

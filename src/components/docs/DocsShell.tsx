"use client";

// The documentation shell: a searchable list of guides on the left, the guide
// itself on the right. Search runs over titles, summaries and section
// headings so "why can't I assign this cleaner" finds the Bookings guide's
// hard-stop section without the reader knowing which guide it lives in.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { RiSearchLine, RiCloseLine, RiMenuLine, RiBookOpenLine } from "@remixicon/react";

import { cn } from "@/lib/utils";
import { DOCS_HOME, DOCS_SIGN_OUT } from "@/lib/docs/paths";

export interface DocsNavItem {
  slug: string;
  title: string;
  area: string;
  summary: string;
  whoCanSee: string;
  lastVerified: string;
  headings: string[];
}

export function DocsShell({
  docs,
  viewerEmail,
  children,
}: {
  docs: DocsNavItem[];
  viewerEmail: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((d) =>
      [d.title, d.area, d.summary, ...d.headings].join(" ").toLowerCase().includes(q),
    );
  }, [docs, query]);

  const nav = (
    <>
      <div className="px-4 pt-5 pb-3">
        <Link href={DOCS_HOME} className="flex items-center gap-2">
          <img src="/novara-email-logo.png" alt="Novara" className="h-[20px] w-auto" />
          <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-primary">
            Guides
          </span>
        </Link>
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          How the admin workspace actually works. Internal — do not share outside the team.
        </p>
      </div>

      <div className="px-3 pb-3">
        <div className="relative">
          <RiSearchLine className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the guides…"
            aria-label="Search the guides"
            className="w-full rounded-lg border border-[color:var(--hairline)] bg-background py-2 pl-8 pr-3 text-sm outline-none focus:border-primary/40"
          />
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-5">
        {results.length === 0 && (
          <p className="px-3 py-6 text-sm text-muted-foreground">
            Nothing matches “{query}”. Try the name of the screen instead.
          </p>
        )}
        {results.map((d) => {
          const href = `/docs/${d.slug}`;
          const active = pathname === href;
          return (
            <Link
              key={d.slug}
              href={href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "block rounded-xl px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-brand-50 font-semibold text-primary ring-1 ring-primary/10"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
              )}
            >
              <span className="block leading-tight">{d.title}</span>
              <span className="mt-0.5 block text-[11px] leading-snug opacity-80">{d.summary}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-[color:var(--hairline)] p-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Signed in
        </p>
        <p className="truncate text-xs text-foreground">{viewerEmail}</p>
        <form action={DOCS_SIGN_OUT} method="post" className="mt-2">
          <button
            type="submit"
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground hover:underline"
          >
            Sign out
          </button>
        </form>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen w-full bg-background font-sans text-foreground">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-[color:var(--hairline)] bg-card/60 lg:flex">
        {nav}
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground/30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-[color:var(--hairline)] bg-card transition-transform lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex justify-end p-2">
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Close the guide list"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
          >
            <RiCloseLine className="h-5 w-5" />
          </button>
        </div>
        {nav}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[color:var(--hairline)] bg-background/85 px-4 backdrop-blur-xl sm:px-6">
          <button
            className="rounded-md p-1.5 text-foreground hover:bg-muted lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open the guide list"
          >
            <RiMenuLine className="h-5 w-5" />
          </button>
          <RiBookOpenLine className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold tracking-tight">Workspace guides</span>
          <span className="ml-auto text-[11px] text-muted-foreground">
            Internal · not indexed · admin sign-in required
          </span>
        </header>
        <div className="flex-1 px-4 py-8 sm:px-8">{children}</div>
      </main>
    </div>
  );
}

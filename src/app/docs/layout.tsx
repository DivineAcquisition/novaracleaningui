import type { Metadata } from "next";

import "@/styles/docs.css";
import { DocsShell } from "@/components/docs/DocsShell";
import { getDocsAccess } from "@/lib/docs/auth";
import { getAllDocs } from "@/lib/docs/content";

// Belt and braces alongside the X-Robots-Tag header the middleware sets for
// this host: even if the header were ever dropped by a proxy, the pages
// themselves tell crawlers to stay out.
export const metadata: Metadata = {
  title: {
    default: "Novara Workspace Guides",
    template: "%s · Novara Workspace Guides",
  },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

// The gate reads cookies, so nothing here may be statically rendered.
export const dynamic = "force-dynamic";

export default async function DocsLayout({ children }: { children: React.ReactNode }) {
  const access = await getDocsAccess();
  // When the gate fails, render the page as-is. Pages produce their own
  // SignedOut (the real security boundary — a layout that skips {children}
  // still lets the page run). Skipping DocsShell here keeps the sign-in
  // form off the guides chrome, and lets /docs?error= show the OAuth flash.
  if (!access.allowed) return <>{children}</>;

  const docs = getAllDocs().map((d) => ({
    slug: d.slug,
    title: d.title,
    area: d.area,
    summary: d.summary,
    whoCanSee: d.whoCanSee,
    lastVerified: d.lastVerified,
    headings: d.headings.map((h) => h.text),
  }));

  return (
    <DocsShell docs={docs} viewerEmail={access.viewer.email}>
      {children}
    </DocsShell>
  );
}

"use client";

import { openCookieSettings } from "@/components/compliance/CookieNotice";
import { PUBLIC_SITE } from "@/lib/public-site";

const linkClass = "text-xs text-zinc-700 underline underline-offset-2 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded";

export function SiteLegalFooter() {
  const site = PUBLIC_SITE;
  return (
    <footer className="mt-auto border-t border-zinc-200 bg-zinc-50 px-4 py-6">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-3 text-center">
        <p className="text-xs leading-5 text-zinc-700">
          {site.legalName}
          <br />
          {site.address}
        </p>
        <p className="text-xs leading-5 text-zinc-700">
          <a href={site.phoneTel} className={linkClass}>{site.phoneDisplay}</a>
          <span className="mx-2 text-zinc-400">·</span>
          <a href={`mailto:${site.emails.support}`} className={linkClass}>{site.emails.support}</a>
        </p>
        <nav aria-label="Policies" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          {site.policyLinks.map((link) => (
            <a key={link.href} href={link.href} className={linkClass}>
              {link.label}
            </a>
          ))}
          <button type="button" onClick={openCookieSettings} className={linkClass}>
            Cookie settings
          </button>
        </nav>
        <p className="text-xs text-zinc-500">© {new Date().getFullYear()} {site.legalName}</p>
      </div>
    </footer>
  );
}

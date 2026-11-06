// Site footer shared by every marketing page. Server-safe and client-safe.

import { INBOUND_PHONE, SUPPORT_PHONE } from "@/config/brand-config";
import { FOOTER } from "@/lib/landing/content";
import { cn } from "@/lib/utils";
import { CookieSettingsLink } from "./Chrome";
import { gutter, shell } from "./primitives";

export function SiteFooter() {
  return (
    <footer className={cn(gutter, "border-t border-line bg-[#F6F5F9] pb-28 pt-14 md:pb-10")}>
      <div className={shell}>
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <span className="flex items-center gap-2.5">
              <img src="/novara-logo.png" alt="" width={40} height={40} className="h-10 w-10 rounded-[10px]" />
              <span className="text-[17px] font-semibold tracking-[-0.02em] text-ink">Novara Cleaning</span>
            </span>
            <p className="mt-4 text-[14.5px] text-ink-muted">{FOOTER.tagline}</p>
            <p className="mt-3 text-[12.5px] leading-relaxed text-ink-muted">{FOOTER.company}</p>
            <p className="mt-3 space-y-1 text-[13px] text-ink-muted">
              <a href={INBOUND_PHONE.tel} className="block hover:text-ink">Booking: {INBOUND_PHONE.display}</a>
              <a href={SUPPORT_PHONE.tel} className="block hover:text-ink">Support: {SUPPORT_PHONE.display}</a>
            </p>
          </div>
          {FOOTER.columns.map((col) => (
            <div key={col.title}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink">{col.title}</p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a href={l.href} className="text-[14px] text-ink-muted hover:text-ink">
                      {l.label}
                    </a>
                  </li>
                ))}
                {col.title === "Legal" ? (
                  <li>
                    <CookieSettingsLink />
                  </li>
                ) : null}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-[12.5px] text-ink-muted">
          <span>© {new Date().getFullYear()} Novara Cleaning LLC</span>
          <span>support@novaracleaning.com</span>
        </div>
      </div>
    </footer>
  );
}

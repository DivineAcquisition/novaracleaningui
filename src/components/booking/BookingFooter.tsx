"use client";

import { openCookieSettings } from "@/components/compliance/CookieNotice";

const linkClass =
  "hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded";

export function BookingFooter({ licenseLine = "" }: { licenseLine?: string }) {
  return (
    <footer className="mt-auto border-t border-[color:var(--hairline)] bg-background/60 px-4 py-6">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-3 text-center text-sm text-muted-foreground">
        {licenseLine ? <p>{licenseLine}</p> : null}
        <p>© {new Date().getFullYear()} Novara Cleaning LLC</p>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <a href="https://novaracleaning.com/privacy" target="_blank" rel="noopener noreferrer" className={linkClass}>Privacy Policy</a>
          <a href="https://novaracleaning.com/terms" target="_blank" rel="noopener noreferrer" className={linkClass}>Terms</a>
          <a href="https://novaracleaning.com/refund-policy" target="_blank" rel="noopener noreferrer" className={linkClass}>Refund Policy</a>
          <a href="https://novaracleaning.com/cancellation-policy" target="_blank" rel="noopener noreferrer" className={linkClass}>Cancellation Policy</a>
          <a href="/privacy-request" className={linkClass}>Privacy request</a>
          <button type="button" onClick={openCookieSettings} className={linkClass}>Cookie settings</button>
        </div>
      </div>
    </footer>
  );
}

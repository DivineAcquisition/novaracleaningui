"use client";

// Cal.com 15-minute discovery calendar for unusual rental units and for
// larger portfolios that want a stable crew. Same event the rest of intake
// already uses: malik-sannie-clwphb/15min. The banner is an invitation, not
// a unit-count cutoff — typical units still Claim This Rate.

import { useEffect, useId, useRef } from "react";
import { RiCalendarCheckLine } from "@remixicon/react";
import { BRAND } from "@/lib/brand";
import {
  CALENDAR_BANNER,
  PORTFOLIO_CAL_LINK,
  PORTFOLIO_CAL_NAMESPACE,
  PORTFOLIO_CAL_ORIGIN,
} from "@/lib/property-manager/landing";

type CalFn = {
  (...args: unknown[]): void;
  ns?: Record<string, CalFn>;
  loaded?: boolean;
  q?: unknown[];
  config?: { forwardQueryParams?: boolean };
};

declare global {
  interface Window {
    Cal?: CalFn;
  }
}

function ensureCal(): void {
  if (typeof window === "undefined") return;
  if (window.Cal) return;
  const C = window;
  const A = "https://app.cal.com/embed/embed.js";
  const L = "init";
  const p = (a: CalFn, ar: IArguments | unknown[]) => {
    a.q = a.q || [];
    a.q.push(ar);
  };
  const d = C.document;
  C.Cal =
    C.Cal ||
    (function calBootstrap(this: unknown) {
      const cal = C.Cal as CalFn;
      const ar = arguments;
      if (!cal.loaded) {
        cal.ns = {};
        cal.q = cal.q || [];
        d.head.appendChild(d.createElement("script")).src = A;
        cal.loaded = true;
      }
      if (ar[0] === L) {
        const api = function nsApi() {
          p(api as unknown as CalFn, arguments);
        } as unknown as CalFn;
        const namespace = ar[1];
        api.q = api.q || [];
        if (typeof namespace === "string") {
          cal.ns = cal.ns || {};
          cal.ns[namespace] = cal.ns[namespace] || api;
          p(cal.ns[namespace], ar);
          p(cal, ["initNamespace", namespace]);
        } else {
          p(cal, ar);
        }
        return;
      }
      p(cal, ar);
    } as unknown as CalFn);
}

export function PortfolioCalEmbed({
  name,
  email,
  notes,
}: {
  name?: string;
  email?: string;
  notes?: string;
}) {
  const reactId = useId().replace(/:/g, "");
  const elementId = `portfolio-cal-${reactId}`;
  const mounted = useRef(false);

  useEffect(() => {
    ensureCal();
    const Cal = window.Cal;
    if (!Cal) return;
    Cal.config = Cal.config || {};
    Cal.config.forwardQueryParams = true;
    Cal("init", PORTFOLIO_CAL_NAMESPACE, { origin: PORTFOLIO_CAL_ORIGIN });
    const ns = Cal.ns?.[PORTFOLIO_CAL_NAMESPACE];
    if (!ns) return;
    if (mounted.current) return;
    mounted.current = true;
    const config: Record<string, string> = {
      layout: "month_view",
      useSlotsViewOnSmallScreen: "true",
    };
    if (name?.trim()) config.name = name.trim();
    if (email?.trim()) config.email = email.trim();
    if (notes?.trim()) config.notes = notes.trim();
    ns("inline", {
      elementOrSelector: `#${elementId}`,
      calLink: PORTFOLIO_CAL_LINK,
      config,
    });
    ns("ui", { hideEventTypeDetails: false, layout: "month_view" });
  }, [elementId, name, email, notes]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      <div
        className="flex gap-3 border-b border-primary/20 bg-primary/[0.06] px-4 py-3 md:px-5 md:py-4"
        data-testid="portfolio-cal-banner"
      >
        <div
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ background: BRAND.gradient }}
        >
          <RiCalendarCheckLine className="h-4 w-4" />
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
            {CALENDAR_BANNER.eyebrow}
          </p>
          <p className="mt-1 font-heading text-base font-bold leading-snug md:text-lg">
            {CALENDAR_BANNER.title}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {CALENDAR_BANNER.body}
          </p>
        </div>
      </div>
      <div className="h-[720px] w-full md:h-[800px]">
        <div id={elementId} className="h-full w-full overflow-auto" />
      </div>
    </div>
  );
}

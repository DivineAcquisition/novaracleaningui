"use client";

// Cal.com 15-minute discovery calendar for unusual rental units.
// Same event the rest of intake already uses: malik-sannie-clwphb/15min.

import { useEffect, useId, useRef } from "react";
import {
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
    <div className="h-[720px] w-full overflow-hidden rounded-xl border border-border bg-background md:h-[800px]">
      <div id={elementId} className="h-full w-full overflow-auto" />
    </div>
  );
}

"use client";

// Cal.com 15-minute discovery calendar for the PM /portfolio landing.
// Official inline embed: malik-sannie-clwphb/15min, month view.

import { useEffect } from "react";
import Cal, { getCalApi } from "@calcom/embed-react";

export const PORTFOLIO_CAL_NAMESPACE = "15min";
export const PORTFOLIO_CAL_LINK = "malik-sannie-clwphb/15min";
export const PORTFOLIO_CAL_ORIGIN = "https://app.cal.com";

export function PortfolioCalEmbed({
  name,
  email,
  notes,
}: {
  name?: string;
  email?: string;
  notes?: string;
}) {
  useEffect(() => {
    void (async () => {
      const cal = await getCalApi({ namespace: PORTFOLIO_CAL_NAMESPACE });
      const CalGlobal = (window as Window & { Cal?: { config?: { forwardQueryParams?: boolean } } }).Cal;
      if (CalGlobal) {
        CalGlobal.config = CalGlobal.config || {};
        CalGlobal.config.forwardQueryParams = true;
      }
      cal("ui", { hideEventTypeDetails: false, layout: "month_view" });
    })();
  }, []);

  const config: Record<string, string> = {
    layout: "month_view",
    useSlotsViewOnSmallScreen: "true",
  };
  if (name?.trim()) config.name = name.trim();
  if (email?.trim()) config.email = email.trim();
  if (notes?.trim()) config.notes = notes.trim();

  return (
    <div className="h-[720px] w-full overflow-hidden rounded-xl border border-border bg-background md:h-[800px]">
      <Cal
        namespace={PORTFOLIO_CAL_NAMESPACE}
        calLink={PORTFOLIO_CAL_LINK}
        calOrigin={PORTFOLIO_CAL_ORIGIN}
        style={{ width: "100%", height: "100%", overflow: "scroll" }}
        config={config}
      />
    </div>
  );
}

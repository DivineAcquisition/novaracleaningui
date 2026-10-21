"use client";

import { useEffect } from "react";
import { isProductionNovaraHost } from "@/lib/site-hosts";

/** If this page is opened on another Novara host, move it to the host that owns it. */
export function StayOnHost({ host, origin }: { host: string; origin: string }) {
  useEffect(() => {
    const current = window.location.hostname.toLowerCase();
    if (isProductionNovaraHost(current) && current !== host) {
      window.location.replace(`${origin}${window.location.pathname}${window.location.search}${window.location.hash}`);
    }
  }, [host, origin]);
  return null;
}

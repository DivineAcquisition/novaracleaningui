"use client";

// Phone-only bar that keeps Call and Get my price under the thumb. It hides
// while the hero booking card is on screen so it never covers the form.

import { useEffect, useState } from "react";
import { RiPhoneLine } from "@remixicon/react";
import { INBOUND_PHONE } from "@/config/brand-config";
import { cn } from "@/lib/utils";
import { scrollToBooking } from "./PriceExplorer";

export function StickyMobileBar() {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    const card = document.getElementById("get-price");
    if (!card || typeof IntersectionObserver === "undefined") {
      setHidden(false);
      return;
    }
    const io = new IntersectionObserver((entries) => setHidden(entries.some((e) => e.isIntersecting)), {
      threshold: 0.1,
    });
    io.observe(card);
    return () => io.disconnect();
  }, []);

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 grid grid-cols-[1fr_1.5fr] gap-2 border-t border-border bg-background/95 px-3 pt-2 backdrop-blur transition-transform duration-200 md:hidden",
        "pb-[max(0.5rem,env(safe-area-inset-bottom))]",
        hidden ? "translate-y-full" : "translate-y-0",
      )}
      aria-hidden={hidden}
    >
      <a
        href={INBOUND_PHONE.tel}
        tabIndex={hidden ? -1 : 0}
        className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-border bg-background font-semibold text-foreground"
      >
        <RiPhoneLine className="h-5 w-5 text-primary" aria-hidden="true" />
        Call
      </a>
      <button
        type="button"
        tabIndex={hidden ? -1 : 0}
        onClick={scrollToBooking}
        className="inline-flex h-12 items-center justify-center rounded-lg bg-primary font-semibold text-primary-foreground"
      >
        Get my price
      </button>
    </div>
  );
}

"use client";

import { SiteLegalFooter } from "@/components/site/SiteLegalFooter";

export function BookingFooter({ licenseLine = "" }: { licenseLine?: string }) {
  return (
    <div>
      {licenseLine ? (
        <p className="px-4 pt-4 text-center text-xs text-zinc-700">{licenseLine}</p>
      ) : null}
      <SiteLegalFooter />
    </div>
  );
}

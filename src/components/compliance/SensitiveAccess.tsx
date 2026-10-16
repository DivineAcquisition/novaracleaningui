"use client";

import { useState } from "react";

/** Access details stay masked until someone who needs them chooses to view them. */
export function SensitiveAccess({
  bookingId,
  value,
  viewerRole,
}: {
  bookingId?: string | null;
  value: string;
  viewerRole: "admin" | "cleaner";
}) {
  const [shown, setShown] = useState(false);

  const reveal = () => {
    setShown(true);
    void fetch("/api/compliance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "access_view",
        bookingId: bookingId || null,
        viewerRole,
        purpose: "view access details",
      }),
    }).catch(() => undefined);
  };

  if (!shown) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span>Access details are hidden.</span>
        <button
          type="button"
          onClick={reveal}
          className="text-xs font-semibold text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          Show access details
        </button>
      </span>
    );
  }

  return <span className="whitespace-pre-wrap break-words">{value}</span>;
}

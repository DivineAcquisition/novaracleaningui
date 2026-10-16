"use client";

import { buildPriceBreakdown, type PriceBreakdownInput } from "@/lib/compliance";

function money(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

export function PriceBreakdown(props: PriceBreakdownInput) {
  const breakdown = buildPriceBreakdown(props);
  return (
    <div className="space-y-2 text-sm" aria-label="Price breakdown">
      {breakdown.lines
        .filter((line) => line.kind !== "due_now" && line.kind !== "due_later")
        .map((line) => (
          <div key={line.label} className="flex items-baseline justify-between">
            <span>{line.label}</span>
            <span className="font-medium tabular-nums">{money(line.amount)}</span>
          </div>
        ))}
      <div className="flex items-baseline justify-between border-t border-border pt-2">
        <span className="font-semibold">Total</span>
        <span className="font-semibold tabular-nums">{money(breakdown.total)}</span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="font-semibold">Due now</span>
        <span className="text-lg font-bold tabular-nums">{money(breakdown.dueNow)}</span>
      </div>
      {breakdown.dueLater > 0 ? (
        <div className="flex items-baseline justify-between rounded-md border border-border px-3 py-2">
          <span>
            Balance due later
            {breakdown.dueLaterWhen ? <span className="block text-xs text-muted-foreground">{breakdown.dueLaterWhen}</span> : null}
          </span>
          <span className="font-semibold tabular-nums">{money(breakdown.dueLater)}</span>
        </div>
      ) : null}
    </div>
  );
}

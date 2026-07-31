"use client";

// ─── PriceBreakdownCard ─────────────────────────────────────────────────────
//
// The internal-transparency panel on the VA booking rail. Unlike a public
// checkout, the VA sees the FULL layered breakdown — base, condition, zone,
// demand, surcharges, clamps — each with a plain-language reason, because
// they have to state the price to a customer and defend it if questioned.
// The customer hears one price; these internals are never read aloud.

import { format } from "date-fns";
import {
  RiArrowDownLine,
  RiArrowUpLine,
  RiCalendarLine,
  RiErrorWarningLine,
  RiEyeLine,
  RiLock2Line,
  RiMapPin2Line,
  RiShieldCheckLine,
} from "@remixicon/react";

import { cn } from "@/lib/utils";
import type { QuoteBreakdown, BreakdownLine } from "@/lib/dynamic-pricing";
import type { DynamicQuoteState } from "@/hooks/use-dynamic-quote";

const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const fmtSigned = (cents: number) => `${cents < 0 ? "−" : "+"}${fmtMoney(Math.abs(cents))}`;

function LineRow({ line }: { line: BreakdownLine }) {
  const isBase = line.kind === "base";
  const isClamp = line.kind === "clamp" || line.kind === "minimum";
  const isInfo = line.kind === "info";
  return (
    <div className="py-1.5">
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "text-xs",
            isBase ? "font-semibold text-slate-800" : "text-slate-700",
            isClamp && "font-semibold text-amber-800",
          )}
        >
          {isClamp && <RiShieldCheckLine className="inline w-3 h-3 mr-1 -mt-0.5" />}
          {line.label}
          {line.multiplier != null && (
            <span className="ml-1.5 text-[10px] font-mono text-slate-400">×{line.multiplier}</span>
          )}
        </span>
        <span
          className={cn(
            "text-xs font-semibold tabular-nums shrink-0",
            isBase ? "text-slate-900" : line.amountCents > 0 ? "text-slate-800" : line.amountCents < 0 ? "text-emerald-700" : "text-slate-400",
          )}
        >
          {isBase ? fmtMoney(line.amountCents) : isInfo && line.amountCents === 0 ? "—" : fmtSigned(line.amountCents)}
        </span>
      </div>
      <p className={cn("text-[10.5px] leading-snug mt-0.5", isClamp ? "text-amber-700" : "text-slate-400")}>
        {line.reason}
      </p>
    </div>
  );
}

export function PriceBreakdownCard({
  quote,
  onPickDate,
}: {
  quote: DynamicQuoteState;
  onPickDate?: (isoDate: string) => void;
}) {
  // Outside all served zones → clear message + waitlist, never a wrong price.
  if (!quote.served) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
        <p className="text-xs font-semibold text-rose-800 flex items-center gap-1.5">
          <RiErrorWarningLine className="w-4 h-4" /> Area not served — no quote
        </p>
        <p className="text-[11px] text-rose-700 mt-1 leading-relaxed">{quote.waitlistMessage}</p>
        <p className="text-[10.5px] text-rose-600 mt-1.5">
          Tell the customer plainly and offer the waitlist — never guess a price for an unserved address.
        </p>
      </div>
    );
  }

  const b: QuoteBreakdown | null = quote.breakdown;
  if (!b) {
    // No layered quote — the rail is showing the legacy fallback price, which
    // carries no zone, condition, or demand. Say so plainly: a VA must never
    // read out a number believing it is the zone-priced quote when it isn't.
    if (quote.error) {
      return (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
            <RiErrorWarningLine className="w-4 h-4" /> Zone pricing unavailable
          </p>
          <p className="text-[11px] text-amber-800 mt-1 leading-relaxed">{quote.error}</p>
          <p className="text-[10.5px] text-amber-700 mt-1.5">
            The total below is the fallback catalog price — it has no zone, condition, or demand
            applied. Check with admin before quoting it.
          </p>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      {/* Zone + lock header */}
      <div className="flex items-center justify-between px-3 pt-2.5">
        <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-violet-700 bg-violet-50 border border-violet-100 rounded-full px-2 py-0.5">
          <RiMapPin2Line className="w-3 h-3" />
          Zone {b.zoneCode}
          {quote.zone?.multiplier != null && ` · ×${quote.zone.multiplier}`}
          {quote.zone?.defaulted && " · unmapped zip → default"}
        </span>
        {quote.lock && (
          <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-emerald-700">
            <RiLock2Line className="w-3 h-3" />
            Locked until {format(new Date(quote.lock.lockedUntil), "MMM d, h:mm a")}
          </span>
        )}
      </div>

      {/* Expired-lock reprice — never silently charge something different */}
      {quote.reprice && quote.reprice.deltaCents !== 0 && (
        <div className="mx-3 mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2">
          <p className="text-[11px] font-semibold text-amber-900 flex items-center gap-1">
            {quote.reprice.deltaCents > 0 ? <RiArrowUpLine className="w-3.5 h-3.5" /> : <RiArrowDownLine className="w-3.5 h-3.5" />}
            Quote lock expired — price changed {fmtSigned(quote.reprice.deltaCents)}
          </p>
          <p className="text-[10.5px] text-amber-800 mt-0.5">
            Was {fmtMoney(quote.reprice.previousCents)}, now {fmtMoney(quote.reprice.newCents)}. Re-state the new
            price to the customer before booking.
          </p>
        </div>
      )}

      {/* Layered breakdown */}
      <div className="px-3 pb-1 pt-1 divide-y divide-slate-100">
        {b.lines.map((line) => (
          <LineRow key={line.key} line={line} />
        ))}
      </div>

      {/* Shadow-mode note */}
      {b.demandMode === "shadow" && quote.demand && (
        <div className="mx-3 mb-2 rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5 text-[10.5px] text-slate-500 flex items-start gap-1.5">
          <RiEyeLine className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Reactive pricing is in <strong>shadow mode</strong> — it would apply ×
            {quote.demand.multiplier.toFixed(2)}
            {quote.demand.reasons.length > 0 && <> ({quote.demand.reasons.join(" · ")})</>}, but the customer is
            charged the zone price only.
          </span>
        </div>
      )}

      {/* Cheaper alternative dates — offer a date instead of a discount */}
      {quote.alternatives.length > 0 && onPickDate && (
        <div className="mx-3 mb-2.5 rounded-lg bg-emerald-50 border border-emerald-100 px-2.5 py-2">
          <p className="text-[10.5px] font-semibold text-emerald-800 flex items-center gap-1 mb-1">
            <RiCalendarLine className="w-3 h-3" /> Cheaper dates to offer
          </p>
          <div className="flex flex-wrap gap-1.5">
            {quote.alternatives.map((a) => (
              <button
                key={a.serviceDate}
                type="button"
                onClick={() => onPickDate(a.serviceDate)}
                className="text-[10.5px] font-semibold text-emerald-800 bg-white border border-emerald-200 rounded-full px-2 py-0.5 hover:bg-emerald-100 transition-colors"
              >
                {format(new Date(`${a.serviceDate}T12:00:00`), "EEE MMM d")} · {fmtMoney(a.totalCents)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

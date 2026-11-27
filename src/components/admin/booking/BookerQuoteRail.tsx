"use client";

// ─── Booker quote rail pieces ─────────────────────────────────────────────
//
// Display only: every amount arrives already calculated (deriveQuoteLines
// over the engine breakdown, or the legacy fallback). Nothing here prices.

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";

import { RiCheckLine, RiFileCopyLine, RiLinkM, RiLock2Line, RiErrorWarningLine } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QuoteLines, RecurringTotals } from "@/lib/booker-quote";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function Row({ label, value, muted, detail, strong }: { label: string; value: string; muted?: boolean; detail?: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-0.5">
      <span className={cn("min-w-0 text-[12.5px]", muted ? "text-slate-500" : "text-slate-700", strong && "font-semibold text-slate-900")}>
        {label}
        {detail ? <span className="ml-1 text-[11px] text-slate-400">· {detail}</span> : null}
      </span>
      <span className={cn("shrink-0 text-[12.5px] tabular-nums", muted ? "text-slate-500" : "text-slate-800", strong && "font-semibold")}>{value}</span>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-1.5">
      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{title}</p>
      {children}
    </div>
  );
}

export function BookerQuoteLines({
  lines,
  recurring,
  perVisitLabel,
}: {
  lines: QuoteLines;
  recurring?: RecurringTotals | null;
  perVisitLabel?: string;
}) {
  return (
    <div className="space-y-1" data-testid="booker-quote-lines">
      {recurring ? (
        // Recurring: the per-visit price already contains the add-ons, so
        // they are itemised underneath rather than added on top.
        <Row label={perVisitLabel || lines.service.label} value={`${money(recurring.laterVisitsCents)} / visit`} strong />
      ) : (
        <Row label={lines.service.label} value={money(lines.service.cents)} strong />
      )}
      {lines.charged.length > 0 && (
        <Block title={recurring ? `In each visit · ${lines.charged.length} add-on${lines.charged.length === 1 ? "" : "s"}` : `Add-ons · ${lines.charged.length}`}>
          {lines.charged.map((l) => (
            <Row key={l.key} label={l.label} detail={l.detail} value={recurring ? money(l.cents) : `+${money(l.cents)}`} muted={!!recurring} />
          ))}
        </Block>
      )}
      {lines.included.length > 0 && (
        <Block title={`Included · ${lines.included.length}`}>
          {lines.included.map((l) => (
            <Row key={l.key} label={l.label} detail={l.detail} value="Included" muted />
          ))}
        </Block>
      )}
      {lines.surcharges.length > 0 && (
        <Block title="Surcharges">
          {lines.surcharges.map((l) => (
            <Row key={l.key} label={l.label} value={`+${money(l.cents)}`} />
          ))}
        </Block>
      )}
      {lines.adjustments.length > 0 && (
        <Block title="Adjustments">
          {lines.adjustments.map((l) => (
            <Row key={l.key} label={l.label} detail={l.detail} value={`${l.cents < 0 ? "−" : "+"}${money(Math.abs(l.cents))}`} />
          ))}
        </Block>
      )}
      {recurring && recurring.firstVisitDeepCents > 0 && (
        <Block title="First visit only">
          <Row label="First-visit deep clean (Glow)" value={`+${money(recurring.firstVisitDeepCents)}`} />
        </Block>
      )}
      {lines.unpriced.length > 0 && (
        <div className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
          <RiErrorWarningLine className="mr-1 inline h-3 w-3" aria-hidden />
          On this record but not priced by the current engine: {lines.unpriced.map((l) => l.label).join(", ")}. Remove it or
          price it through a scope adjustment on the job.
        </div>
      )}
    </div>
  );
}

export function BookerTotals({
  oneTime,
  recurring,
}: {
  oneTime?: { totalCents: number; dueTodayCents: number; remainingCents: number } | null;
  recurring?: RecurringTotals | null;
}) {
  const cells = recurring
    ? [
        { label: "First visit", value: money(recurring.firstVisitCents) },
        { label: "Later visits", value: money(recurring.laterVisitsCents) },
        { label: "Cadence", value: recurring.cadenceLabel },
      ]
    : oneTime
      ? [
          { label: "Total", value: money(oneTime.totalCents) },
          { label: "Due today", value: money(oneTime.dueTodayCents) },
          { label: "Remaining balance", value: money(oneTime.remainingCents) },
        ]
      : [];
  return (
    <dl className="grid grid-cols-3 gap-1.5 pt-1" data-testid="booker-totals">
      {cells.map((c, i) => (
        <div key={c.label} className={cn("rounded-lg border px-2 py-1.5", i === 0 ? "border-violet-200 bg-violet-50" : "border-slate-200 bg-slate-50")}>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{c.label}</dt>
          <dd className={cn("text-[13px] font-bold tabular-nums text-slate-900", i === 0 && "text-violet-900")}>{c.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function LockStatus({
  savedQuoteId,
  lockedUntil,
  reprice,
}: {
  savedQuoteId: string | null;
  lockedUntil?: string | null;
  reprice?: { previousCents: number; newCents: number; deltaCents: number } | null;
}) {
  if (lockedUntil && new Date(lockedUntil).getTime() > Date.now()) {
    return (
      <p className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-900">
        <RiLock2Line className="h-3 w-3" aria-hidden />
        Price locked until {format(new Date(lockedUntil), "MMM d, h:mm a")}. Changing property, service, extras or date
        requires repricing.
      </p>
    );
  }
  if (savedQuoteId || reprice) {
    return (
      <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
        <RiErrorWarningLine className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        <span>
          {reprice
            ? `Lock expired — repriced from ${money(reprice.previousCents)} to ${money(reprice.newCents)}. Tell the customer before booking.`
            : "No live price lock. The price shown is today's price; save the quote again to hold it."}
        </span>
      </p>
    );
  }
  return null;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CopySummaryButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-full text-slate-700"
      onClick={async () => {
        if (await copy(text)) {
          setDone(true);
          window.setTimeout(() => setDone(false), 2000);
        }
      }}
    >
      {done ? <RiCheckLine className="mr-1.5 h-3.5 w-3.5" /> : <RiFileCopyLine className="mr-1.5 h-3.5 w-3.5" />}
      {done ? "Summary copied" : "Copy quote summary"}
    </Button>
  );
}

/**
 * After "Save as quote": a resume link any admin or VA can open (the booker
 * route is admin-or-VA; va_quotes RLS is is_admin_or_va). Full admins also get
 * the Quotes index, which stays admin_strict.
 */
export function SavedQuotePanel({ quoteId, isAdmin }: { quoteId: string; isAdmin: boolean }) {
  const [copied, setCopied] = useState(false);
  const href = `/admin/csr?quoteId=${encodeURIComponent(quoteId)}`;
  return (
    <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-[11.5px] text-emerald-900" role="status">
      <p className="font-semibold">Quote saved · {quoteId.slice(0, 8)}</p>
      <p className="mt-0.5 text-emerald-800">Resume it from this link on the next call — the details and any price lock come back.</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button asChild size="sm" variant="secondary" className="h-7 px-2 text-xs">
          <Link href={href}>Reopen quote</Link>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={async () => {
            if (await copy(`${window.location.origin}${href}`)) {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            }
          }}
        >
          <RiLinkM className="mr-1 h-3 w-3" />
          {copied ? "Link copied" : "Copy resume link"}
        </Button>
        {isAdmin ? (
          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
            <Link href="/admin/quotes">All quotes</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Below xl the rail drops under the form; this bar keeps the price in view. */
export function CompactQuoteBar({ label, amountCents, sub, loading }: { label: string; amountCents: number; sub?: string; loading?: boolean }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-2 shadow-[0_-8px_24px_-16px_rgba(15,23,42,0.35)] backdrop-blur xl:hidden" data-testid="compact-quote-bar">
      <a href="#bk-quote" className="mx-auto flex max-w-[1240px] items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
          {sub ? <span className="block truncate text-[11px] text-slate-500">{sub}</span> : null}
        </span>
        <span className="text-lg font-bold tabular-nums text-slate-900" aria-live="polite">
          {loading ? "…" : money(amountCents)}
        </span>
      </a>
    </div>
  );
}

export type OutcomeState = "done" | "waiting" | "todo" | "failed";

export interface OutcomeItem {
  key: "booking" | "payment" | "staffing" | "next";
  label: string;
  state: OutcomeState;
  detail: string;
  href?: string;
  hrefLabel?: string;
}

const OUTCOME_STYLE: Record<OutcomeState, { dot: string; text: string; word: string }> = {
  done: { dot: "bg-emerald-500", text: "text-emerald-800", word: "Done" },
  waiting: { dot: "bg-amber-500", text: "text-amber-800", word: "Waiting" },
  todo: { dot: "bg-slate-400", text: "text-slate-700", word: "To do" },
  failed: { dot: "bg-red-500", text: "text-red-700", word: "Needs attention" },
};

/**
 * Completion summary that keeps four separate questions separate: was the
 * booking (or plan) created, where is payment, is it staffed, and what
 * should the operator do next.
 */
export function BookingOutcome({ items, warnings }: { items: OutcomeItem[]; warnings?: string[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4" data-testid="booking-outcome">
      <ol className="space-y-2.5">
        {items.map((item) => {
          const st = OUTCOME_STYLE[item.state];
          return (
            <li key={item.key} className="flex items-start gap-2.5">
              <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", st.dot)} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-slate-900">
                  {item.label} <span className={cn("ml-1 text-[11px] font-medium", st.text)}>· {st.word}</span>
                </p>
                <p className="text-[12px] text-slate-600">{item.detail}</p>
              </div>
              {item.href ? (
                <Button asChild size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs">
                  <Link href={item.href}>{item.hrefLabel || "Open"}</Link>
                </Button>
              ) : null}
            </li>
          );
        })}
      </ol>
      {warnings && warnings.length > 0 ? (
        <ul className="mt-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11.5px] text-amber-900">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

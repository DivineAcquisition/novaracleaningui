"use client";

// ─── /pay-balance/[token] — settle the final balance ─────────────────────────
//
// The clean has happened and the number may have moved since the estimate:
// add-ons performed on site, a scope adjustment. So this page answers "what am
// I paying for?" before it asks for money — the work summary and a line-by-line
// breakdown come first, the card form last. A customer who can't reconstruct
// the figure disputes it.

import { Elements } from "@stripe/react-stripe-js";
import type { Stripe } from "@stripe/stripe-js";
import {
  RiCheckboxCircleFill,
  RiCheckLine,
  RiErrorWarningLine,
  RiImage2Line,
  RiLoader4Line,
} from "@remixicon/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StripePaymentForm } from "@/components/booking/StripePaymentForm";
import { getStripePromise } from "@/lib/stripe-client";
import { cn } from "@/lib/utils";

const money = (cents: number | null | undefined) =>
  cents == null ? "—" : `$${(cents / 100).toFixed(2)}`;

interface LineItem {
  label: string;
  amountCents: number | null;
  note?: string;
  kind: "service" | "addon" | "adjustment" | "credit";
}

interface Summary {
  booking: {
    id: string;
    ref: string;
    firstName: string;
    email: string;
    serviceLabel: string;
    serviceDate: string | null;
    timeSlot: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    completedAt: string | null;
  };
  items: LineItem[];
  finalTotalCents: number;
  depositPaidCents: number;
  addonCapturedCents?: number;
  completionCapturedCents?: number;
  alreadyPaidCents?: number;
  balanceDueCents: number;
  checklist: { completedItems: number; totalItems: number; progressPct: number } | null;
  beforePhotos: number;
  afterPhotos: number;
  paid: boolean;
  paidAmountCents: number | null;
}

function prettyDate(d: string | null): string {
  if (!d) return "";
  const parsed = new Date(`${d}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export default function BalancePayPage() {
  const params = useParams();
  const token = String(params?.token || "");

  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [justPaid, setJustPaid] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/bookings/balance/${token}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setLoadError(data?.error || "This payment link isn't valid.");
        setSummary(null);
      } else {
        setSummary(data as Summary);
        setLoadError(null);
      }
    } catch {
      setLoadError("We couldn't load your booking. Please check your connection and retry.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const startPayment = useCallback(async () => {
    setStarting(true);
    setPayError(null);
    try {
      const res = await fetch(`/api/bookings/balance/${token}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not start the payment.");
      if (data.paid) {
        setJustPaid(true);
        return;
      }
      // Same key resolution as /pay — env when present, edge fallback otherwise.
      // loadStripe("") silently fails and leaves the Payment Element blank.
      setStripePromise(getStripePromise());
      setClientSecret(data.clientSecret as string);
    } catch (e) {
      setPayError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }, [token]);

  const isPaid = justPaid || summary?.paid === true;
  const nothingDue = !!summary && summary.balanceDueCents <= 0;

  // Start the intent as soon as we know there's something to collect, so the
  // card form is ready by the time they've read the breakdown.
  useEffect(() => {
    if (summary && !isPaid && !nothingDue && !clientSecret && !starting) {
      void startPayment();
    }
  }, [summary, isPaid, nothingDue, clientSecret, starting, startPayment]);

  const addressLine = useMemo(() => {
    if (!summary) return "";
    const b = summary.booking;
    return [b.address, b.city, b.state].filter(Boolean).join(", ");
  }, [summary]);

  if (loading) {
    return (
      <main className="mx-auto max-w-lg p-4 space-y-4">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </main>
    );
  }

  if (loadError || !summary) {
    return (
      <main className="mx-auto max-w-lg p-4">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
          <p className="flex items-center gap-2 font-semibold text-rose-900">
            <RiErrorWarningLine className="h-5 w-5" />
            We couldn&apos;t open this link
          </p>
          <p className="mt-1 text-sm text-rose-800">{loadError}</p>
          <p className="mt-3 text-sm text-rose-800">
            Call or text us at{" "}
            <a className="font-semibold underline" href="tel:+18334432004">
              (833) 443-2004
            </a>
            .
          </p>
        </div>
      </main>
    );
  }

  const b = summary.booking;

  return (
    <main className="mx-auto max-w-lg p-4 space-y-4 pb-16">
      {/* What was done, and what it comes to */}
      <header className="rounded-2xl bg-gradient-to-br from-violet-600 to-purple-500 p-5 text-white shadow-md">
        <p className="text-xs uppercase tracking-wide text-violet-100">{b.ref}</p>
        <h1 className="mt-1 font-jakarta text-xl font-bold leading-tight">
          {isPaid || nothingDue
            ? `Thanks, ${b.firstName || "there"} — you're all settled`
            : `Your clean is complete, ${b.firstName || "there"}`}
        </h1>
        <p className="mt-1 text-sm text-violet-100">
          {b.serviceLabel}
          {b.serviceDate ? ` · ${prettyDate(b.serviceDate)}` : ""}
        </p>
        {addressLine ? (
          <p className="text-sm text-violet-100">{addressLine}</p>
        ) : null}

        <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-white/15 p-3 text-center">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-violet-100">Total</p>
            <p className="text-sm font-bold">{money(summary.finalTotalCents)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-violet-100">Already paid</p>
            <p className="text-sm font-bold">
              {money(summary.alreadyPaidCents ?? summary.depositPaidCents)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-violet-100">
              {isPaid || nothingDue ? "Balance" : "Due now"}
            </p>
            <p className="text-sm font-bold">
              {isPaid || nothingDue ? "$0.00" : money(summary.balanceDueCents)}
            </p>
          </div>
        </div>
      </header>

      {/* Proof the work happened, before we ask for money */}
      {(summary.checklist || summary.beforePhotos > 0 || summary.afterPhotos > 0) && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">What we completed</h2>
          {summary.checklist && summary.checklist.totalItems > 0 ? (
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>Cleaning checklist</span>
                <span className="tabular-nums">
                  {summary.checklist.completedItems}/{summary.checklist.totalItems} tasks
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={cn(
                    "h-full rounded-full",
                    summary.checklist.progressPct >= 100 ? "bg-emerald-500" : "bg-violet-500",
                  )}
                  style={{ width: `${Math.min(100, summary.checklist.progressPct)}%` }}
                />
              </div>
            </div>
          ) : null}
          {summary.beforePhotos > 0 || summary.afterPhotos > 0 ? (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-600">
              <RiImage2Line className="h-4 w-4 text-slate-400" />
              {summary.beforePhotos} before &amp; {summary.afterPhotos} after photos on file
            </p>
          ) : null}
        </section>
      )}

      {/* The number, line by line */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">How your total was calculated</h2>
        <ul className="mt-3 space-y-2">
          {summary.items.map((item, i) => (
            <li key={`${item.label}-${i}`} className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm text-slate-800">
                  {item.kind === "addon" ? (
                    <RiCheckLine className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  ) : null}
                  {item.label}
                </span>
                {item.note ? (
                  <span className="block text-xs text-slate-500">{item.note}</span>
                ) : null}
              </span>
              <span
                className={cn(
                  "shrink-0 text-sm tabular-nums",
                  (item.amountCents ?? 0) < 0 ? "text-emerald-700" : "text-slate-900",
                )}
              >
                {item.amountCents == null
                  ? "—"
                  : `${item.amountCents < 0 ? "−" : ""}${money(Math.abs(item.amountCents))}`}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-3 space-y-1.5 border-t border-slate-200 pt-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">Total for the clean</span>
            <span className="font-semibold tabular-nums">{money(summary.finalTotalCents)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Deposit already paid</span>
            <span className="tabular-nums text-emerald-700">
              −{money(summary.depositPaidCents)}
            </span>
          </div>
          {(summary.addonCapturedCents ?? 0) > 0 ? (
            <div className="flex justify-between">
              <span className="text-slate-600">Add-ons already paid</span>
              <span className="tabular-nums text-emerald-700">
                −{money(summary.addonCapturedCents)}
              </span>
            </div>
          ) : null}
          {(summary.completionCapturedCents ?? 0) > 0 ? (
            <div className="flex justify-between">
              <span className="text-slate-600">Completion already captured</span>
              <span className="tabular-nums text-emerald-700">
                −{money(summary.completionCapturedCents)}
              </span>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-slate-200 pt-1.5 text-base">
            <span className="font-semibold text-slate-900">Balance due</span>
            <span className="font-bold tabular-nums text-slate-900">
              {isPaid || nothingDue ? "$0.00" : money(summary.balanceDueCents)}
            </span>
          </div>
        </div>
      </section>

      {/* Payment */}
      {isPaid || nothingDue ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
          <RiCheckboxCircleFill className="mx-auto h-10 w-10 text-emerald-600" />
          <p className="mt-2 font-semibold text-emerald-900">
            {nothingDue && !isPaid ? "Nothing left to pay" : "Payment received"}
          </p>
          <p className="mt-1 text-sm text-emerald-800">
            {nothingDue && !isPaid
              ? "Your balance is fully covered. Thank you!"
              : "Thank you — your balance is settled. A receipt is on its way to your email."}
          </p>
        </section>
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Pay your balance — {money(summary.balanceDueCents)}
          </h2>

          {payError ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
              <p className="text-xs text-rose-800">{payError}</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => void startPayment()}>
                Try again
              </Button>
            </div>
          ) : null}

          {!payError && (starting || !clientSecret || !stripePromise) ? (
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <RiLoader4Line className="h-3.5 w-3.5 animate-spin" />
              Preparing secure payment…
            </p>
          ) : null}

          {clientSecret && stripePromise ? (
            <Elements stripe={stripePromise} options={{ clientSecret }}>
              <StripePaymentForm
                amount={summary.balanceDueCents}
                customerEmail={b.email}
                clientSecret={clientSecret}
                bookingId={b.id}
                returnUrl={`/pay-balance/${token}`}
                onSuccess={() => {
                  setJustPaid(true);
                  void load();
                }}
                onRetry={() => void startPayment()}
              />
            </Elements>
          ) : null}

          <p className="text-[11px] leading-relaxed text-slate-500">
            Payments are processed securely by Stripe. Questions about this total? Text us at{" "}
            <a className="underline" href="tel:+18334432004">
              (833) 443-2004
            </a>{" "}
            before paying and we&apos;ll walk through it with you.
          </p>
        </section>
      )}
    </main>
  );
}

"use client";

// Price explorer: the landing page's "instant pricing" made visible. Every
// number is read from the active pricing config (see src/lib/landing/data.ts).
// It shows the starting price before ZIP and home condition; the exact price
// is produced by the booking flow, which the CTA hands off to.

import { useEffect, useMemo, useState } from "react";
import { RiArrowRightLine, RiTimeLine, RiUserLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LandingPlan, LandingPrices, LandingServiceType } from "@/lib/landing/data";
import { dollars, useAnimatedNumber, useReducedMotion } from "./shared";

const SERVICES: Array<{ id: LandingServiceType; label: string; hint: string }> = [
  { id: "standard", label: "Standard", hint: "Regular upkeep" },
  { id: "deep", label: "Deep", hint: "Detail work, built-up grime" },
  { id: "moveInOut", label: "Move-in/out", hint: "Empty home, inside everything" },
];

type Frequency = "once" | LandingPlan;
const FREQUENCIES: Array<{ id: Frequency; label: string }> = [
  { id: "once", label: "One time" },
  { id: "monthly", label: "Monthly" },
  { id: "biweekly", label: "Every 2 weeks" },
  { id: "weekly", label: "Weekly" },
];

const PLAN_LABEL: Record<LandingPlan, string> = {
  monthly: "Monthly",
  biweekly: "Every-2-weeks",
  weekly: "Weekly",
};

const FIRST_VISIT_OFFER: Partial<Record<LandingServiceType, string>> = {
  standard: "15% off",
  deep: "25% off",
};

interface Line {
  key: string;
  label: string;
  amount: string;
  tone?: "muted" | "total";
}

export function scrollToBooking() {
  const card = document.getElementById("get-price");
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => document.getElementById("zipCode")?.focus({ preventScroll: true }), 450);
}

export function PriceExplorer({ prices }: { prices: LandingPrices }) {
  const reduced = useReducedMotion();
  const defaultBand =
    prices.bands.find((b) => b.id === "1000_1500")?.id || prices.bands[0]?.id || "";
  const [bandId, setBandId] = useState(defaultBand);
  const [service, setService] = useState<LandingServiceType>("standard");
  const [frequency, setFrequency] = useState<Frequency>("once");
  const [extras, setExtras] = useState<string[]>([]);
  const [pricing, setPricing] = useState(false);

  const band = prices.bands.find((b) => b.id === bandId) || prices.bands[0];
  const isPlan = service === "standard" && frequency !== "once";
  const planRates = useMemo(
    () => prices.membership[bandId] || { monthly: null, biweekly: null, weekly: null },
    [prices, bandId],
  );

  // Memberships are a standard-clean rail; reset if the choice stops existing.
  useEffect(() => {
    if (service !== "standard" && frequency !== "once") setFrequency("once");
  }, [service, frequency]);
  useEffect(() => {
    if (frequency !== "once" && planRates[frequency] == null) setFrequency("once");
  }, [bandId, frequency, planRates]);

  const { lines, totalCents, totalSuffix } = useMemo(() => {
    const out: Line[] = [];
    if (!band) return { lines: out, totalCents: 0, totalSuffix: "" };
    if (isPlan) {
      const plan = frequency as LandingPlan;
      const monthly = planRates[plan] || 0;
      out.push({
        key: `plan-${plan}-${band.id}`,
        label: `${PLAN_LABEL[plan]} membership · ${band.label}`,
        amount: `${dollars(monthly)}/mo`,
      });
      if (prices.firstMonthFeeCents > 0) {
        out.push({
          key: "first-month",
          label: "First month starts with a deep clean",
          amount: `+${dollars(prices.firstMonthFeeCents)} once`,
          tone: "muted",
        });
      }
      return { lines: out, totalCents: monthly, totalSuffix: "/mo" };
    }
    const base = prices.base[band.id]?.[service] || 0;
    const svc = SERVICES.find((s) => s.id === service)!;
    out.push({ key: `base-${service}-${band.id}`, label: `${svc.label} clean · ${band.label}`, amount: dollars(base) });
    let total = base;
    for (const id of extras) {
      const addOn = prices.addOns.find((a) => a.id === id);
      if (!addOn) continue;
      const free = service === "moveInOut" && addOn.includedWithMoveOut;
      out.push({
        key: `addon-${id}-${service}`,
        label: addOn.label,
        amount: free ? "Included" : `+${dollars(addOn.cents)}`,
        tone: free ? "muted" : undefined,
      });
      if (!free) total += addOn.cents;
    }
    return { lines: out, totalCents: total, totalSuffix: "" };
  }, [band, isPlan, frequency, planRates, prices, service, extras]);

  // A short "pricing" beat on each change so the receipt reads as recalculated.
  const signature = lines.map((l) => l.key).join("|");
  useEffect(() => {
    if (reduced) return;
    setPricing(true);
    const t = window.setTimeout(() => setPricing(false), 380);
    return () => window.clearTimeout(t);
  }, [signature, reduced]);

  const animatedTotal = useAnimatedNumber(totalCents, reduced);
  const toggleExtra = (id: string) =>
    setExtras((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  if (!band) return null;
  const offer = !isPlan ? FIRST_VISIT_OFFER[service] : undefined;

  return (
    <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
      {/* Controls */}
      <div className="space-y-6 rounded-2xl border border-border bg-card p-5 md:p-6">
        <div className="space-y-2">
          <label htmlFor="pe-size" className="block text-sm font-semibold text-foreground">
            Home size
          </label>
          <select
            id="pe-size"
            value={bandId}
            onChange={(e) => setBandId(e.target.value)}
            className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {prices.bands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <RiTimeLine className="h-3.5 w-3.5" aria-hidden="true" />
              About {band.hours} hours
            </span>
            <span className="inline-flex items-center gap-1">
              <RiUserLine className="h-3.5 w-3.5" aria-hidden="true" />
              {band.crewSize === 1 ? "1 cleaner" : `${band.crewSize}-person crew`}
            </span>
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-foreground">Type of clean</legend>
          <div className="grid grid-cols-3 gap-2">
            {SERVICES.map((s) => (
              <label key={s.id} className="relative cursor-pointer">
                <input
                  type="radio"
                  name="pe-service"
                  value={s.id}
                  checked={service === s.id}
                  onChange={() => setService(s.id)}
                  className="peer sr-only"
                />
                <span className="flex h-full flex-col gap-0.5 rounded-xl border border-border bg-background px-2.5 py-2.5 text-center transition-colors peer-checked:border-primary peer-checked:bg-primary/[0.06] peer-checked:ring-1 peer-checked:ring-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                  <span className="text-sm font-semibold text-foreground">{s.label}</span>
                  <span className="text-[11px] leading-tight text-muted-foreground">{s.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {service === "standard" && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-foreground">How often</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {FREQUENCIES.map((f) => {
                const unavailable = f.id !== "once" && planRates[f.id] == null;
                return (
                  <label key={f.id} className={cn("relative", unavailable ? "cursor-not-allowed opacity-50" : "cursor-pointer")}>
                    <input
                      type="radio"
                      name="pe-frequency"
                      value={f.id}
                      checked={frequency === f.id}
                      disabled={unavailable}
                      onChange={() => setFrequency(f.id)}
                      className="peer sr-only"
                    />
                    <span className="block rounded-xl border border-border bg-background px-2 py-2.5 text-center text-sm font-semibold text-foreground transition-colors peer-checked:border-primary peer-checked:bg-primary/[0.06] peer-checked:ring-1 peer-checked:ring-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                      {f.label}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        {!isPlan && prices.addOns.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-foreground">Extras</legend>
            <div className="flex flex-wrap gap-2">
              {prices.addOns.map((a) => {
                const free = service === "moveInOut" && a.includedWithMoveOut;
                return (
                  <label key={a.id} className="cursor-pointer">
                    <input
                      type="checkbox"
                      checked={extras.includes(a.id)}
                      onChange={() => toggleExtra(a.id)}
                      className="peer sr-only"
                    />
                    <span className="inline-block rounded-full border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors peer-checked:border-foreground peer-checked:bg-foreground peer-checked:text-background peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                      {a.label} {free ? "· included" : `+${dollars(a.cents)}`}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}
      </div>

      {/* Receipt */}
      <div className="flex flex-col rounded-2xl border border-border bg-card p-5 md:p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="font-heading text-base font-bold text-foreground">Your price, line by line</p>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" aria-hidden="true">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                pricing ? "animate-pulse bg-primary" : "bg-emerald-600",
              )}
            />
            {pricing ? "Pricing…" : "Starting price"}
          </span>
        </div>

        <ul className="flex-1 divide-y divide-dashed divide-border text-sm">
          {lines.map((line, i) => (
            <li
              key={line.key}
              className="flex justify-between gap-4 py-2.5 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1"
              style={{ animationDelay: reduced ? undefined : `${i * 90}ms`, animationFillMode: "both" }}
            >
              <span className={line.tone === "muted" ? "text-muted-foreground" : "text-foreground"}>
                {line.label}
              </span>
              <span
                className={cn(
                  "tabular-nums",
                  line.tone === "muted" ? "text-muted-foreground" : "font-medium text-foreground",
                )}
              >
                {line.amount}
              </span>
            </li>
          ))}
          {lines.length === 1 && !isPlan && (
            <li className="py-2.5 text-xs text-muted-foreground">Extras you pick show up here.</li>
          )}
        </ul>

        <div className="mt-2 flex items-baseline justify-between border-t border-foreground pt-3">
          <span className="font-heading font-bold text-foreground">
            {isPlan ? "Per month" : "Starting at"}
          </span>
          <span className="font-heading text-3xl font-extrabold tabular-nums text-foreground" aria-live="polite">
            {dollars(Math.round(animatedTotal / 100) * 100)}
            {totalSuffix && <span className="text-base font-semibold text-muted-foreground">{totalSuffix}</span>}
          </span>
        </div>

        {offer && (
          <p className="mt-3 rounded-lg bg-primary/[0.06] px-3 py-2 text-sm text-foreground">
            New customers get <strong>{offer}</strong> their first {service === "deep" ? "deep" : "standard"} clean,
            applied when you book.
          </p>
        )}
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Your ZIP code and your home&rsquo;s condition can change this. You see the exact price before you pay.
        </p>
        <Button size="lg" className="mt-4 h-12 w-full font-semibold" onClick={scrollToBooking}>
          Get my exact price
          <RiArrowRightLine className="ml-2 h-5 w-5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

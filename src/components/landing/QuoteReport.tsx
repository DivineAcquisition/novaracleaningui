"use client";

// "Every price shows its math." The starting price, line by line, with each
// line labelled by where it comes from. All amounts are read from the active
// booking flow's price tables (src/lib/landing/data.ts), which do not vary by ZIP.

import { useEffect, useMemo, useState } from "react";
import { RiArrowRightLine, RiTimeLine, RiUserLine } from "@remixicon/react";
import { onlineDiscountPct, type LandingPlan, type LandingPrices, type LandingServiceType } from "@/lib/landing/prices";
import { QUOTE_REPORT } from "@/lib/landing/content";
import { cn } from "@/lib/utils";
import { dollars } from "./format";
import { scrollToBooking, useAnimatedNumber, useReducedMotion } from "./motion";
import { Chip, type ChipTone, Section, btnPrimary } from "./primitives";

const SERVICES: Array<{ id: LandingServiceType; label: string }> = [
  { id: "standard", label: "Standard" },
  { id: "deep", label: "Deep" },
  { id: "moveInOut", label: "Move-in/out" },
];
type Frequency = "once" | LandingPlan;
const FREQUENCIES: Array<{ id: Frequency; label: string }> = [
  { id: "once", label: "One time" },
  { id: "monthly", label: "Monthly" },
  { id: "biweekly", label: "Every 2 weeks" },
  { id: "weekly", label: "Weekly" },
];
const PLAN_NAME: Record<LandingPlan, string> = { monthly: "Monthly", biweekly: "Every-2-weeks", weekly: "Weekly" };


type Kind = (typeof QUOTE_REPORT.kinds)[number]["id"];
const KIND_TONE: Record<Kind, ChipTone> = { base: "good", extra: "brand", plan: "solid", offer: "neutral" };
const KIND_LABEL = Object.fromEntries(QUOTE_REPORT.kinds.map((k) => [k.id, k.label])) as Record<Kind, string>;

interface Line {
  key: string;
  label: string;
  value: string;
  kind: Kind;
  muted?: boolean;
}

function Segmented<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
  disabled,
}: {
  name: string;
  legend: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  disabled?: (id: T) => boolean;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[12px] font-medium text-ink-muted">{legend}</legend>
      <div className="flex flex-wrap gap-1 rounded-[10px] border border-line bg-[#F6F5F9] p-1">
        {options.map((o) => {
          const off = disabled?.(o.id) ?? false;
          return (
            <label key={o.id} className={cn("relative", off ? "cursor-not-allowed opacity-40" : "cursor-pointer")}>
              <input
                type="radio"
                name={name}
                value={o.id}
                checked={value === o.id}
                disabled={off}
                onChange={() => onChange(o.id)}
                className="peer sr-only"
              />
              <span className="block rounded-[7px] px-3 py-1.5 text-[13.5px] font-medium text-ink-muted transition peer-checked:bg-white peer-checked:text-ink peer-checked:shadow-[0_1px_3px_rgba(11,10,17,0.12)] peer-focus-visible:ring-2 peer-focus-visible:ring-[#6810FE]">
                {o.label}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function QuoteReport({ prices }: { prices: LandingPrices }) {
  const reduced = useReducedMotion();
  const defaultBand = prices.bands.find((b) => b.id === "1000_1500")?.id || prices.bands[0]?.id || "";
  const [bandId, setBandId] = useState(defaultBand);
  const [service, setService] = useState<LandingServiceType>("standard");
  const [frequency, setFrequency] = useState<Frequency>("once");
  const [extras, setExtras] = useState<string[]>(["oven"]);

  const band = prices.bands.find((b) => b.id === bandId) || prices.bands[0];
  const plans = useMemo(() => prices.membership[bandId] || { monthly: null, biweekly: null, weekly: null }, [prices, bandId]);
  const isPlan = service === "standard" && frequency !== "once";

  useEffect(() => {
    if (service !== "standard" && frequency !== "once") setFrequency("once");
  }, [service, frequency]);
  useEffect(() => {
    if (frequency !== "once" && plans[frequency] == null) setFrequency("once");
  }, [frequency, plans]);

  const { lines, total, suffix } = useMemo(() => {
    const out: Line[] = [];
    if (!band) return { lines: out, total: 0, suffix: "" };
    if (isPlan) {
      const plan = frequency as LandingPlan;
      const monthly = plans[plan] || 0;
      out.push({ key: `plan-${plan}`, label: `${PLAN_NAME[plan]} membership · ${band.label}`, value: `${dollars(monthly)}/mo`, kind: "plan" });
      if (prices.firstMonthFeeCents > 0) {
        out.push({ key: "first", label: "First month starts with a deep clean", value: `+${dollars(prices.firstMonthFeeCents)} once`, kind: "extra", muted: true });
      }
      return { lines: out, total: monthly, suffix: "/mo" };
    }
    const base = prices.base[band.id]?.[service] || 0;
    const name = SERVICES.find((s) => s.id === service)!.label;
    out.push({ key: `base-${service}`, label: `${name} clean · ${band.label}`, value: dollars(base), kind: "base" });
    let sum = base;
    for (const id of extras) {
      const a = prices.addOns.find((x) => x.id === id);
      if (!a) continue;
      const free = service === "moveInOut" && a.includedWithMoveOut;
      out.push({ key: `x-${id}`, label: a.label, value: free ? "Included" : `+${dollars(a.cents)}`, kind: "extra", muted: free });
      if (!free) sum += a.cents;
    }
    const pct = onlineDiscountPct(service);
    if (pct) {
      const off = Math.round((base * pct) / 100);
      out.push({ key: "offer", label: `Online discount, ${pct}% off the clean`, value: `−${dollars(off)}`, kind: "offer" });
      sum -= off;
    }
    return { lines: out, total: sum, suffix: "" };
  }, [band, isPlan, frequency, plans, prices, service, extras]);

  const shownTotal = useAnimatedNumber(total, reduced);
  if (!band) return null;

  return (
    <Section id={QUOTE_REPORT.id} headline={QUOTE_REPORT.headline} lead={QUOTE_REPORT.lead}>
      <div className="grid items-start gap-6 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_0_72px_-30px_rgba(104,16,254,0.5)]">
          <div className="relative border-b border-line p-5">
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-[#6810FE]/[0.08] to-transparent" />
            <div className="relative">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5A1FD6]">{QUOTE_REPORT.frameLabel}</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div>
                  <label htmlFor="qr-size" className="mb-1.5 block text-[12px] font-medium text-ink-muted">
                    {QUOTE_REPORT.controls.size}
                  </label>
                  <select
                    id="qr-size"
                    value={bandId}
                    onChange={(e) => setBandId(e.target.value)}
                    className="h-10 w-full rounded-[10px] border border-line bg-white px-3 text-[14px] font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6810FE]"
                  >
                    {prices.bands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 flex gap-4 text-[12px] text-ink-muted">
                    <span className="inline-flex items-center gap-1">
                      <RiTimeLine className="h-3.5 w-3.5" aria-hidden="true" /> About {band.hours} hours
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <RiUserLine className="h-3.5 w-3.5" aria-hidden="true" /> {band.crewSize === 1 ? "1 cleaner" : `${band.crewSize}-person crew`}
                    </span>
                  </p>
                </div>
                <Segmented<LandingServiceType> name="qr-service" legend={QUOTE_REPORT.controls.service} options={SERVICES} value={service} onChange={setService} />
              </div>
              {service === "standard" ? (
                <div className="mt-4">
                  <Segmented<Frequency>
                    name="qr-frequency"
                    legend={QUOTE_REPORT.controls.frequency}
                    options={FREQUENCIES}
                    value={frequency}
                    onChange={setFrequency}
                    disabled={(id) => id !== "once" && plans[id as LandingPlan] == null}
                  />
                </div>
              ) : null}
              {!isPlan ? (
                <fieldset className="mt-4">
                  <legend className="mb-1.5 text-[12px] font-medium text-ink-muted">{QUOTE_REPORT.controls.extras}</legend>
                  <div className="flex flex-wrap gap-1.5">
                    {prices.addOns.map((a) => (
                      <label key={a.id} className="cursor-pointer">
                        <input
                          type="checkbox"
                          checked={extras.includes(a.id)}
                          onChange={() => setExtras((cur) => (cur.includes(a.id) ? cur.filter((x) => x !== a.id) : [...cur, a.id]))}
                          className="peer sr-only"
                        />
                        <span className="inline-block rounded-full border border-line bg-white px-2.5 py-1 text-[12.5px] text-ink transition peer-checked:border-[#C9B6FF] peer-checked:bg-[#F3EEFF] peer-checked:text-[#4A0CD0] peer-focus-visible:ring-2 peer-focus-visible:ring-[#6810FE]">
                          {a.label} · {dollars(a.cents)}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
            </div>
          </div>

          <ul>
            {lines.map((line) => (
              <li key={line.key} className="flex flex-col gap-2 border-b border-line px-5 py-3.5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
                <span className={cn("text-[14.5px]", line.muted ? "text-ink-muted" : "text-ink")}>{line.label}</span>
                <span className="flex items-center gap-2">
                  <Chip tone={KIND_TONE[line.kind]}>{KIND_LABEL[line.kind]}</Chip>
                  <span className={cn("min-w-[84px] text-right text-[14.5px] tabular-nums", line.muted ? "text-ink-muted" : "font-medium text-ink")}>{line.value}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-ink bg-[#FAFAFC] px-5 py-4">
            <div>
              <p className="text-[12.5px] text-ink-muted">{isPlan ? QUOTE_REPORT.totalPlan : QUOTE_REPORT.totalOnce}</p>
              <p className="text-[32px] font-medium leading-none tracking-[-0.03em] tabular-nums text-ink" aria-live="polite">
                {dollars(Math.round(shownTotal))}
                {suffix ? <span className="text-[16px] text-ink-muted">{suffix}</span> : null}
              </p>
            </div>
            <button type="button" onClick={scrollToBooking} className={btnPrimary}>
              {QUOTE_REPORT.cta}
              <RiArrowRightLine className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <ul className="space-y-2.5">
          {QUOTE_REPORT.kinds.map((k) => (
            <li key={k.id} className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 shadow-[0_16px_40px_-32px_rgba(11,10,17,0.35)]">
              <Chip tone={KIND_TONE[k.id]} className="text-[12px]">
                {k.label}
              </Chip>
              <span className="text-[14px] text-ink-muted">{k.body}</span>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

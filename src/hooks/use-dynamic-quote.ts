"use client";

// ─── useDynamicQuote ────────────────────────────────────────────────────────
//
// Server-side quote for the internal booking screen. The price is computed by
// the `quote-dynamic-price` edge function — the same code path `book-as-va`
// charges — so the number the VA reads to the customer is the number that
// gets billed.
//
// Session-hold rule: a quote is fetched when the pricing INPUTS change
// (property, service, timing, location) and only then. There is no polling
// and no background refresh, so a price on screen never moves while the VA
// is mid-booking. Locked quotes (savedQuoteId) short-circuit to the recorded
// price until the lock expires or the deal changes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import type { QuoteBreakdown } from "@/lib/dynamic-pricing";

export interface DynamicQuoteMeta {
  configVersion: number;
  demandEnabled: boolean;
  shadowMode: boolean;
  conditionMultipliers: Record<string, number>;
  overrideReasons: Array<{ code: string; label: string }>;
  overrideBandPercent: number;
  quoteLockHours: number;
  baseTables: { authoritative: string; reconciled: boolean };
  /** Area catalog + minimum, sourced from focused_same_day_settings. */
  focusedClean: {
    areas: Array<{ id: string; label: string; price_cents: number; quantity: boolean }>;
    minimum_cents: number;
    bundle_discount_percent: number;
    demand_enabled: boolean;
  };
  sameDayCents: number;
  /** True when focused rates + same-day fee came from the shared settings row. */
  focusedSettingsLinked: boolean;
}

export interface DynamicQuoteState {
  loading: boolean;
  error: string | null;
  /** False → the address is outside all served zones (waitlist message). */
  served: boolean;
  waitlistMessage: string | null;
  breakdown: QuoteBreakdown | null;
  zone: { code: string; name?: string; multiplier?: number; travel_minutes?: number | null; defaulted?: boolean } | null;
  demand: {
    mode: string;
    multiplier: number;
    target: number;
    reasons: string[];
  } | null;
  alternatives: Array<{ serviceDate: string; demandMultiplier: number; totalCents: number }>;
  meta: DynamicQuoteMeta | null;
  /** Set when this response honored an existing lock. */
  lock: { quoteId: string; lockedUntil: string; quotedPriceCents: number } | null;
  /** Set when an expired lock was re-priced — show the VA the delta. */
  reprice: { previousCents: number; newCents: number; deltaCents: number } | null;
}

export interface DynamicQuoteInputs {
  zip: string;
  serviceType: string;
  homeSizeId: string | null;
  focused: { selections: Array<{ areaId: string; quantity: number }> } | null;
  condition: "light" | "standard" | "heavy";
  addOns: string[];
  serviceDate: string | null; // yyyy-MM-dd
  membershipPlan?: "none" | "monthly" | "biweekly" | "weekly";
  firstMonth?: boolean;
  csrName?: string;
  /** Existing locked quote to honor (from Save-as-quote / ?quoteId=). */
  quoteId?: string | null;
  /** Skip fetching entirely (e.g. recurring rail handles its own pricing). */
  enabled?: boolean;
}

export interface LockCustomer {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  bedrooms?: number | null;
  bathrooms?: number | null;
  notes?: string | null;
}

const EMPTY: DynamicQuoteState = {
  loading: false,
  error: null,
  served: true,
  waitlistMessage: null,
  breakdown: null,
  zone: null,
  demand: null,
  alternatives: [],
  meta: null,
  lock: null,
  reprice: null,
};

export function useDynamicQuote(inputs: DynamicQuoteInputs): DynamicQuoteState & {
  refresh: () => void;
  lockQuote: (
    customer: LockCustomer,
  ) => Promise<{ quoteId: string; lockedUntil: string; quotedPriceCents: number } | null>;
} {
  const [state, setState] = useState<DynamicQuoteState>(EMPTY);
  const requestSeq = useRef(0);
  const [refreshTick, setRefreshTick] = useState(0);

  // The quote request is keyed by pricing inputs ONLY — property, service,
  // timing, location. Customer identity plays no part in the price.
  const key = useMemo(
    () =>
      JSON.stringify([
        inputs.zip, inputs.serviceType, inputs.homeSizeId, inputs.focused,
        inputs.condition, [...inputs.addOns].sort(), inputs.serviceDate,
        inputs.membershipPlan || "none", inputs.firstMonth || false,
        inputs.quoteId || null, inputs.enabled !== false,
      ]),
    [inputs.zip, inputs.serviceType, inputs.homeSizeId, inputs.focused, inputs.condition, inputs.addOns, inputs.serviceDate, inputs.membershipPlan, inputs.firstMonth, inputs.quoteId, inputs.enabled],
  );

  useEffect(() => {
    if (inputs.enabled === false) {
      setState(EMPTY);
      return;
    }
    const zip = inputs.zip.replace(/\D/g, "");
    if (zip.length !== 5) {
      setState({ ...EMPTY, breakdown: null });
      return;
    }
    // A focused quote with nothing picked yet is still sent: the server
    // answers with the "pick at least one area" message AND the area catalog
    // the picker needs to render, so the UI never has to hold its own copy of
    // the rates.
    if (inputs.serviceType !== "focused" && !inputs.homeSizeId) return;

    const seq = ++requestSeq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    const t = setTimeout(async () => {
      try {
        const { data, error } = await supabase.functions.invoke("quote-dynamic-price", {
          body: {
            action: "quote",
            zip,
            serviceType: inputs.serviceType,
            homeSizeId: inputs.serviceType === "focused" ? null : inputs.homeSizeId,
            focused: inputs.serviceType === "focused" ? inputs.focused : null,
            condition: inputs.condition,
            addOns: inputs.addOns,
            serviceDate: inputs.serviceDate,
            membershipPlan: inputs.membershipPlan || "none",
            firstMonth: inputs.firstMonth,
            csrName: inputs.csrName,
            quoteId: inputs.quoteId || undefined,
            includeAlternatives: true,
          },
        });
        if (seq !== requestSeq.current) return; // superseded — hold the newer price
        if (error) throw error;
        if (data?.waitlist) {
          setState({
            ...EMPTY,
            served: false,
            waitlistMessage: data.message || "We don't currently serve this area.",
            meta: data.meta || null,
          });
          return;
        }
        if (!data?.ok) {
          setState({ ...EMPTY, error: data?.message || data?.error || "Could not price this quote.", meta: data?.meta || null, zone: data?.zone || null });
          return;
        }
        setState({
          loading: false,
          error: null,
          served: true,
          waitlistMessage: null,
          breakdown: data.breakdown,
          zone: data.zone,
          demand: data.demand
            ? { mode: data.demand.mode, multiplier: data.demand.multiplier, target: data.demand.target, reasons: data.demand.reasons || [] }
            : null,
          alternatives: data.alternatives || [],
          meta: data.meta || null,
          lock: data.lock || null,
          reprice: data.reprice || null,
        });
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : "Quote failed.",
        }));
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshTick]);

  const refresh = useCallback(() => setRefreshTick((n) => n + 1), []);

  const lockQuote = useCallback(
    async (customer: LockCustomer) => {
      const zip = inputs.zip.replace(/\D/g, "");
      const { data, error } = await supabase.functions.invoke("quote-dynamic-price", {
        body: {
          action: "lock",
          zip,
          serviceType: inputs.serviceType,
          homeSizeId: inputs.serviceType === "focused" ? null : inputs.homeSizeId,
          focused: inputs.serviceType === "focused" ? inputs.focused : null,
          condition: inputs.condition,
          addOns: inputs.addOns,
          serviceDate: inputs.serviceDate,
          membershipPlan: inputs.membershipPlan || "none",
          firstMonth: inputs.firstMonth,
          csrName: inputs.csrName,
          customer,
          includeAlternatives: false,
        },
      });
      if (error) throw error;
      if (data?.waitlist) throw new Error(data.message || "Address is outside the service area.");
      if (!data?.ok || !data?.lock) throw new Error(data?.message || data?.error || "Could not lock the quote.");
      setState((s) => ({ ...s, lock: data.lock, breakdown: data.breakdown || s.breakdown }));
      return data.lock as { quoteId: string; lockedUntil: string; quotedPriceCents: number };
    },
    [inputs.zip, inputs.serviceType, inputs.homeSizeId, inputs.focused, inputs.condition, inputs.addOns, inputs.serviceDate, inputs.membershipPlan, inputs.firstMonth, inputs.csrName],
  );

  return { ...state, refresh, lockQuote };
}

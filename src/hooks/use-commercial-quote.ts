"use client";

// ─── useCommercialQuote ────────────────────────────────────────────────────
//
// The live commercial quote for the internal booking screen, computed by the
// `quote-commercial-price` edge function — the same code path
// `book-partner-job` prices with, so the number a VA reads out on a call is
// the number the booking records.
//
// It answers more than "what does this cost". A commercial job has three ways
// to be unbookable that a VA needs to know about before promising a date:
//
//   • the account's paperwork (expired COI, no signed agreement)
//   • the facility's size (at or above the threshold there is no firm quote
//     without a completed walkthrough)
//   • the service window (a scope that cannot fit the hours available)
//
// All three come back with the price, so nothing surfaces for the first time
// at submit.
//
// Like the residential quote, this fetches when the pricing INPUTS change and
// only then — no polling, so a price never moves mid-booking.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import type {
  CommercialPricingConfig,
  CommercialQuote,
} from "@/lib/commercial-pricing";

export interface AccountCompliance {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  agreement_signed_at?: string | null;
  coi_expires_at?: string | null;
  coi_sent_at?: string | null;
}

export interface WalkthroughSummary {
  id: string;
  status: string;
  conducted_on: string | null;
  conducted_by: string | null;
  firm_price_cents: number | null;
  recommended_crew_size: number | null;
  scope_level: string | null;
  facility_type_key: string | null;
  sqft: number | null;
}

export interface CommercialQuoteState {
  loading: boolean;
  error: string | null;
  quote: CommercialQuote | null;
  compliance: AccountCompliance | null;
  /** The completed walkthrough backing a large facility's firm price. */
  walkthrough: WalkthroughSummary | null;
  photoZones: string[];
  config: CommercialPricingConfig | null;
}

export interface CommercialQuoteInputs {
  sqft: number;
  facilityTypeKey: string;
  scopeLevel: string;
  windowHours?: number | null;
  businessAccountId?: string | null;
  businessSiteId?: string | null;
  enabled?: boolean;
}

const EMPTY: CommercialQuoteState = {
  loading: false,
  error: null,
  quote: null,
  compliance: null,
  walkthrough: null,
  photoZones: [],
  config: null,
};

export function useCommercialQuote(
  inputs: CommercialQuoteInputs,
): CommercialQuoteState & { refresh: () => void } {
  const [state, setState] = useState<CommercialQuoteState>(EMPTY);
  const requestSeq = useRef(0);
  const [refreshTick, setRefreshTick] = useState(0);
  // The config never changes mid-booking; fetch it once and keep it so a
  // half-typed square footage doesn't blank the facility-type picker.
  const configRef = useRef<CommercialPricingConfig | null>(null);

  const key = useMemo(
    () => JSON.stringify([
      inputs.sqft, inputs.facilityTypeKey, inputs.scopeLevel,
      inputs.windowHours ?? null, inputs.businessAccountId || null,
      inputs.businessSiteId || null, inputs.enabled !== false,
    ]),
    [
      inputs.sqft, inputs.facilityTypeKey, inputs.scopeLevel, inputs.windowHours,
      inputs.businessAccountId, inputs.businessSiteId, inputs.enabled,
    ],
  );

  useEffect(() => {
    if (inputs.enabled === false) {
      setState({ ...EMPTY, config: configRef.current });
      return;
    }
    const seq = ++requestSeq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    const t = setTimeout(async () => {
      try {
        const { data, error } = await supabase.functions.invoke("quote-commercial-price", {
          body: {
            sqft: inputs.sqft,
            facilityTypeKey: inputs.facilityTypeKey || undefined,
            scopeLevel: inputs.scopeLevel || undefined,
            windowHours: inputs.windowHours || undefined,
            businessAccountId: inputs.businessAccountId || undefined,
            businessSiteId: inputs.businessSiteId || undefined,
            includeConfig: configRef.current == null,
          },
        });
        if (seq !== requestSeq.current) return; // superseded — hold the newer answer
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || "Could not price this job.");
        if (data.config) configRef.current = data.config as CommercialPricingConfig;
        setState({
          loading: false,
          error: null,
          quote: (data.quote as CommercialQuote) || null,
          compliance: (data.compliance as AccountCompliance) || null,
          walkthrough: (data.walkthrough as WalkthroughSummary) || null,
          photoZones: Array.isArray(data.photoZones) ? data.photoZones.map(String) : [],
          config: configRef.current,
        });
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : "Quote failed.",
        }));
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshTick]);

  const refresh = useCallback(() => setRefreshTick((n) => n + 1), []);
  return { ...state, refresh };
}

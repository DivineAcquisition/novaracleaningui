// ─── Stripe collector — revenue actually collected ────────────────────────────
//
// Booked revenue and collected revenue are different numbers, and the gap
// between them matters. This reads the payments that actually settled on the
// day and attributes each one to the VA who booked the underlying job.
//
// Method: list succeeded PaymentIntents created inside the day window, then
// match them back to bookings by payment_intent_id / checkout_session_id. Only
// bookings already attributed to a VA count — an unattributed payment is
// company revenue, not anyone's number.
//
// Uses the Stripe REST API directly (same approach as the other Next.js routes
// in this codebase) so no server SDK dependency is added.

import type { MetricKey, SourceStatus } from "../metrics";
import { nameAliases, type VaRecord } from "../vas";
import {
  bump,
  notConfigured,
  ok,
  setValue,
  unavailable,
  type Collector,
  type CollectContext,
  type CollectorResult,
} from "./types";

const METRICS: MetricKey[] = ["revenue_collected_cents"];

/** How far back a payment may settle and still be credited to the booker. */
const ATTRIBUTION_LOOKBACK_DAYS = 180;

interface StripePaymentIntent {
  id: string;
  amount_received?: number;
  amount?: number;
  status?: string;
  created?: number;
}

async function stripeGet(
  key: string,
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const url = new URL(`https://api.stripe.com/v1/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = (data.error as { message?: string } | undefined)?.message;
    throw new Error(message || `Stripe ${res.status}`);
  }
  return data;
}

async function resolveStripeKey(ctx: CollectContext): Promise<string> {
  const fromEnv = (process.env.STRIPE_SECRET_KEY || "").trim();
  if (fromEnv) return fromEnv;
  const { data } = await ctx.supabase
    .from("app_secrets")
    .select("value")
    .eq("key", "STRIPE_SECRET_KEY")
    .maybeSingle();
  return String((data as { value?: string } | null)?.value || "").trim();
}

function aliasIndex(vas: VaRecord[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const va of vas) {
    for (const alias of nameAliases(va)) if (!index.has(alias)) index.set(alias, va.id);
  }
  return index;
}

function matchVa(index: Map<string, string>, ...candidates: (string | null | undefined)[]): string | null {
  for (const raw of candidates) {
    const value = (raw || "").trim().toLowerCase();
    if (!value) continue;
    const direct = index.get(value);
    if (direct) return direct;
    if (value.startsWith("va_")) {
      const stripped = index.get(value.slice(3));
      if (stripped) return stripped;
    }
  }
  return null;
}

export const stripeCollector: Collector = {
  source: "stripe",
  metrics: METRICS,

  async collect(ctx: CollectContext): Promise<CollectorResult> {
    const byVa = new Map<string, Record<string, number | null>>();
    const vaStatus = new Map<string, SourceStatus>();

    const key = await resolveStripeKey(ctx);
    if (!key) return { byVa, status: notConfigured("STRIPE_SECRET_KEY is not set.") };

    const lookbackStart = new Date(
      ctx.window.start.getTime() - ATTRIBUTION_LOOKBACK_DAYS * 86400000,
    ).toISOString();

    const { data: bookingRows, error } = await ctx.supabase
      .from("bookings")
      .select("payment_intent_id, checkout_session_id, sdr_rep_name, booker_source")
      .gte("created_at", lookbackStart)
      .not("payment_intent_id", "is", null);
    if (error) return { byVa, status: unavailable(error.message) };

    const index = aliasIndex(ctx.vas);
    const vaByIntent = new Map<string, string>();
    for (const row of ((bookingRows || []) as Record<string, unknown>[])) {
      const intent = String(row.payment_intent_id || "");
      if (!intent) continue;
      const vaId = matchVa(index, row.sdr_rep_name as string, row.booker_source as string);
      if (vaId) vaByIntent.set(intent, vaId);
    }

    let intents: StripePaymentIntent[] = [];
    try {
      const gte = Math.floor(ctx.window.start.getTime() / 1000);
      const lt = Math.floor(ctx.window.end.getTime() / 1000);
      let startingAfter: string | undefined;
      let guard = 0;
      // eslint-disable-next-line no-constant-condition
      while (guard++ < 20) {
        const page = await stripeGet(key, "payment_intents", {
          "created[gte]": String(gte),
          "created[lt]": String(lt),
          limit: "100",
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        const list = (page.data as StripePaymentIntent[]) || [];
        intents.push(...list);
        if (!page.has_more || list.length === 0) break;
        startingAfter = list[list.length - 1]?.id;
        if (!startingAfter) break;
      }
    } catch (err) {
      return { byVa, status: unavailable(err), vaStatus };
    }

    intents = intents.filter((pi) => pi.status === "succeeded");

    // Stripe answered, so a VA with no settled payment genuinely collected $0.
    for (const va of ctx.vas) setValue(byVa, va.id, "revenue_collected_cents", 0);

    for (const pi of intents) {
      const vaId = vaByIntent.get(pi.id);
      if (!vaId) continue;
      const cents = Number(pi.amount_received ?? pi.amount ?? 0);
      if (Number.isFinite(cents) && cents > 0) bump(byVa, vaId, "revenue_collected_cents", cents);
    }

    return { byVa, status: ok(), vaStatus };
  },
};

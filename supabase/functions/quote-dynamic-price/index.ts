// ─── quote-dynamic-price ────────────────────────────────────────────────────
//
// The internal booking screen's pricing endpoint. Quotes are computed
// SERVER-SIDE so the number the VA quotes is produced by exactly the same
// code path `book-as-va` charges, and so demand signals (capacity, zone
// coverage) come from live tables instead of a stale client bundle.
//
// Actions (POST body `action`):
//   • "quote" (default) — full layered breakdown for the given property /
//     service / timing / location. If `quoteId` is passed and that quote is
//     still inside its lock window, the LOCKED price is returned untouched —
//     what the VA told the customer is what they get. If the lock has
//     expired the quote is re-priced and the delta is returned explicitly so
//     the VA can re-state the price, never silently charge something else.
//   • "lock" — record the quote against the customer + property, locking the
//     price for the configured window (guardrails.quote_lock_hours).
//   • "request_override" — a VA adjustment beyond the configured band: the
//     quote holds as pending_approval for an admin decision instead of the
//     VA discounting freely on a call. (Within-band overrides don't need
//     this endpoint — they're applied and logged at booking time.)
//
// Pricing inputs are property, service, timing, and location only. Nothing
// about the customer's identity or behavior enters the computation.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  checkOverride,
  computeServerQuote,
  findCheaperDates,
  loadDynamicPricingContext,
  WAITLIST_MESSAGE,
  type ConditionLevel,
  type DynamicServiceType,
  type MembershipPlanId,
} from "../_shared/dynamic-quote.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface QuoteBody {
  action?: "quote" | "lock" | "request_override";
  // Property / service / timing / location
  zip?: string;
  serviceType?: DynamicServiceType;
  homeSizeId?: string | null;
  focused?: { selections: Array<{ areaId: string; quantity: number }> } | null;
  condition?: ConditionLevel;
  addOns?: string[];
  serviceDate?: string | null;
  membershipPlan?: MembershipPlanId;
  firstMonth?: boolean;
  // Quote-lock plumbing
  quoteId?: string | null;
  csrName?: string;
  includeAlternatives?: boolean;
  customer?: {
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
  };
  // request_override
  override?: { totalCents: number; reasonCode: string; note?: string };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body: QuoteBody = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const ctx = await loadDynamicPricingContext(supabase);
    if (!ctx) {
      return json({ ok: false, error: "Dynamic pricing is not configured (no active config version)." }, 500);
    }
    const cfg = ctx.config;
    const meta = metaFor(ctx);

    const action = body.action || "quote";

    // ── request_override: beyond-band adjustment → holds for admin ────────
    if (action === "request_override") {
      if (!body.quoteId || !body.override) {
        return json({ ok: false, error: "quoteId and override are required." }, 400);
      }
      const { data: quote } = await supabase
        .from("va_quotes").select("*").eq("id", body.quoteId).maybeSingle();
      if (!quote) return json({ ok: false, error: "Quote not found." }, 404);
      const computed = Number(quote.quoted_price_cents || quote.total_estimate_cents || 0);
      const floor = Number(quote.price_breakdown?.floorCents || 0);
      const check = checkOverride(cfg, computed, body.override.totalCents, floor);
      if (check.belowFloor) return json({ ok: false, error: check.reason }, 422);
      if (!body.override.reasonCode) return json({ ok: false, error: "A reason is required for any override." }, 400);
      const { data: ov, error: ovErr } = await supabase
        .from("price_overrides")
        .insert({
          quote_id: body.quoteId,
          va_name: body.csrName || "unknown",
          original_cents: computed,
          override_cents: body.override.totalCents,
          delta_percent: Math.round(check.deltaPercent * 100) / 100,
          direction: body.override.totalCents >= computed ? "up" : "down",
          reason_code: body.override.reasonCode,
          note: body.override.note || null,
          status: check.requiresApproval ? "pending_approval" : "applied",
        })
        .select("id, status")
        .single();
      if (ovErr) throw ovErr;
      if (!check.requiresApproval) {
        // Within band — apply to the locked quote immediately.
        await supabase
          .from("va_quotes")
          .update({ quoted_price_cents: body.override.totalCents, total_estimate_cents: body.override.totalCents })
          .eq("id", body.quoteId);
      }
      return json({
        ok: true,
        overrideId: ov.id,
        status: ov.status,
        requiresApproval: check.requiresApproval,
        message: check.requiresApproval
          ? "Adjustment is outside the VA band — it's now waiting for admin approval. The quote holds meanwhile."
          : "Adjustment applied to the locked quote.",
        meta,
      });
    }

    // ── quote / lock ───────────────────────────────────────────────────────
    if (!body.zip) return json({ ok: false, served: false, error: "zip is required.", meta }, 400);
    if (!body.serviceType) return json({ ok: false, error: "serviceType is required.", meta }, 400);

    // Honor an existing lock: within the window the recorded price stands,
    // regardless of how zone or demand conditions have shifted since.
    if (action === "quote" && body.quoteId) {
      const { data: quote } = await supabase
        .from("va_quotes")
        .select("id, quoted_price_cents, total_estimate_cents, locked_until, price_breakdown, zone_code, status")
        .eq("id", body.quoteId)
        .maybeSingle();
      if (quote?.locked_until && new Date(quote.locked_until).getTime() > Date.now() && quote.status !== "converted") {
        return json({
          ok: true,
          served: true,
          locked: true,
          lock: {
            quoteId: quote.id,
            lockedUntil: quote.locked_until,
            quotedPriceCents: Number(quote.quoted_price_cents ?? quote.total_estimate_cents ?? 0),
          },
          breakdown: quote.price_breakdown || null,
          zone: quote.zone_code ? { code: quote.zone_code } : null,
          meta,
        });
      }
      // Lock expired → fall through to a fresh quote; report the delta.
      if (quote) {
        const previousCents = Number(quote.quoted_price_cents ?? quote.total_estimate_cents ?? 0);
        const fresh = await runQuote(supabase, ctx, body);
        if (fresh.status === 200 && fresh.payload.ok && fresh.payload.breakdown) {
          await supabase.from("va_quotes").update({ status: "expired" }).eq("id", quote.id)
            .eq("status", "draft");
          fresh.payload.reprice = {
            previousCents,
            newCents: fresh.payload.breakdown.totalCents,
            deltaCents: fresh.payload.breakdown.totalCents - previousCents,
          };
        }
        return json(fresh.payload, fresh.status);
      }
    }

    const result = await runQuote(supabase, ctx, body);

    // ── lock: record the quote → price holds for the configured window ────
    if (action === "lock" && result.status === 200 && result.payload.ok && result.payload.breakdown) {
      const b = result.payload.breakdown;
      const lockedUntil = new Date(Date.now() + cfg.guardrails.quote_lock_hours * 3_600_000).toISOString();
      const cust = body.customer || {};
      const { data: quote, error: qErr } = await supabase
        .from("va_quotes")
        .insert({
          csr_name: body.csrName || null,
          first_name: cust.firstName || "—",
          last_name: cust.lastName || null,
          email: (cust.email || "unknown@internal.quote").toLowerCase(),
          phone: cust.phone || null,
          address: cust.address || null,
          city: cust.city || null,
          state: cust.state || null,
          zip_code: String(body.zip).slice(0, 5),
          home_size_id: body.homeSizeId || "focused",
          service_type: body.serviceType,
          add_ons: body.addOns || [],
          frequency: body.membershipPlan && body.membershipPlan !== "none" ? body.membershipPlan : "one-time",
          service_date: body.serviceDate || null,
          bedrooms: cust.bedrooms ?? null,
          bathrooms: cust.bathrooms ?? null,
          notes: cust.notes || null,
          status: "draft",
          zone_code: b.zoneCode,
          condition: b.condition,
          focused_areas: body.focused || null,
          price_breakdown: b,
          pricing_config_version: ctx.configVersion,
          quoted_price_cents: b.totalCents,
          total_estimate_cents: b.totalCents,
          base_price_cents: b.baseCents,
          locked_until: lockedUntil,
          demand_multiplier: b.demandMultiplier,
          shadow_demand_multiplier: b.shadowDemandMultiplier,
        })
        .select("id")
        .single();
      if (qErr) throw qErr;
      // Tie the audit row to the locked quote.
      if (result.payload.auditId) {
        await supabase.from("price_quote_audit").update({ quote_id: quote.id }).eq("id", result.payload.auditId);
      }
      result.payload.lock = {
        quoteId: quote.id,
        lockedUntil,
        quotedPriceCents: b.totalCents,
      };
    }

    return json(result.payload, result.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[quote-dynamic-price] error", message);
    return json({ ok: false, error: message }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function runQuote(supabase: any, ctx: NonNullable<Awaited<ReturnType<typeof loadDynamicPricingContext>>>, body: QuoteBody): Promise<{ status: number; payload: any }> {
  const params = {
    zip: body.zip,
    serviceType: body.serviceType as DynamicServiceType,
    homeSizeId: body.homeSizeId || null,
    focused: body.focused || null,
    condition: (body.condition || "standard") as ConditionLevel,
    addOns: body.addOns || [],
    serviceDate: body.serviceDate || null,
    membershipPlan: body.membershipPlan || ("none" as MembershipPlanId),
    firstMonth: body.firstMonth,
    quotedBy: body.csrName || null,
  };
  const result = await computeServerQuote(supabase, ctx, params);

  if (!result.served) {
    return {
      status: 200,
      payload: {
        ok: false,
        served: false,
        waitlist: true,
        message: result.message || WAITLIST_MESSAGE,
        meta: metaFor(ctx),
      },
    };
  }
  if (!result.ok || !result.breakdown) {
    return {
      status: 200,
      payload: { ok: false, served: true, message: result.message, zone: result.zone, meta: metaFor(ctx) },
    };
  }

  let alternatives: unknown[] = [];
  if (body.includeAlternatives !== false && body.serviceDate && result.zone) {
    alternatives = await findCheaperDates(
      supabase, ctx, result.zone, params, body.serviceDate, result.breakdown.totalCents,
    );
  }

  return {
    status: 200,
    payload: {
      ok: true,
      served: true,
      zone: result.zone,
      breakdown: result.breakdown,
      demand: result.demand,
      alternatives,
      auditId: result.auditId,
      meta: metaFor(ctx),
    },
  };
}

/** Everything the internal booking screen needs to render + explain a quote. */
function metaFor(ctx: NonNullable<Awaited<ReturnType<typeof loadDynamicPricingContext>>>) {
  const cfg = ctx.config;
  return {
    focusedSettingsLinked: ctx.focusedSettingsLinked,
    configVersion: ctx.configVersion,
    demandEnabled: cfg.demand.enabled,
    shadowMode: cfg.demand.shadow_mode,
    conditionMultipliers: cfg.condition_multipliers,
    overrideReasons: cfg.override_reasons,
    overrideBandPercent: cfg.guardrails.override_band_percent,
    quoteLockHours: cfg.guardrails.quote_lock_hours,
    baseTables: {
      authoritative: cfg.base_tables.authoritative,
      reconciled: cfg.base_tables.reconciled,
    },
    focusedClean: cfg.focused_clean,
    sameDayCents: cfg.surcharges.same_day_cents,
  };
}

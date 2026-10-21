// ─── membership-pay-page ────────────────────────────────────────────────────
//
// Backend for the membership sign-then-pay hosted page
// (try.novaracleaning.com/membership-pay/<token>). This is the recurring /
// Glow-membership analogue of booking-pay-page: the customer must review and
// e-sign the Membership / Recurring Service Agreement BEFORE the Stripe
// subscription payment link is revealed.
//
// The gate is enforced HERE, server-side:
//
//   1. get   { token }                       → plan summary + agreement status
//        Returns pay_url ONLY when the agreement is already signed.
//   2. sign  { token, name, agreed, pdfBase64 }
//        Records the signed agreement (all policy checkboxes true + signed PDF),
//        stamps customer_recurring_schedules.agreement_signed_at, and returns
//        the held Stripe subscription Checkout URL so the page can hand off to
//        payment. Delegates PDF storage to store-service-agreement.
//
// A caller hitting the API directly still can't reach pay_url without first
// posting a valid, fully-accepted signature.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const log = (s: string, d?: unknown) =>
  console.log(`[membership-pay-page] ${s}${d ? " " + JSON.stringify(d) : ""}`);

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const SCHEDULE_COLS =
  "id, email, first_name, last_name, phone, address, city, state, zip_code, " +
  "home_size_id, service_type, cadence, membership_plan, price_cents, " +
  "preferred_time_slot, next_service_date, active, pay_token, pay_url, agreement_signed_at";

const PLAN_LABELS: Record<string, string> = {
  weekly: "Glow Weekly",
  biweekly: "Glow Bi-Weekly",
  monthly: "Glow Monthly",
};

// deno-lint-ignore no-explicit-any
async function loadSchedule(supabase: any, token: string): Promise<Row | null> {
  if (!token || token.length < 16) return null;
  const { data } = await supabase
    .from("customer_recurring_schedules")
    .select(SCHEDULE_COLS)
    .eq("pay_token", token)
    .maybeSingle();
  return data || null;
}

function planOptions(s: Row) {
  // The internal booking already chose the frequency. The pay link shows
  // that plan only — not the other Glow frequencies.
  const current = String(s.membership_plan || s.cadence || "monthly");
  return [{
    cadence: current,
    label: PLAN_LABELS[current] || "Recurring membership",
    cents: Number(s.price_cents) || 0,
    selected: true,
  }];
}

function summarize(s: Row) {
  const signed = !!s.agreement_signed_at;
  const plan = String(s.membership_plan || s.cadence || "");
  return {
    scheduleId: s.id,
    firstName: s.first_name || "",
    lastName: s.last_name || "",
    email: s.email || "",
    plan,
    planLabel: PLAN_LABELS[plan] || "Recurring membership",
    cadence: s.cadence || null,
    perCleanCents: Number(s.price_cents) || 0,
    firstServiceDate: s.next_service_date || null,
    timeSlot: s.preferred_time_slot || null,
    city: s.city || "",
    state: s.state || "",
    agreementSigned: signed,
    active: s.active !== false,
    plans: planOptions(s),
    // The pay link is the whole point of the gate — never leak it pre-signature.
    payUrl: signed ? (s.pay_url || null) : null,
  };
}

async function ensurePayUrl(supabase: any, schedule: Row): Promise<string | null> {
  if (schedule.pay_url) return String(schedule.pay_url);
  const plan = String(schedule.membership_plan || schedule.cadence || "monthly");
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!base || !key || !schedule.home_size_id) return null;
  const res = await fetch(`${base}/functions/v1/create-checkout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "application/json",
      Origin: "https://try.novaracleaning.com",
    },
    body: JSON.stringify({
      mode: "subscription",
      membershipPlan: plan,
      homeSizeId: schedule.home_size_id,
      email: schedule.email,
      firstName: schedule.first_name,
      lastName: schedule.last_name,
      phone: schedule.phone,
      address: schedule.address,
      city: schedule.city,
      state: schedule.state,
      zipCode: schedule.zip_code,
      firstTimeSlot: schedule.preferred_time_slot,
      notifyCustomer: false,
      sendChecklistEmail: false,
      priceOverride: Number(schedule.price_cents) > 0 ? { total: Number(schedule.price_cents) } : undefined,
    }),
  });
  const data = await res.json().catch(() => ({}));
  const url = String((data as Row)?.url || "");
  if (!res.ok || !url) {
    log("checkout create failed", { status: res.status, error: (data as Row)?.error || null });
    return null;
  }
  await supabase
    .from("customer_recurring_schedules")
    .update({ pay_url: url, updated_at: new Date().toISOString() })
    .eq("id", schedule.id);
  schedule.pay_url = url;
  return url;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  // deno-lint-ignore no-explicit-any
  const supabase: any = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = String((body as Row)?.action || "get");
    const token = String((body as Row)?.token || "").trim();

    const schedule = await loadSchedule(supabase, token);
    if (!schedule) return json({ ok: false, error: "not_found" }, 404);

    // ── get: plan summary + agreement/pay status ────────────────────────
    // Inactive schedules stay reachable so a cancelled member can pick a
    // plan and pay to reinstate. The page does not turn the schedule back
    // on; payment does.
    if (action === "get") {
      return json({ ok: true, membership: summarize(schedule) });
    }

    if (action === "set_plan") {
      const cadence = String((body as Row)?.cadence || "").toLowerCase();
      const current = String(schedule.membership_plan || schedule.cadence || "monthly");
      if (cadence !== current) {
        return json({ ok: false, error: "This link uses the frequency already chosen." }, 409);
      }
      return json({ ok: true, membership: summarize(schedule) });
    }

    // ── sign: record the accepted + signed agreement, reveal the pay link ─
    if (action === "sign") {
      const agreed = (body as Row)?.agreed || {};
      const name = String((body as Row)?.name || "").trim();
      const pdfBase64 = String((body as Row)?.pdfBase64 || "");

      if (!agreed.terms || !agreed.disclaimer || !agreed.serviceAgreement || !agreed.refund) {
        return json({ ok: false, error: "all_policies_must_be_accepted" }, 400);
      }
      if (!name) return json({ ok: false, error: "signature_name_required" }, 400);
      if (!pdfBase64 || pdfBase64.length < 500) {
        return json({ ok: false, error: "signed_agreement_pdf_required" }, 400);
      }

      const { data: res, error } = await supabase.functions.invoke("store-service-agreement", {
        body: {
          // Memberships aren't tied to a single booking — store against the email.
          email: schedule.email,
          name,
          serviceType: "Membership / Recurring Service",
          source: "membership_pay",
          agreementType: "membership",
          agreed: {
            terms: true,
            disclaimer: true,
            refund: agreed.refund === true,
            serviceAgreement: true,
          },
          pdfBase64,
        },
      });
      const failed = error || (res && (res as Row).error);
      if (failed) {
        log("agreement store failed", { failed: String((failed as Row)?.message || failed) });
        return json({ ok: false, error: "agreement_store_failed" }, 500);
      }

      const nowIso = new Date().toISOString();
      await supabase
        .from("customer_recurring_schedules")
        .update({ agreement_signed_at: nowIso, updated_at: nowIso })
        .eq("id", schedule.id);

      await supabase.from("events").insert({
        event_type: "membership.pay_page_signed",
        source: "membership-pay-page",
        summary: `Customer signed the membership agreement on the pay page (${name})`,
        data: { schedule_id: schedule.id, email: schedule.email, agreement_id: (res as Row)?.id || null },
      }).then(() => undefined, () => undefined);

      const payUrl = await ensurePayUrl(supabase, schedule);
      return json({ ok: true, signed: true, payUrl });
    }

    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[membership-pay-page]", msg);
    return json({ ok: false, error: msg }, 500);
  }
});

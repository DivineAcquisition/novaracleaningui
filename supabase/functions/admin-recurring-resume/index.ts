// admin-recurring-resume
//
// Admin/VA: put a paused recurring clean back on the calendar, optionally
// charge the card on file, and tell the customer by SMS and email.
//
// Body: {
//   scheduleId,
//   serviceDate,          // YYYY-MM-DD
//   timeSlot,             // e.g. "1:30 PM - 2:30 PM"
//   chargeCents?: number, // 0 or omit to resume without a charge
// }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { resolveSecret } from "../_shared/app-secrets.ts";
import { sendSms } from "../_shared/sms.ts";
import { resolveOffSessionPaymentMethod } from "../_shared/resolve-off-session-payment-method.ts";
import { recurringResumeClearFields } from "../_shared/recurring-pause.ts";
import {
  buildRecurringResumeSms,
  RECURRING_RESUME_EMAIL_SUBJECT,
} from "../_shared/recurring-pause.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function formatVisit(date: string, slot: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return [date, slot].filter(Boolean).join(" at ");
  const label = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
  return slot ? `${label} at ${slot}` : label;
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// deno-lint-ignore no-explicit-any
async function ensureAdminOrVa(admin: any, jwt: string): Promise<string> {
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const ok = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
  if (!ok) throw new Error("Admins or VAs only.");
  return u.user.id;
}

// deno-lint-ignore no-explicit-any
async function chargeCard(
  admin: any,
  sched: Record<string, unknown>,
  chargeCents: number,
  when: string,
): Promise<{ charged: boolean; paymentIntentId: string | null; error: string | null }> {
  const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
  if (!stripeKey) return { charged: false, paymentIntentId: null, error: "STRIPE_SECRET_KEY not configured" };
  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

  let customerId = String(sched.customer_id || "");
  if (!customerId.startsWith("cus_")) {
    const email = String(sched.email || "").trim();
    const { data: credit } = await admin
      .from("membership_credits")
      .select("customer_id")
      .ilike("email", email)
      .not("customer_id", "is", null)
      .limit(1)
      .maybeSingle();
    customerId = String(credit?.customer_id || "");
  }
  if (!customerId.startsWith("cus_") && sched.email) {
    const found = await stripe.customers.list({ email: String(sched.email), limit: 1 });
    customerId = found.data[0]?.id || "";
  }
  if (!customerId.startsWith("cus_")) {
    return { charged: false, paymentIntentId: null, error: "No Stripe customer on this schedule." };
  }

  const pm = await resolveOffSessionPaymentMethod(stripe, customerId);
  if (!pm) return { charged: false, paymentIntentId: null, error: "No card on file to charge." };
  const pmType = (await stripe.paymentMethods.retrieve(pm)).type || "card";

  const name = `${sched.first_name || ""} ${sched.last_name || ""}`.trim();
  try {
    const pi = await stripe.paymentIntents.create({
      amount: chargeCents,
      currency: "usd",
      customer: customerId,
      payment_method: pm,
      payment_method_types: [pmType],
      off_session: true,
      confirm: true,
      description: `Novara Glow resume — ${name || "member"} next clean ${when}`,
      metadata: {
        source: "admin-recurring-resume",
        schedule_id: String(sched.id || ""),
        email: String(sched.email || ""),
      },
    });
    if (pi.status !== "succeeded") {
      return { charged: false, paymentIntentId: pi.id, error: `Card charge is ${pi.status}.` };
    }
    return { charged: true, paymentIntentId: pi.id, error: null };
  } catch (e) {
    return {
      charged: false,
      paymentIntentId: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  // deno-lint-ignore no-explicit-any
  const admin: any = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Not signed in." }, 401);
    const callerId = await ensureAdminOrVa(admin, jwt);

    const body = await req.json().catch(() => ({}));
    const scheduleId = String(body?.scheduleId || "").trim();
    const serviceDate = String(body?.serviceDate || "").trim();
    const timeSlot = String(body?.timeSlot || "").trim();
    const chargeCents = Math.round(Number(body?.chargeCents || 0));
    if (!scheduleId) return json({ error: "scheduleId required" }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
      return json({ error: "Pick the next clean date." }, 400);
    }
    if (!timeSlot) return json({ error: "Pick the next clean time." }, 400);
    if (!Number.isFinite(chargeCents) || chargeCents < 0) {
      return json({ error: "Charge amount is not valid." }, 400);
    }

    const { data: sched, error: loadErr } = await admin
      .from("customer_recurring_schedules")
      .select("*")
      .eq("id", scheduleId)
      .maybeSingle();
    if (loadErr) throw loadErr;
    if (!sched) return json({ error: "Schedule not found." }, 404);

    const when = formatVisit(serviceDate, timeSlot);
    const chargedLabel = chargeCents > 0 ? money(chargeCents) : null;
    let charge = { charged: false, paymentIntentId: null as string | null, error: null as string | null };
    if (chargeCents > 0) {
      charge = await chargeCard(admin, sched, chargeCents, when);
    }

    const nowIso = new Date().toISOString();
    const today = nowIso.slice(0, 10);
    const noteBit = charge.charged
      ? `Resumed ${today}: next clean ${when}. Charged ${chargedLabel}.`
      : `Resumed ${today}: next clean ${when}.` + (charge.error ? ` Charge failed: ${charge.error}` : "");
    const notes = `${sched.notes ? String(sched.notes) + " · " : ""}${noteBit}`.slice(0, 2000);

    const { error: upErr } = await admin
      .from("customer_recurring_schedules")
      .update({
        active: true,
        next_service_date: serviceDate,
        preferred_time_slot: timeSlot,
        ...recurringResumeClearFields(),
        notes,
        updated_at: nowIso,
      })
      .eq("id", scheduleId);
    if (upErr) throw upErr;

    const firstName = String(sched.first_name || "").trim() || "there";
    const sms = buildRecurringResumeSms({
      firstName: sched.first_name,
      when,
      chargedLabel: charge.charged ? chargedLabel : null,
    });
    let smsSent = false;
    let emailed = false;
    let smsError: string | null = null;
    let emailError: string | null = null;

    const toEmail = String(sched.email || "").trim();
    if (toEmail && !toEmail.toLowerCase().endsWith("@pending.novara")) {
      try {
        const { data, error } = await admin.functions.invoke("send-membership-email", {
          body: {
            type: "recurring_resumed",
            email: toEmail,
            data: {
              name: firstName,
              when,
              cadence: sched.cadence || "",
              chargedLabel: charge.charged ? chargedLabel : "",
              subject: RECURRING_RESUME_EMAIL_SUBJECT,
            },
          },
        });
        emailed = !error && !(data as { error?: string } | null)?.error;
        if (!emailed) {
          emailError = String((data as { error?: string } | null)?.error || error?.message || "email failed");
        }
      } catch (e) {
        emailError = e instanceof Error ? e.message : String(e);
      }
    } else {
      emailError = "No valid customer email on file.";
    }

    if (sms) {
      smsSent = await sendSms(admin, {
        toPhone: sched.phone,
        message: sms,
        type: "confirmation",
      });
      if (!smsSent && !String(sched.phone || "").trim()) smsError = "No phone on file.";
      else if (!smsSent) smsError = "SMS send failed.";
    }

    const name = `${sched.first_name || ""} ${sched.last_name || ""}`.trim() || sched.email;
    await admin.from("events").insert({
      event_type: "recurring.resumed",
      source: "admin-recurring-resume",
      summary: `Recurring schedule resumed for ${name} — ${when}` +
        (charge.charged ? ` — charged ${chargedLabel}` : charge.error ? " — charge failed" : ""),
      data: {
        schedule_id: scheduleId,
        email: sched.email,
        service_date: serviceDate,
        time_slot: timeSlot,
        charge_cents: chargeCents,
        charged: charge.charged,
        payment_intent_id: charge.paymentIntentId,
        charge_error: charge.error,
        by: callerId,
        sms_sent: smsSent,
        emailed,
      },
    }).then(() => undefined, () => undefined);

    return json({
      ok: true,
      smsSent,
      emailed,
      smsError,
      emailError,
      charged: charge.charged,
      chargeError: charge.error,
      paymentIntentId: charge.paymentIntentId,
      when,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("Not signed in") ? 401 : msg.includes("only") ? 403 : 500;
    console.error("[admin-recurring-resume]", msg);
    return json({ error: msg }, status);
  }
});

// --- partner-recurring-generate --------------------------------------------
//
// Weekly cron for the partner portal's recurring schedules. Two modes:
//   mode=heads_up  -> day-before notice: "N cleans, $X will be scheduled +
//                     charged tomorrow" (SMS + email). Sets heads_up_week.
//   mode=generate  -> creates next week's batch per active schedule, charges
//                     the host's saved card off-session, then runs the shared
//                     assignment engine + notifications. Idempotent: one batch
//                     per schedule per week (guarded by last_generated_week).
//
// Auth: service-role bearer (pg_cron via pg_net) OR an admin/VA JWT (manual
// trigger from the admin UI). Reuses the shared turnover-engine so assignment
// logic is never duplicated.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveSecret } from "../_shared/app-secrets.ts";
import { sendSms, formatServiceDate } from "../_shared/sms.ts";
import { notifyDiscord } from "../_shared/discord.ts";
import { type SB, money, finalizeBatch, sendPartnerEmail } from "../_shared/turnover-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}

// Monday of the week N weeks from a reference date (UTC, date-only).
function mondayOf(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = x.getUTCDay(); // 0=Sun..6=Sat
  const offset = dow === 0 ? -6 : 1 - dow; // back to Monday
  x.setUTCDate(x.getUTCDate() + offset);
  return x.toISOString().slice(0, 10);
}
function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
// Date for a given JS day-of-week (0=Sun..6=Sat) within a Monday-anchored week.
function dateForDow(weekStartMonday: string, dow: number): string {
  const offset = dow === 0 ? 6 : dow - 1; // Mon=0 .. Sun=6
  return addDays(weekStartMonday, offset);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  ) as SB;

  // Auth gate: service-role bearer OR x-cron-secret (pg_cron) OR admin/VA JWT.
  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  let authorized = !!token && token === serviceKey;
  if (!authorized) {
    const cronSecret = req.headers.get("x-cron-secret") || "";
    if (cronSecret) {
      const expected = (await resolveSecret(admin, "CRON_SECRET")).trim();
      authorized = !!expected && cronSecret === expected;
    }
  }
  if (!authorized && token) {
    const { data: u } = await admin.auth.getUser(token);
    if (u?.user?.id) {
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
      authorized = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
    }
  }
  if (!authorized) return json({ error: "Unauthorized" }, 401);

  let body: { mode?: string; scheduleId?: string } = {};
  try { body = await req.json(); } catch { /* default generate, all schedules */ }
  const mode = body.mode === "heads_up" ? "heads_up" : "generate";

  // Target the upcoming week: Monday of this week + 7 days = next Monday.
  const nextWeek = addDays(mondayOf(new Date()), 7);

  let q = admin.from("recurring_schedules").select("*").eq("active", true);
  if (body.scheduleId) q = q.eq("id", body.scheduleId);
  const { data: schedules } = await q;
  const list = (schedules || []) as Array<Record<string, unknown>>;

  const results: Array<Record<string, unknown>> = [];

  for (const sch of list) {
    const days = (sch.days_of_week as number[]) || [];
    if (days.length === 0) continue;
    // Skip if paused through next week.
    if (sch.paused_until && String(sch.paused_until) >= nextWeek) { results.push({ id: sch.id, skipped: "paused" }); continue; }

    const { data: hostRow } = await admin.from("hosts").select("*").eq("id", sch.host_id).maybeSingle();
    const { data: property } = await admin.from("properties").select("*").eq("id", sch.property_id).maybeSingle();
    if (!hostRow || !property || property.turnover_price == null || Number(property.turnover_price) <= 0) {
      results.push({ id: sch.id, skipped: "unpriced_or_missing" });
      continue;
    }
    const price = Number(property.turnover_price);
    const dates = days.map((d) => dateForDow(nextWeek, d));
    const total = price * dates.length;

    if (mode === "heads_up") {
      if (String(sch.heads_up_week || "") === nextWeek) { results.push({ id: sch.id, skipped: "heads_up_sent" }); continue; }
      const msg = `Novara: your recurring turnovers for the week of ${formatServiceDate(nextWeek)} (${dates.length} clean${dates.length === 1 ? "" : "s"}, ${money(total)}) will be scheduled and charged tomorrow. Log in to change or skip.`;
      if (hostRow.phone) await sendSms(admin, { toPhone: hostRow.phone, type: "reminder", message: msg });
      await sendPartnerEmail(admin, "turnover_confirmed", hostRow.email, {
        name: (hostRow.name || "").split(" ")[0] || "",
        property: `${dates.length} recurring turnover${dates.length === 1 ? "" : "s"} - ${property.nickname || property.address || ""}`,
        date: `Week of ${formatServiceDate(nextWeek)} (heads-up - charges tomorrow)`,
        price: money(total),
      });
      await admin.from("recurring_schedules").update({ heads_up_week: nextWeek }).eq("id", sch.id);
      results.push({ id: sch.id, headsUp: true, count: dates.length, total });
      continue;
    }

    // generate
    if (String(sch.last_generated_week || "") === nextWeek) { results.push({ id: sch.id, skipped: "already_generated" }); continue; }
    // Claim this week immediately to guarantee idempotency (no double-charge).
    await admin.from("recurring_schedules").update({ last_generated_week: nextWeek }).eq("id", sch.id);

    const { data: batch } = await admin.from("booking_batches").insert({
      host_id: sch.host_id, week_start: nextWeek, source: "recurring", recurring_schedule_id: sch.id,
      turnover_count: dates.length, total_amount: total, status: "pending_payment",
    }).select("*").single();

    const rows = dates.map((dt) => ({
      property_id: sch.property_id, host_id: sch.host_id, requested_date: dt,
      window_start: sch.window_start || null, window_end: sch.window_end || null,
      price, status: "pending_payment", batch_id: batch.id,
    }));
    await admin.from("turnover_requests").insert(rows);

    // Off-session charge on the host's saved card.
    const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const customerId = hostRow.stripe_customer_id as string | undefined;
    let pmId: string | undefined;
    if (customerId) {
      const cust = await stripe.customers.retrieve(customerId) as { invoice_settings?: { default_payment_method?: string } };
      pmId = cust?.invoice_settings?.default_payment_method;
      if (!pmId) {
        const pms = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
        pmId = pms.data[0]?.id;
      }
    }

    let charged = false;
    if (customerId && pmId) {
      try {
        const pi = await stripe.paymentIntents.create({
          amount: Math.round(total * 100), currency: "usd", customer: customerId,
          payment_method: pmId, off_session: true, confirm: true,
          metadata: { kind: "turnover_batch_recurring", batch_id: batch.id, host_id: String(sch.host_id) },
        });
        charged = pi.status === "succeeded";
        if (charged) {
          await admin.from("booking_batches").update({ status: "paid", stripe_payment_intent_id: pi.id }).eq("id", batch.id);
        }
      } catch (e) {
        console.warn("[recurring-generate] charge failed", batch.id, e instanceof Error ? e.message : String(e));
      }
    }

    if (charged) {
      await finalizeBatch(admin, batch.id);
      results.push({ id: sch.id, generated: true, batchId: batch.id, count: dates.length, total });
    } else {
      // No saved card or charge declined: do NOT create the turnovers.
      await admin.from("turnover_requests").delete().eq("batch_id", batch.id);
      await admin.from("booking_batches").update({ status: "payment_failed" }).eq("id", batch.id);
      const reason = !customerId || !pmId ? "no saved card" : "card declined";
      if (hostRow.phone) {
        await sendSms(admin, { toPhone: hostRow.phone, type: "reminder", message: `Novara: we couldn't charge your recurring turnovers for the week of ${formatServiceDate(nextWeek)} (${reason}). Log in to update your card and rebook.` });
      }
      await sendPartnerEmail(admin, "turnover_cancelled", hostRow.email, {
        name: (hostRow.name || "").split(" ")[0] || "",
        property: `${dates.length} recurring turnover${dates.length === 1 ? "" : "s"} - ${property.nickname || property.address || ""}`,
        date: `Week of ${formatServiceDate(nextWeek)} (payment failed - ${reason})`,
      });
      await notifyDiscord(admin, {
        title: "Recurring turnover charge FAILED",
        color: 15158332,
        fields: [
          { name: "Host", value: hostRow.name || hostRow.email || "-", inline: true },
          { name: "Property", value: property.nickname || property.address || "-", inline: true },
          { name: "Week", value: formatServiceDate(nextWeek), inline: true },
          { name: "Amount", value: money(total), inline: true },
          { name: "Reason", value: reason, inline: true },
        ],
      });
      results.push({ id: sch.id, generated: false, paymentFailed: true, reason });
    }
  }

  return json({ ok: true, mode, week: nextWeek, processed: results.length, results });
});

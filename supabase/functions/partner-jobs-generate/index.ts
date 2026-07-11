// partner-jobs-generate
//
// Daily cron (09:00 UTC): the partner analogue of customer-recurring-generate.
// For every active partner_recurring_schedules row whose next_service_date is
// within the generation horizon, create the next booking through
// book-partner-job (same gates, same pay lock, same portal reflection) and
// advance the schedule. Idempotent via last_generated_date.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}
const log = (m: string, d?: unknown) =>
  console.log(`[partner-jobs-generate] ${m}${d === undefined ? "" : " " + JSON.stringify(d)}`);

const HORIZON_DAYS = 7; // generate the booking a week before the visit

function nextDate(fromYmd: string, cadence: string, dayOfMonth?: number | null): string {
  const d = new Date(`${fromYmd}T12:00:00`);
  if (cadence === "weekly") d.setDate(d.getDate() + 7);
  else if (cadence === "biweekly") d.setDate(d.getDate() + 14);
  else {
    d.setMonth(d.getMonth() + 1);
    if (dayOfMonth && dayOfMonth >= 1 && dayOfMonth <= 28) d.setDate(dayOfMonth);
  }
  return d.toISOString().slice(0, 10);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // deno-lint-ignore no-explicit-any
  const admin: any = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const horizon = new Date(Date.now() + HORIZON_DAYS * 86400_000).toISOString().slice(0, 10);
    const { data: schedules, error } = await admin
      .from("partner_recurring_schedules")
      .select("*")
      .eq("active", true)
      .not("next_service_date", "is", null)
      .lte("next_service_date", horizon)
      .limit(50);
    if (error) throw error;
    if (!schedules || schedules.length === 0) return json({ ok: true, generated: 0 });

    let generated = 0, failed = 0;
    for (const sched of schedules) {
      const target = String(sched.next_service_date);
      if (sched.last_generated_date && String(sched.last_generated_date) >= target) {
        // Already generated — just advance.
        await admin.from("partner_recurring_schedules").update({
          next_service_date: nextDate(target, sched.cadence, sched.day_of_month),
          updated_at: new Date().toISOString(),
        }).eq("id", sched.id);
        continue;
      }
      try {
        const { data: res, error: fnErr } = await admin.functions.invoke("book-partner-job", {
          body: {
            bookingType: sched.booking_type,
            businessAccountId: sched.business_account_id || undefined,
            businessSiteId: sched.business_site_id || undefined,
            hostId: sched.host_id || undefined,
            propertyId: sched.property_id || undefined,
            serviceDate: target,
            arrivalWindow: sched.preferred_window || undefined,
            hardDeadline: sched.hard_deadline || undefined,
            accessMethod: sched.access_method || "See access notes",
            accessNotes: sched.access_notes || undefined,
            serviceType: sched.service_type || undefined,
            scopeNotes: sched.scope_notes || "Recurring service — standard scope for this location.",
            specialInstructions: sched.special_instructions || undefined,
            priceCents: Number(sched.price_cents) || 0,
            cleanerPayPct: Number(sched.cleaner_pay_pct) || 35,
            paymentStatus: "invoice",
            cleanerIds: Array.isArray(sched.preferred_cleaner_ids) ? sched.preferred_cleaner_ids : [],
            scheduleId: sched.id,
          },
        });
        if (fnErr || res?.ok === false) throw new Error(fnErr?.message || res?.error || "book failed");
        await admin.from("partner_recurring_schedules").update({
          last_generated_date: target,
          next_service_date: nextDate(target, sched.cadence, sched.day_of_month),
          updated_at: new Date().toISOString(),
        }).eq("id", sched.id);
        generated++;
        log("generated", { scheduleId: sched.id, date: target, ref: res?.ref });
      } catch (e) {
        failed++;
        log("generate failed", { scheduleId: sched.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return json({ ok: true, generated, failed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    return json({ ok: false, error: msg }, 500);
  }
});

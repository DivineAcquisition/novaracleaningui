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
// Enough to fill a week of a daily contract in one pass, bounded so a bad
// cadence can never spin.
const MAX_VISITS_PER_SCHEDULE = 8;

function nextDate(
  fromYmd: string,
  cadence: string,
  dayOfMonth?: number | null,
  daysOfWeek?: number[] | null,
): string {
  const d = new Date(`${fromYmd}T12:00:00`);
  if (cadence === "daily") {
    // Daily commercial contracts are almost always service days, not calendar
    // days — a five-night office contract should not generate a Saturday
    // visit. days_of_week says which days count; without it, every day does.
    const allowed = Array.isArray(daysOfWeek) && daysOfWeek.length
      ? new Set(daysOfWeek.map(Number))
      : null;
    for (let i = 0; i < 8; i++) {
      d.setDate(d.getDate() + 1);
      if (!allowed || allowed.has(d.getDay())) break;
    }
  } else if (cadence === "weekly") d.setDate(d.getDate() + 7);
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
      // A weekly cadence has at most one visit inside a seven-day horizon, so
      // one pass per run was always enough. A daily commercial contract has
      // seven, and generating one per cron run would leave the crew's portal
      // showing tomorrow and nothing else. Fill the horizon instead.
      let cursor = String(sched.next_service_date);
      let lastGenerated: string | null = sched.last_generated_date
        ? String(sched.last_generated_date)
        : null;

      for (let visit = 0; visit < MAX_VISITS_PER_SCHEDULE && cursor <= horizon; visit++) {
        const target = cursor;
        const advance = nextDate(target, sched.cadence, sched.day_of_month, sched.days_of_week);
        if (lastGenerated && lastGenerated >= target) {
          // Already generated — just advance.
          await admin.from("partner_recurring_schedules").update({
            next_service_date: advance,
            updated_at: new Date().toISOString(),
          }).eq("id", sched.id);
          cursor = advance;
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
              // Commercial pricing inputs travel with the schedule so every
              // generated visit re-prices through the same formula (and hits the
              // same compliance and walkthrough gates) as the first one.
              facilityTypeKey: sched.facility_type_key || undefined,
              scopeLevel: sched.scope_level || undefined,
              squareFootage: sched.sqft || undefined,
              windowHours: sched.service_window_hours || undefined,
              numCleaners: sched.num_cleaners || undefined,
              scheduleId: sched.id,
            },
          });
          if (fnErr || res?.ok === false) throw new Error(fnErr?.message || res?.error || "book failed");
          await admin.from("partner_recurring_schedules").update({
            last_generated_date: target,
            next_service_date: advance,
            updated_at: new Date().toISOString(),
          }).eq("id", sched.id);
          lastGenerated = target;
          cursor = advance;
          generated++;
          log("generated", { scheduleId: sched.id, date: target, ref: res?.ref });
        } catch (e) {
          failed++;
          log("generate failed", { scheduleId: sched.id, error: e instanceof Error ? e.message : String(e) });
          // A blocked account (expired COI, unsigned agreement) fails every
          // visit the same way. Stop this schedule rather than hammering the
          // gate seven times and burying the reason in duplicate log lines.
          break;
        }
      }
    }
    return json({ ok: true, generated, failed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    return json({ ok: false, error: msg }, 500);
  }
});

// partner-jobs-generate
//
// Daily cron (09:00 UTC): the partner analogue of customer-recurring-generate.
// For every active partner_recurring_schedules row whose next_service_date is
// within the generation horizon, create the next booking through
// book-partner-job (same gates, same pay lock, same portal reflection) and
// advance the schedule. Idempotent via last_generated_date.
//
// ── Blocked accounts ──────────────────────────────────────────────────────
// A visit that comes due at an account whose COI has lapsed must not
// generate — but it must not vanish either. Both failure modes are bad in the
// same way: silently creating the job puts an uninsured crew on site, and
// silently skipping it means "we stopped servicing them" is discovered weeks
// later by the client rather than by us.
//
// So the visit is HELD: recorded in partner_recurring_holds with the reason,
// announced on the events bus, and left visible. Every subsequent run tries to
// release still-future holds whose account has since cleared, and marks the
// ones whose service date has passed as lapsed — which is the difference
// between a queue and a memory hole.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { accountCompliance } from "../_shared/commercial-config.ts";

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

/** The book-partner-job body for one visit of a schedule. */
// deno-lint-ignore no-explicit-any
function bookingBodyFor(sched: any, serviceDate: string) {
  return {
    bookingType: sched.booking_type,
    businessAccountId: sched.business_account_id || undefined,
    businessSiteId: sched.business_site_id || undefined,
    hostId: sched.host_id || undefined,
    propertyId: sched.property_id || undefined,
    serviceDate,
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
    // Commercial pricing inputs travel with the schedule so every generated
    // visit re-prices through the same formula (and hits the same compliance
    // and walkthrough gates) as the first one.
    facilityTypeKey: sched.facility_type_key || undefined,
    scopeLevel: sched.scope_level || undefined,
    squareFootage: sched.sqft || undefined,
    windowHours: sched.service_window_hours || undefined,
    numCleaners: sched.num_cleaners || undefined,
    scheduleId: sched.id,
  };
}

/**
 * Record a due visit that could not be generated, and say so out loud.
 *
 * Upserted on (schedule, date) so a retry re-states the reason instead of
 * stacking duplicates, and announced once — the second consecutive day of the
 * same block is not news.
 */
// deno-lint-ignore no-explicit-any
async function holdVisit(admin: any, sched: any, serviceDate: string, blockers: string[], accountName: string) {
  const reason = blockers.join(" ") || "Account compliance gap.";
  const { data: existing } = await admin.from("partner_recurring_holds")
    .select("id, status")
    .eq("schedule_id", sched.id).eq("service_date", serviceDate).maybeSingle();

  if (existing?.id) {
    await admin.from("partner_recurring_holds").update({
      reason, blockers, status: "held", updated_at: new Date().toISOString(),
    }).eq("id", existing.id);
    return;
  }

  await admin.from("partner_recurring_holds").insert({
    schedule_id: sched.id,
    business_account_id: sched.business_account_id || null,
    business_site_id: sched.business_site_id || null,
    service_date: serviceDate,
    reason,
    blockers,
  });

  await admin.from("events").insert({
    event_type: "commercial.recurring.held",
    source: "partner-jobs-generate",
    summary: `Recurring visit for ${accountName} on ${serviceDate} was HELD, not generated — ${reason}`,
    data: { schedule_id: sched.id, account_id: sched.business_account_id, service_date: serviceDate, blockers },
  }).then(() => undefined, () => undefined);
}

/**
 * Try to turn held visits into real bookings.
 *
 * Runs every pass, so an account that renewed its certificate overnight gets
 * its held visits back without anyone pressing anything. Holds whose service
 * date has already gone by are closed as lapsed — the visit did not happen,
 * and the record should say that rather than quietly disappearing.
 */
// deno-lint-ignore no-explicit-any
async function releaseHolds(admin: any): Promise<{ released: number; lapsed: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: holds } = await admin
    .from("partner_recurring_holds")
    .select("id, schedule_id, business_account_id, service_date")
    .eq("status", "held")
    .order("service_date", { ascending: true })
    .limit(200);
  if (!holds?.length) return { released: 0, lapsed: 0 };

  let released = 0, lapsed = 0;
  const complianceByAccount = new Map<string, boolean>();

  for (const hold of holds) {
    if (String(hold.service_date) < today) {
      await admin.from("partner_recurring_holds").update({
        status: "lapsed",
        resolution_note: "The service date passed while the account was still blocked — this visit did not happen.",
        updated_at: new Date().toISOString(),
      }).eq("id", hold.id);
      await admin.from("events").insert({
        event_type: "commercial.recurring.lapsed",
        source: "partner-jobs-generate",
        summary: `Recurring visit on ${hold.service_date} never happened — the account was still blocked when the date arrived.`,
        data: { hold_id: hold.id, schedule_id: hold.schedule_id, account_id: hold.business_account_id },
      }).then(() => undefined, () => undefined);
      lapsed++;
      continue;
    }

    const accountId = String(hold.business_account_id || "");
    if (!accountId) continue;
    if (!complianceByAccount.has(accountId)) {
      const compliance = await accountCompliance(admin, accountId);
      complianceByAccount.set(accountId, compliance.ok);
    }
    if (!complianceByAccount.get(accountId)) continue;

    const { data: sched } = await admin.from("partner_recurring_schedules")
      .select("*").eq("id", hold.schedule_id).maybeSingle();
    if (!sched || sched.active === false) continue;

    const { data: res, error: fnErr } = await admin.functions.invoke("book-partner-job", {
      body: bookingBodyFor(sched, String(hold.service_date)),
    });
    if (fnErr || res?.ok === false) {
      log("hold release failed", { holdId: hold.id, error: fnErr?.message || res?.error });
      continue;
    }

    await admin.from("partner_recurring_holds").update({
      status: "released",
      released_booking_id: res?.bookingId || null,
      released_at: new Date().toISOString(),
      resolution_note: "Account cleared — the held visit was generated automatically.",
      updated_at: new Date().toISOString(),
    }).eq("id", hold.id);
    await admin.from("events").insert({
      event_type: "commercial.recurring.released",
      booking_id: res?.bookingId || null,
      source: "partner-jobs-generate",
      summary: `Held recurring visit on ${hold.service_date} released and booked (${res?.ref || "booked"}) — the account's COI is current again.`,
      data: { hold_id: hold.id, schedule_id: hold.schedule_id, account_id: accountId },
    }).then(() => undefined, () => undefined);
    released++;
  }
  return { released, lapsed };
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

    let generated = 0, failed = 0, held = 0;
    // Compliance is per account, and several schedules commonly share one.
    const complianceCache = new Map<string, { ok: boolean; blockers: string[]; name: string }>();

    for (const sched of schedules) {
      // Check the account BEFORE trying to generate. Discovering the block by
      // catching book-partner-job's refusal would work, but it would look like
      // a failure in the logs when it is a deliberate hold — and the two want
      // very different responses from whoever reads them.
      let blocked: { blockers: string[]; name: string } | null = null;
      const accountId = String(sched.business_account_id || "");
      if (accountId) {
        if (!complianceCache.has(accountId)) {
          const compliance = await accountCompliance(admin, accountId);
          complianceCache.set(accountId, {
            ok: compliance.ok,
            blockers: compliance.blockers,
            name: compliance.business_name || "Account",
          });
        }
        const cached = complianceCache.get(accountId)!;
        if (!cached.ok) blocked = { blockers: cached.blockers, name: cached.name };
      }

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

        if (blocked) {
          // Held, not skipped. The cursor still advances so the schedule keeps
          // evaluating later dates — an account that renews mid-week should
          // get the rest of the week generated normally, with only the days it
          // was actually blocked sitting in holds.
          await holdVisit(admin, sched, target, blocked.blockers, blocked.name);
          await admin.from("partner_recurring_schedules").update({
            next_service_date: advance,
            updated_at: new Date().toISOString(),
          }).eq("id", sched.id);
          cursor = advance;
          held++;
          continue;
        }

        try {
          const { data: res, error: fnErr } = await admin.functions.invoke("book-partner-job", {
            body: bookingBodyFor(sched, target),
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
          const message = e instanceof Error ? e.message : String(e);
          log("generate failed", { scheduleId: sched.id, date: target, error: message });
          // Compliance is already handled above, so a failure here is
          // something else — a missing site, a walkthrough gate, a bad price.
          // Record it as a hold too rather than losing the visit, then stop
          // this schedule: the same cause will reject every remaining date.
          await holdVisit(
            admin,
            sched,
            target,
            [message],
            complianceCache.get(accountId)?.name || "Account",
          );
          held++;
          break;
        }
      }
    }

    // Anything held that can now go ahead, goes ahead — no manual unblock step.
    const { released, lapsed } = await releaseHolds(admin);

    return json({ ok: true, generated, failed, held, released, lapsed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    return json({ ok: false, error: msg }, 500);
  }
});

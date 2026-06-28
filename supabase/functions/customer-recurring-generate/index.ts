import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";
import { notifyCleanerOfAssignment } from "../_shared/notify-cleaner-assignment.ts";

// customer-recurring-generate
//
// Generates the next confirmed booking for each active customer recurring
// schedule, assigning the customer's preferred/previous cleaner, then syncs the
// booking to GHL + Airtable (via the bookings insert triggers + an explicit
// send-zapier-webhook) and to Google Calendar. Idempotent + gated:
//   • only `active` schedules with a `next_service_date`
//   • only when next_service_date is within `lead_days`
//   • never double-generates (last_generated_date guard + existing-booking check)
//
// Invoked by pg_cron daily, or by an admin with { scheduleId, force } to
// generate a specific schedule's next clean immediately.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
function json(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);

function advance(date: string, cadence: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (cadence === "weekly") d.setDate(d.getDate() + 7);
  else if (cadence === "monthly") d.setMonth(d.getMonth() + 1);
  else d.setDate(d.getDate() + 14); // biweekly default
  return ymd(d);
}

// deno-lint-ignore no-explicit-any
async function ensureAdminOrVa(admin: any, req: Request): Promise<void> {
  const auth = req.headers.get("Authorization");
  if (!auth) throw new Error("Admin authorization required");
  const token = auth.replace(/^Bearer\s+/i, "");
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: u } = await userClient.auth.getUser(token);
  if (!u?.user?.id) throw new Error("Not signed in");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  if (!(roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role))) throw new Error("Admins or VAs only");
}

// deno-lint-ignore no-explicit-any
async function resolveCleaner(admin: any, sched: any): Promise<string | null> {
  if (sched.preferred_cleaner_id) return sched.preferred_cleaner_id;
  // Fall back to the customer's most recent completed-booking cleaner.
  const { data } = await admin
    .from("bookings")
    .select("cleaner_id, completed_at, service_date")
    .eq("email", sched.email)
    .not("cleaner_id", "is", null)
    .in("status", ["completed", "assigned", "cleaner_confirmed", "in_progress"])
    .order("service_date", { ascending: false })
    .limit(1);
  return data && data.length ? data[0].cleaner_id : null;
}

// Shape a booking-like object the cleaner-assignment notifier understands,
// from the recurring schedule (the insert only selects `id` back).
// deno-lint-ignore no-explicit-any
function buildBookingForNotify(sched: any, serviceDate: string): Record<string, any> {
  return {
    first_name: sched.first_name,
    last_name: sched.last_name,
    address: sched.address,
    city: sched.city,
    state: sched.state,
    zip_code: sched.zip_code,
    service_type: sched.service_type || "standard",
    service_date: serviceDate,
    time_slot: sched.preferred_time_slot,
    total_estimate_cents: sched.price_cents ?? 0,
    num_cleaners_assigned: 1,
  };
}

// deno-lint-ignore no-explicit-any
async function generateOne(admin: any, sched: any, opts: { force?: boolean }): Promise<{ status: string; bookingId?: string; date?: string }> {
  if (!sched.next_service_date) return { status: "skipped_no_date" };
  const today = ymd(new Date());
  const dueBy = ymd(new Date(Date.now() + (sched.lead_days || 10) * 86400000));
  if (!opts.force && sched.next_service_date > dueBy) return { status: "not_due", date: sched.next_service_date };
  if (sched.last_generated_date && sched.last_generated_date >= sched.next_service_date) return { status: "already_generated", date: sched.next_service_date };

  // Idempotency: never create a duplicate for this schedule + date.
  const { data: existing } = await admin
    .from("bookings")
    .select("id")
    .eq("recurring_schedule_id", sched.id)
    .eq("service_date", sched.next_service_date)
    .maybeSingle();
  if (existing) {
    await admin.from("customer_recurring_schedules")
      .update({ last_generated_date: sched.next_service_date, next_service_date: advance(sched.next_service_date, sched.cadence), updated_at: new Date().toISOString() })
      .eq("id", sched.id);
    return { status: "existing", bookingId: existing.id, date: sched.next_service_date };
  }

  const cleanerId = await resolveCleaner(admin, sched);
  const serviceDate = sched.next_service_date;

  const { data: booking, error: insErr } = await admin
    .from("bookings")
    .insert({
      email: sched.email,
      first_name: sched.first_name,
      last_name: sched.last_name,
      phone: sched.phone,
      address: sched.address,
      city: sched.city,
      state: sched.state,
      zip_code: sched.zip_code,
      home_size_id: sched.home_size_id,
      service_type: sched.service_type || "standard",
      add_ons: sched.add_ons || [],
      membership_plan: sched.membership_plan,
      uses_credit: sched.uses_credit || false,
      service_date: serviceDate,
      time_slot: sched.preferred_time_slot,
      total_estimate_cents: sched.price_cents ?? 0,
      base_price_cents: sched.price_cents ?? 0,
      deposit_cents: 0, // recurring cleans are charged in full at completion (or via credit)
      payment_option: sched.uses_credit ? "credit" : "balance_on_completion",
      cleaner_id: cleanerId,
      num_cleaners_assigned: cleanerId ? 1 : 0,
      customer_id: sched.customer_id,
      recurring_schedule_id: sched.id,
      booking_channel: "recurring",
      status: "confirmed",
      dispatch_notes: cleanerId
        ? `RECURRING (${sched.cadence}) — assigned previous/preferred cleaner ${cleanerId}`
        : `RECURRING (${sched.cadence}) — needs cleaner assignment`,
    })
    .select("id")
    .single();
  if (insErr) {
    console.error("[customer-recurring-generate] insert failed", insErr);
    return { status: "error_" + (insErr.message || "insert") };
  }

  // Advance the schedule (idempotent for next run).
  await admin.from("customer_recurring_schedules")
    .update({ last_generated_date: serviceDate, next_service_date: advance(serviceDate, sched.cadence), updated_at: new Date().toISOString() })
    .eq("id", sched.id);

  // Notify the assigned contractor about the freshly-created recurring clean
  // (email + SMS) so the "create → confirm → notify cleaner" sequence is
  // complete. Best-effort: a notify failure never blocks generation.
  if (cleanerId) {
    try {
      const { data: cleaner } = await admin
        .from("cleaners")
        .select("id, email, phone, first_name, last_name, pay_percentage")
        .eq("id", cleanerId)
        .maybeSingle();
      if (cleaner) {
        await notifyCleanerOfAssignment(
          admin,
          { ...booking, ...buildBookingForNotify(sched, serviceDate) },
          cleaner,
          { role: "Lead" },
        );
      }
    } catch (e) {
      console.error("[customer-recurring-generate] notify cleaner failed", e);
    }
  }

  // GHL + Airtable happen automatically via the bookings INSERT triggers
  // (notify_ghl_sync -> send-zapier-webhook, notify_airtable_revops_sync).
  // Explicitly fire send-zapier-webhook + Google Calendar too (best-effort).
  try { await admin.functions.invoke("send-zapier-webhook", { body: { bookingId: booking.id } }); } catch (e) { console.error("zapier:", e); }
  try { await admin.functions.invoke("create-google-calendar-event", { body: { bookingId: booking.id } }); } catch (e) { console.error("gcal:", e); }
  try { await admin.functions.invoke("book-ghl-appointment", { body: { bookingId: booking.id } }); } catch (e) { console.error("ghl-appt:", e); }

  console.log("[customer-recurring-generate] generated", { scheduleId: sched.id, bookingId: booking.id, serviceDate, cleanerId });
  return { status: "created", bookingId: booking.id, date: serviceDate };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  try {
    const body = await req.json().catch(() => ({}));
    const scheduleId: string | undefined = body?.scheduleId;
    const force: boolean = body?.force === true;

    // Admin-triggered single-schedule run requires admin auth; the cron sweep
    // (no scheduleId) runs unauthenticated as the service role.
    if (scheduleId) await ensureAdminOrVa(admin, req);

    let schedules: any[] = [];
    if (scheduleId) {
      const { data } = await admin.from("customer_recurring_schedules").select("*").eq("id", scheduleId).limit(1);
      schedules = data || [];
    } else {
      const dueBy = ymd(new Date(Date.now() + 14 * 86400000));
      const { data } = await admin
        .from("customer_recurring_schedules")
        .select("*")
        .eq("active", true)
        .not("next_service_date", "is", null)
        .lte("next_service_date", dueBy);
      schedules = data || [];
    }

    const results: Array<Record<string, unknown>> = [];
    for (const s of schedules) {
      try {
        const r = await generateOne(admin, s, { force });
        results.push({ scheduleId: s.id, email: s.email, ...r });
      } catch (e) {
        results.push({ scheduleId: s.id, status: "error", message: e instanceof Error ? e.message : String(e) });
      }
    }

    const created = results.filter((r) => r.status === "created").length;
    return json({ success: true, considered: schedules.length, created, results });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[customer-recurring-generate] ERROR", msg);
    return json({ success: false, error: msg }, 400);
  }
});

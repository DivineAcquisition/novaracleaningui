// admin-booking-assign
//
// Admin/VA manual assign or reassign cleaners from the directory to a booking.
// Updates job_assignments + bookings, then syncs GHL ops fields via PIT.
// Notifies cleaners (email + SMS) and creates a GHL contact task when configured.
//
// Body (assign):
//   { bookingId, cleanerIds: string[], mode?: "replace" | "add", notify?: boolean,
//     bufferOverrideReason?: string }
//
// Body (suggest):
//   { action: "suggest_cleaners", bookingId, limit?: number }
//
// Body (directory — all non-terminated cleaners, service role):
//   { action: "list_directory" }
//
// Assigning a crew that already has a job that day must leave the required
// buffer after that job's PROJECTED end. Blocked by default with the projected
// -end explanation; bufferOverrideReason forces it and logs why.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";
import { scoreCleanerForJob, type RankedCleaner } from "../_shared/dispatch-scoring.ts";
import { createContactTask } from "../_shared/ghl-tasks.ts";
import { buildGhlTaskChecklistBody } from "../_shared/ghl-checklist-text.ts";
import { notifyCleanerOfAssignment } from "../_shared/notify-cleaner-assignment.ts";
import { ensureAssignmentChecklistAccess } from "../_shared/job-checklist.ts";
import { jobServiceTypeForBooking, contractorChecklistKeyForBooking } from "../_shared/contractor-checklists.ts";
import { parseTimeSlotToClock } from "../_shared/sms.ts";
import {
  bufferConflictBody,
  checkScheduleBuffer,
  recordBufferOverride,
} from "../_shared/schedule-buffer.ts";
import { computeCrewPay, shareFor } from "../_shared/crew-pay.ts";
import { jobValueForPay } from "../_shared/reclean.ts";
import {
  accountCompliance,
  COI_CONSOLE_PATH,
  complianceBlockMessage,
  logComplianceBlock,
} from "../_shared/commercial-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// bookings.customer_id is dual-use: it can hold a real customers.id (uuid)
// OR a Stripe customer id ("cus_…") used by the balance-charge flows. jobs
// .customer_id is a strict uuid column, so only copy the value through when
// it actually looks like a uuid — otherwise the jobs insert throws
// "invalid input syntax for type uuid" and the whole assign 500s.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

// Has the customer actually paid the deposit yet? Internal (book-as-va)
// bookings are created as status="confirmed" the moment a deposit invoice
// is SENT — long before the customer pays it — so status alone is not a
// reliable signal. A deposit is considered settled when money has cleared
// (payment_received_at / balance_charged_at / final_charge_cents), the
// booking was paid via Stripe Checkout (status="booked"), the job is
// already completed, or there is simply no deposit to collect.
// deno-lint-ignore no-explicit-any
function depositSettled(booking: any): boolean {
  const depositCents = Number(booking?.deposit_cents || 0);
  if (depositCents <= 0) return true;
  if (booking?.payment_received_at) return true;
  if (booking?.balance_charged_at) return true;
  if (Number(booking?.final_charge_cents || 0) > 0) return true;
  if (String(booking?.payment_status || "").toLowerCase() === "paid") return true;
  if (["booked", "assigned", "completed"].includes(String(booking?.status || "").toLowerCase())) {
    return true;
  }
  return false;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

// Returns the acting user's id, or null for a trusted server-to-server call.
//
// The service-role branch exists so a cleaner ACCEPTING a coverage offer from a
// tokenized SMS link lands on this same canonical assign path (complete job
// transfer, prior crew withdrawn, checklist tokens issued) instead of a second
// implementation of assignment that would inevitably drift from this one. Only
// the service-role key itself opens it, and the caller must name who acted.
async function ensureAdminOrVa(
  admin: ReturnType<typeof createClient>,
  jwt: string,
): Promise<string | null> {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (serviceKey && jwt === serviceKey) return null;

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: u } = await userClient.auth.getUser();
  const callerId = u?.user?.id;
  if (!callerId) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", callerId);
  const allowed = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
  if (!allowed) throw new Error("Admins or VAs only.");
  return callerId;
}

function parseTimeSlot(timeSlot: string): string {
  // Shared parser: handles canonical slot ids ("8-12"), named windows, and
  // freeform "8:00 AM - 12:00 PM". Falls back to 09:00 only when unparseable.
  return parseTimeSlotToClock(timeSlot).start || "09:00:00";
}

async function resolveJobCoordinates(
  admin: ReturnType<typeof createClient>,
  booking: Record<string, unknown>,
  jobId: string | null,
): Promise<{ lat: number; lng: number } | null> {
  if (jobId) {
    const { data: job } = await admin.from("jobs").select("lat, lng").eq("id", jobId).maybeSingle();
    if (job?.lat && job?.lng) return { lat: Number(job.lat), lng: Number(job.lng) };
  }
  try {
    const geo = await admin.functions.invoke("geocode-address", {
      body: {
        address: booking.address,
        city: booking.city,
        state: booking.state,
        zip: booking.zip_code,
      },
    });
    const g = (geo?.data as { lat?: number; lng?: number }) || {};
    if (g.lat && g.lng) {
      if (jobId) {
        await admin.from("jobs").update({ lat: g.lat, lng: g.lng }).eq("id", jobId);
      }
      return { lat: g.lat, lng: g.lng };
    }
  } catch {
    /* non-fatal */
  }
  return null;
}

async function suggestCleaners(
  admin: ReturnType<typeof createClient>,
  booking: Record<string, unknown>,
  limit = 12,
): Promise<RankedCleaner[]> {
  const coords = await resolveJobCoordinates(
    admin,
    booking,
    (booking.job_id as string | null) || null,
  );

  // What the site's walkthrough recorded it needs. Advisory, not a filter:
  // one crew member can bring the scrubber, and excluding everyone who has not
  // ticked a box would break dispatch for the many sites that need nothing
  // special. The gap is shown so a human decides.
  let requiredEquipment: string[] = [];
  if (booking.business_site_id) {
    const { data: site } = await admin.from("business_sites")
      .select("required_equipment").eq("id", booking.business_site_id).maybeSingle();
    const req = (site as { required_equipment?: string[] } | null)?.required_equipment;
    if (Array.isArray(req)) requiredEquipment = req.map(String).filter(Boolean);
  }

  const serviceDate = String(booking.service_date || "");
  const weekday = serviceDate
    ? new Date(`${serviceDate}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" })
    : new Date().toLocaleDateString("en-US", { weekday: "short" });

  const { data: cleaners } = await admin
    .from("cleaners")
    .select(
      "id, first_name, last_name, email, phone, status, approved, available_for_bookings, home_lat, home_lng, average_rating, total_ratings, workload_score, acceptance_rate, on_time_rate, preferred_work_days, max_travel_miles, max_weekly_bookings, supply_inventory",
    )
    .eq("approved", true)
    .eq("available_for_bookings", true)
    .eq("status", "active");

  if (!cleaners?.length) return [];

  const cleanerIds = cleaners.map((c: { id: string }) => c.id);
  const { data: upcomingJobsData } = await admin
    .from("job_assignments")
    .select("cleaner_id, jobs(start_datetime)")
    .in("cleaner_id", cleanerIds)
    .in("status", ["Offered", "Confirmed"])
    .gte("jobs.start_datetime", new Date().toISOString());

  const upcomingJobsMap = new Map<string, number>();
  upcomingJobsData?.forEach((a: { cleaner_id: string }) => {
    upcomingJobsMap.set(a.cleaner_id, (upcomingJobsMap.get(a.cleaner_id) || 0) + 1);
  });

  const ranked: RankedCleaner[] = [];

  for (const c of cleaners) {
    const upcoming = upcomingJobsMap.get(c.id) || 0;
    let score = 0;
    let distance: number | null = null;
    let available = true;
    let reason: string | undefined;

    if (coords) {
      const result = scoreCleanerForJob(
        { ...c, upcoming_jobs_count: upcoming },
        { lat: coords.lat, lng: coords.lng, weekday },
      );
      score = result.score;
      distance = result.distance;
      available = result.available;
      reason = result.reason;
    } else {
      score = 50 - upcoming * 5;
      available = upcoming < (c.max_weekly_bookings || 10);
      reason = coords ? undefined : "job_location_unknown";
    }

    if (!available && coords) continue;

    const inventory = (c.supply_inventory || {}) as Record<string, boolean>;
    const missingEquipment = requiredEquipment.filter((id) => inventory[id] !== true);

    ranked.push({
      id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      email: c.email,
      phone: c.phone,
      distance_miles: distance != null ? Math.round(distance * 10) / 10 : null,
      match_score: score,
      available,
      reason,
      requiredEquipment,
      missingEquipment,
      equipmentReady: missingEquipment.length === 0,
    });
  }

  // Contractors who have certified the equipment this site needs come first;
  // within each group the existing ranking is untouched.
  ranked.sort((a, b) =>
    Number(b.equipmentReady ?? true) - Number(a.equipmentReady ?? true) ||
    b.match_score - a.match_score
  );
  return ranked.slice(0, limit);
}

function checklistUrl(serviceType: string | null): string {
  const key = String(serviceType || "standard").toLowerCase().replace(/-/g, "_");
  const map: Record<string, string> = {
    standard: "https://try.novaracleaning.com/checklist/standard-clean",
    deep: "https://try.novaracleaning.com/checklist/deep-clean",
    move_in_out: "https://try.novaracleaning.com/checklist/move-in-out",
    recurring: "https://try.novaracleaning.com/checklist/recurring",
  };
  return map[key] || map.standard;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Not signed in." }, 401);
    const callerId = await ensureAdminOrVa(admin, jwt);

    const body = await req.json().catch(() => ({}));
    // Server-to-server callers say who they are acting for, so the audit trail
    // never reads as "the system did it" when a person or a cleaner did.
    const actorLabel = String(body?.actorName || "").trim() || (callerId ? "Admin" : "System");
    const action = String(body?.action || "assign").toLowerCase();
    const bookingId = String(body?.bookingId || "").trim();

    if (action === "list_directory") {
      const { data: directory, error: dirErr } = await admin
        .from("cleaners")
        .select(
          "id, first_name, last_name, phone, status, approved, available_for_bookings, pay_tier, pay_percentage, home_city, home_zip, state",
        )
        .neq("status", "terminated")
        .order("last_name", { ascending: true })
        .order("first_name", { ascending: true });
      if (dirErr) return json({ error: dirErr.message }, 500);
      return json({ success: true, cleaners: directory || [] });
    }

    if (!bookingId) return json({ error: "bookingId required" }, 400);

    const { data: booking, error: bErr } = await admin
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();
    if (bErr || !booking) return json({ error: "booking not found" }, 404);

    if (action === "suggest_cleaners") {
      const suggestions = await suggestCleaners(admin, booking, Number(body?.limit) || 12);
      // Mark who would land inside their own buffer, so the ranking doesn't
      // walk an admin into a block (or into starting a fresh cascade).
      const bufferView = await checkScheduleBuffer(admin, {
        bookingId,
        cleanerIds: suggestions.map((s) => s.id),
      });
      const conflictByCleaner = new Map<string, string>();
      for (const c of bufferView.conflicts || []) {
        if (c.cleaner_id && !conflictByCleaner.has(c.cleaner_id)) {
          conflictByCleaner.set(c.cleaner_id, c.message);
        }
      }
      return json({
        success: true,
        bookingId,
        suggestions: suggestions.map((s) => ({
          ...s,
          bufferConflict: conflictByCleaner.get(s.id) || null,
        })),
        hasCoordinates: suggestions.some((s) => s.distance_miles != null),
      });
    }

    const cleanerIds = (Array.isArray(body?.cleanerIds) ? body.cleanerIds : [])
      .map((id: unknown) => String(id).trim())
      .filter(Boolean)
      // A large commercial facility on a short overnight window legitimately
      // needs a crew well past the residential two.
      .slice(0, 12);
    const mode = String(body?.mode || "replace").toLowerCase();
    const shouldNotify = body?.notify !== false;

    if (cleanerIds.length === 0) return json({ error: "cleanerIds required (1–12)" }, 400);

    // Commercial compliance gate: a signed agreement and a current COI are
    // required to DISPATCH, not only to book. A certificate that was valid on
    // the day the job was booked can lapse before the visit, and sending a
    // crew to a site we are no longer insured to be on is the failure this
    // exists to prevent. The gap sits on the account, so it applies to every
    // site under it.
    if (booking.business_account_id) {
      const compliance = await accountCompliance(admin, String(booking.business_account_id));
      if (!compliance.ok) {
        await logComplianceBlock(admin, {
          compliance,
          action: "Crew assignment",
          bookingId,
          detail: { cleaner_ids: cleanerIds, service_date: booking.service_date },
        });
        return json({
          error: complianceBlockMessage(compliance, "Assigning a crew to this job"),
          code: "account_compliance_blocked",
          blockers: compliance.blockers,
          coiStatus: compliance.coi_status,
          fixPath: COI_CONSOLE_PATH,
        }, 409);
      }
    }

    // Deposit gate: don't dispatch a cleaner to a job the customer hasn't
    // paid for yet (common on internal/VA bookings whose deposit invoice is
    // still unpaid). Admins can override with allowUnpaid for cash/comp jobs.
    const allowUnpaid = body?.allowUnpaid === true;
    if (!allowUnpaid && !depositSettled(booking)) {
      return json({
        error:
          "Customer hasn't paid the deposit yet. Wait for the deposit to clear " +
          "before assigning a cleaner, or re-submit with allowUnpaid to override.",
        code: "deposit_unpaid",
      }, 402);
    }

    const { data: cleaners } = await admin
      .from("cleaners")
      .select("id, first_name, last_name, email, phone, status, approved, available_for_bookings, pay_percentage")
      .in("id", cleanerIds);
    if (!cleaners || cleaners.length !== cleanerIds.length) {
      return json({ error: "One or more cleaners not found in directory" }, 404);
    }
    for (const c of cleaners) {
      if (c.status === "terminated") {
        return json({ error: `Cannot assign terminated cleaner: ${c.first_name} ${c.last_name}` }, 400);
      }
      if (c.status && c.status !== "active") {
        return json({ error: `Cleaner is not active: ${c.first_name} ${c.last_name}` }, 400);
      }
    }

    // ─── Buffer gate ────────────────────────────────────────────────────────
    // A crew with an earlier job that day needs real room after that job's
    // projected end — not after the window we hoped for. Blocked by default,
    // forced only by an explicit reason that goes on the record.
    const bufferOverrideReason = String(body?.bufferOverrideReason || "").trim();
    const bufferCheck = await checkScheduleBuffer(admin, { bookingId, cleanerIds });
    if (!bufferCheck.ok) {
      if (!bufferOverrideReason) {
        return json(bufferConflictBody(bufferCheck), 409);
      }
      let actorName = actorLabel;
      if (callerId) {
        try {
          const { data: u } = await admin.auth.admin.getUserById(callerId);
          actorName = u?.user?.email || actorName;
        } catch { /* name is nice to have, not required */ }
      }
      const logged = await recordBufferOverride(admin, {
        bookingId,
        cleanerIds,
        check: bufferCheck,
        reason: bufferOverrideReason,
        actorId: callerId ?? undefined,
        actorName,
      });
      if (!logged.ok) return json({ error: logged.error }, 400);
    }

    let jobId = booking.job_id as string | null;
    if (!jobId) {
      const startTime = parseTimeSlot(booking.time_slot || "morning");
      const startDatetime = `${booking.service_date}T${startTime}`;
      const duration = Number(booking.estimated_duration_hours) || 3;
      const { data: job, error: jobErr } = await admin
        .from("jobs")
        .insert({
          customer_id: uuidOrNull(booking.customer_id),
          address: booking.address,
          city: booking.city,
          state: booking.state,
          zip: booking.zip_code,
          service_type: jobServiceTypeForBooking(booking),
          start_datetime: startDatetime,
          duration_est_hours: duration,
          sq_ft: Math.round(Number(booking.sqft) || 2000),
          bedrooms: Math.round(Number(booking.bedrooms) || 0),
          bathrooms: Number(booking.bathrooms) || 0,
          min_cleaners_required: cleanerIds.length,
          status: "Assigned",
          notes: booking.dispatch_notes || booking.team_notes || null,
        })
        .select("id")
        .single();
      if (jobErr || !job) throw jobErr || new Error("job create failed");
      jobId = job.id;
      await admin.from("bookings").update({ job_id: jobId }).eq("id", bookingId);
      booking.job_id = jobId;
    }

    // Snapshot the ACTIVE crew before any withdraw — needed for crew-size
    // change notifications and for detecting locked (post-completion) pay.
    const { data: priorAssigns } = await admin
      .from("job_assignments")
      .select("id, cleaner_id, estimated_pay_cents, pay_percentage_snapshot, crew_size_snapshot, pay_locked_at, status")
      .eq("job_id", jobId)
      .in("status", [
        "Offered", "Broadcast", "Accepted", "accepted",
        "Confirmed", "Assigned", "assigned", "In Progress", "in_progress",
        "completed", "Completed",
      ]);
    const priorCrewSize = Math.max(
      0,
      ...((priorAssigns || []).map((a: { crew_size_snapshot?: number | null }) =>
        Number(a.crew_size_snapshot) || 0
      )),
      (priorAssigns || []).length,
      Number(booking.num_cleaners_assigned) || 0,
    );
    const priorPayByCleaner = new Map<string, number>();
    for (const a of priorAssigns || []) {
      if (a.cleaner_id) {
        priorPayByCleaner.set(String(a.cleaner_id), Number(a.estimated_pay_cents) || 0);
      }
    }
    const lockedRows = (priorAssigns || []).filter((a: { pay_locked_at?: string | null }) => !!a.pay_locked_at);
    const payRecalcReason = String(body?.payRecalcReason || body?.reason || "").trim();
    if (lockedRows.length > 0 && !payRecalcReason) {
      return json({
        error:
          "Pay is locked for this job (already completed). Provide payRecalcReason to recalculate and log the change.",
        code: "pay_locked",
      }, 409);
    }

    if (mode === "replace") {
      // Withdraw EVERY prior active assignee (not just open offers). Leaving
      // Confirmed / In Progress rows in place made unassigned cleaners keep
      // seeing the job under Upcoming on their dashboards.
      await admin
        .from("job_assignments")
        .update({ status: "Withdrawn" })
        .eq("job_id", jobId)
        .not("cleaner_id", "in", `(${cleanerIds.join(",")})`)
        .in("status", [
          "Offered",
          "Broadcast",
          "Accepted",
          "accepted",
          "Confirmed",
          "Assigned",
          "assigned",
          "In Progress",
          "in_progress",
        ]);
    }

    const jobValueCents = jobValueForPay(booking);
    const shares = await computeCrewPay(admin, jobValueCents, cleanerIds);
    const shareByCleaner = new Map(shares.map((s) => [s.cleanerId, s]));

    const now = new Date().toISOString();
    for (let i = 0; i < cleanerIds.length; i++) {
      const cid = cleanerIds[i];
      const role = i === 0 ? "Lead" : "Support";
      const share = shareByCleaner.get(cid);
      const { error: upsertErr } = await admin.from("job_assignments").upsert(
        {
          job_id: jobId,
          cleaner_id: cid,
          role,
          status: "Confirmed",
          accepted_at: now,
          responded_at: now,
          estimated_pay_cents: share?.shareCents ?? null,
          pay_percentage_snapshot: share?.ratePercent ?? null,
          crew_size_snapshot: share?.crewSize ?? cleanerIds.length,
          reliability_neutral: Boolean(booking.is_reclean),
        },
        { onConflict: "job_id,cleaner_id" },
      );
      if (upsertErr) throw upsertErr;

      if (lockedRows.length > 0 && share) {
        const prior = priorPayByCleaner.get(cid) ?? null;
        const priorRate = (priorAssigns || []).find(
          (a: { cleaner_id: string }) => a.cleaner_id === cid,
        ) as { pay_percentage_snapshot?: number | null } | undefined;
        await admin.from("cleaner_pay_recalcs").insert({
          job_id: jobId,
          booking_id: bookingId,
          cleaner_id: cid,
          reason: payRecalcReason,
          performed_by: callerId,
          crew_size_before: priorCrewSize || null,
          crew_size_after: share.crewSize,
          rate_before: priorRate?.pay_percentage_snapshot ?? null,
          rate_after: share.ratePercent,
          pay_before_cents: prior,
          pay_after_cents: share.shareCents,
        }).then(() => undefined, () => undefined);
      }
    }

    // Guarantee each assignment has a response_token + the job has its
    // contractor checklist row — manual assignments historically skipped
    // both, which broke every tokenized contractor link (checklist,
    // offer page, photo upload).
    for (const cid of cleanerIds) {
      try {
        await ensureAssignmentChecklistAccess(admin, {
          jobId: String(jobId),
          cleanerId: cid,
          bookingId,
          serviceType: (booking.service_type as string | null) || null,
        });
      } catch (tokenErr) {
        console.error("[admin-booking-assign] checklist access ensure failed (non-blocking)", cid, tokenErr instanceof Error ? tokenErr.message : String(tokenErr));
      }
    }

    const leadId = cleanerIds[0];
    await admin
      .from("bookings")
      .update({
        cleaner_id: leadId,
        assigned_at: now,
        status: booking.status === "confirmed" ? "assigned" : booking.status,
        num_cleaners_assigned: cleanerIds.length,
      })
      .eq("id", bookingId);

    booking.num_cleaners_assigned = cleanerIds.length;

    // Pre-completion crew-size change: remaining cleaners' displayed pay
    // already updated on assignment rows above. Do NOT SMS about the
    // recalculation — ops/cleaners see the new estimate in the portal.

    await admin.from("jobs").update({
      status: "Assigned",
      service_type: jobServiceTypeForBooking(booking),
    }).eq("id", jobId);

    await admin.from("events").insert({
      event_type: "booking.manually_assigned",
      booking_id: bookingId,
      job_id: jobId,
      source: "admin-booking-assign",
      summary:
        `Manual assign: ${cleaners.map((c: { first_name: string; last_name: string }) => `${c.first_name} ${c.last_name}`).join(", ")}` +
        ` — by ${actorLabel}`,
      data: { cleanerIds, mode, by: callerId, actor: actorLabel },
    });

    // GHL: the bookings UPDATE above (cleaner_id / status /
    // num_cleaners_assigned) already fires notify_ghl_sync → one
    // send-zapier-webhook. Do NOT also call syncBookingOpsFieldsToGhl +
    // invokeFullBookingGhlSync here — that was patching the same
    // opportunities 2–3 times per assign.

    const notifications: Array<{ cleanerId: string; email?: boolean; sms?: boolean; ghlTaskId?: string | null }> = [];

    if (shouldNotify) {
      const customerName =
        `${booking.first_name || ""} ${booking.last_name || ""}`.trim() || "Customer";
      const ghlContactId = (booking.ghl_contact_id as string | null) || "";

      for (let i = 0; i < cleaners.length; i++) {
        const c = cleaners[i];
        const role = i === 0 ? "Lead" : "Support";
        try {
        const notifyResult = await notifyCleanerOfAssignment(admin, booking, c, {
          role,
          estimatedPayCents: shareByCleaner.get(c.id)?.shareCents,
          crewCleanerIds: cleanerIds,
        });
        let ghlTaskId: string | null = null;

        if (ghlContactId) {
          const checklistKey = contractorChecklistKeyForBooking(booking, booking.service_type as string | null);
          const taskBody = buildGhlTaskChecklistBody(checklistKey, {
            bookingLine:
              `${customerName} · ${booking.service_date || "TBD"} ${booking.time_slot || ""}\n` +
              `${booking.address || ""}, ${booking.city || ""} ${booking.state || ""}\n` +
              `Booking #${booking.booking_number || bookingId.slice(0, 8)}`,
            roleLine: `Assigned (${role}): ${c.first_name} ${c.last_name}`,
          });
          const serviceTitle = (checklistKey === "recurring" ? "Maintenance" : String(booking.service_type || "standard"))
            .replace(/_/g, " ")
            .replace(/\b\w/g, (ch: string) => ch.toUpperCase());
          const taskRes = await createContactTask(ghlContactId, {
            title: `${serviceTitle} — ${customerName} (${role})`,
            body: taskBody,
            dueDate: booking.service_date
              ? `${booking.service_date}T09:00:00.000Z`
              : undefined,
          });
          ghlTaskId = taskRes.taskId;
        }

        notifications.push({
          cleanerId: c.id,
          email: notifyResult.email,
          sms: notifyResult.sms,
          ghlTaskId,
        });
        } catch (notifyErr) {
          // Notification/GHL-task failure must not fail the assignment.
          console.error("[admin-booking-assign] notify failed (non-blocking)", c.id, notifyErr instanceof Error ? notifyErr.message : String(notifyErr));
          notifications.push({ cleanerId: c.id, email: false, sms: false, ghlTaskId: null });
        }
      }
    }

    return json({
      success: true,
      bookingId,
      jobId,
      cleanerIds,
      assigned: cleaners.map((c: { id: string; first_name: string; last_name: string; phone: string }) => ({
        id: c.id,
        name: `${c.first_name} ${c.last_name}`.trim(),
        phone: c.phone,
      })),
      notifications,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin-booking-assign]", msg);
    return json({ error: msg }, 500);
  }
});

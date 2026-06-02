// Auto-backfill open cleaner slots after expired/declined offers; alert staff when exhausted.

const log = (s: string, d?: unknown) =>
  console.log(`[dispatch-backfill] ${s}${d ? ` ${JSON.stringify(d)}` : ""}`);

const BLOCKED_STATUSES = new Set([
  "offered",
  "confirmed",
  "accepted",
  "assigned",
  "in progress",
  "broadcast",
  "declined",
  "expired",
  "withdrawn",
  "broadcast_lost",
]);

export interface JobTeamStatus {
  jobId: string;
  need: number;
  confirmed: number;
  openSlots: number;
  blockedCleanerIds: Set<string>;
}

export async function getJobTeamStatus(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  jobId: string,
): Promise<JobTeamStatus | null> {
  const { data: job } = await supabase
    .from("jobs")
    .select("id, min_cleaners_required")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return null;

  const { count: confirmed } = await supabase
    .from("job_assignments")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .or("status.ilike.confirmed,status.ilike.accepted");

  const { data: existing } = await supabase
    .from("job_assignments")
    .select("cleaner_id, status")
    .eq("job_id", jobId);

  const blockedCleanerIds = new Set<string>();
  for (const row of existing || []) {
    const s = String(row.status || "").toLowerCase();
    if (BLOCKED_STATUSES.has(s)) blockedCleanerIds.add(row.cleaner_id);
  }

  const need = Number(job.min_cleaners_required) || 1;
  const confirmedCount = confirmed ?? 0;
  return {
    jobId,
    need,
    confirmed: confirmedCount,
    openSlots: Math.max(0, need - confirmedCount),
    blockedCleanerIds,
  };
}

/** True if any active cleaner could still receive an offer on this job. */
export async function hasEligibleCleanersRemaining(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  blockedCleanerIds: Set<string>,
): Promise<boolean> {
  const { data: cleaners } = await supabase
    .from("cleaners")
    .select("id")
    .eq("approved", true)
    .eq("available_for_bookings", true)
    .eq("status", "active");

  for (const c of cleaners || []) {
    if (!blockedCleanerIds.has(c.id)) return true;
  }
  return false;
}

export async function resolveStaffAlertEmails(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<string[]> {
  const emails = new Set<string>();

  const extra = (Deno.env.get("DISPATCH_ALERT_EMAILS") || "").trim();
  for (const e of extra.split(/[,;]/)) {
    const t = e.trim().toLowerCase();
    if (t.includes("@")) emails.add(t);
  }

  try {
    const { data: secret } = await supabase
      .from("app_secrets")
      .select("value")
      .eq("key", "DISPATCH_ALERT_EMAILS")
      .maybeSingle();
    const v = String(secret?.value || "").trim();
    for (const e of v.split(/[,;]/)) {
      const t = e.trim().toLowerCase();
      if (t.includes("@")) emails.add(t);
    }
  } catch (_) { /* ignore */ }

  const fallback = (Deno.env.get("OPS_ALERT_EMAIL") || "contact@novaracleaning.com").trim();
  if (emails.size === 0 && fallback.includes("@")) emails.add(fallback.toLowerCase());

  const { data: roles } = await supabase
    .from("user_roles")
    .select("user_id, role")
    .in("role", ["admin", "va"]);

  for (const row of roles || []) {
    try {
      const { data: userData, error } = await supabase.auth.admin.getUserById(row.user_id);
      if (!error && userData?.user?.email) {
        emails.add(userData.user.email.toLowerCase());
      }
    } catch (_) { /* skip */ }
  }

  return [...emails];
}

export async function notifyStaffNoCleanersAvailable(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  jobId: string,
  context: { reason: string },
): Promise<{ sent: boolean; recipients: number }> {
  const { data: prior } = await supabase
    .from("events")
    .select("id")
    .eq("job_id", jobId)
    .eq("event_type", "dispatch.no_cleaners_staff_alert")
    .limit(1)
    .maybeSingle();
  if (prior?.id) {
    log("staff alert already sent", { jobId });
    return { sent: false, recipients: 0 };
  }

  const { data: job } = await supabase
    .from("jobs")
    .select("id, address, city, state, zip, service_type, start_datetime, min_cleaners_required, dispatch_alert_reason")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return { sent: false, recipients: 0 };

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, booking_number, first_name, last_name, email, phone, service_date, time_slot")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const team = await getJobTeamStatus(supabase, jobId);
  const recipients = await resolveStaffAlertEmails(supabase);
  if (recipients.length === 0) {
    log("no staff emails configured", { jobId });
    return { sent: false, recipients: 0 };
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    log("RESEND_API_KEY missing");
    return { sent: false, recipients: 0 };
  }

  const { Resend } = await import("https://esm.sh/resend@4.0.0");
  const resend = new Resend(resendKey);

  const ref = booking?.booking_number
    ? `NOV-${String(booking.booking_number).padStart(5, "0")}`
    : jobId.slice(0, 8);
  const when = job.start_datetime
    ? new Date(job.start_datetime).toLocaleString("en-US", { timeZone: "America/New_York" })
    : booking?.service_date || "TBD";
  const customer = booking
    ? `${booking.first_name || ""} ${booking.last_name || ""}`.trim()
    : "—";
  const location = [job.address, job.city, job.state, job.zip].filter(Boolean).join(", ");

  const subject = `URGENT: No cleaners available — ${ref} (${when})`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 640px;">
      <h2 style="color: #b45309;">No cleaners available for dispatch</h2>
      <p>Auto-dispatch exhausted the active cleaner pool (offers expired, declined, or no eligible cleaners left). <strong>Hire or onboard a cleaner ASAP</strong> and assign manually in Admin.</p>
      <p style="color:#374151;"><strong>Reason:</strong> ${context.reason}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600;">Booking</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${ref}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600;">Customer</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${customer}${booking?.phone ? ` · ${booking.phone}` : ""}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600;">Service</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${job.service_type || "—"} · ${when}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600;">Location</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${location || "—"}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600;">Team needed</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${team?.confirmed ?? 0} / ${team?.need ?? job.min_cleaners_required} confirmed</td></tr>
      </table>
      <p><a href="https://admin.novaracleaning.com/admin/bookings">Open Admin Bookings</a> · <a href="https://admin.novaracleaning.com/admin/map">Dispatch map</a></p>
    </div>`;

  try {
    await resend.emails.send({
      from: "Novara Cleaning Ops <hello@novaracleaning.com>",
      to: recipients,
      subject,
      html,
    });
  } catch (e) {
    log("resend failed", e instanceof Error ? e.message : String(e));
    return { sent: false, recipients: 0 };
  }

  await supabase.from("jobs").update({
    status: "Dispatching",
    manual_intervention_required: true,
    dispatch_alert_reason: `No cleaners available — staff alerted (${context.reason})`,
  }).eq("id", jobId);

  await supabase.from("dispatch_alerts").insert({
    job_id: jobId,
    reason: `No cleaners available: ${context.reason}`,
    severity: "critical",
  });

  await supabase.from("events").insert({
    event_type: "dispatch.no_cleaners_staff_alert",
    job_id: jobId,
    booking_id: booking?.id || null,
    source: "dispatch-backfill",
    summary: subject,
    data: { reason: context.reason, recipients, confirmed: team?.confirmed, need: team?.need },
  });

  log("staff alert sent", { jobId, recipients: recipients.length });
  return { sent: true, recipients: recipients.length };
}

export interface BackfillResult {
  ok: boolean;
  openSlots: number;
  offersSent: number;
  noCleanersAvailable: boolean;
  staffNotified: boolean;
}

/**
 * Re-run proximity dispatch for unfilled slots; email staff if nobody left to offer.
 */
export async function runJobDispatchBackfill(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  jobId: string,
  reason: string,
): Promise<BackfillResult> {
  const team = await getJobTeamStatus(supabase, jobId);
  if (!team || team.openSlots === 0) {
    return { ok: true, openSlots: 0, offersSent: 0, noCleanersAvailable: false, staffNotified: false };
  }

  const eligible = await hasEligibleCleanersRemaining(supabase, team.blockedCleanerIds);
  if (!eligible) {
    const { sent } = await notifyStaffNoCleanersAvailable(supabase, jobId, { reason });
    return {
      ok: false,
      openSlots: team.openSlots,
      offersSent: 0,
      noCleanersAvailable: true,
      staffNotified: sent,
    };
  }

  const { data: dispatchData, error: dispatchErr } = await supabase.functions.invoke("dispatch-job", {
    body: { jobId, backfill: true },
  });

  if (dispatchErr) {
    log("dispatch-job invoke error", { jobId, err: dispatchErr.message });
  }

  const payload = (dispatchData as Record<string, unknown>) || {};
  const offersSent = Number(payload.offersSent ?? payload.assignedCleaners ?? 0);
  const noCleaners = payload.noCleanersAvailable === true;

  if (noCleaners || (offersSent === 0 && team.openSlots > 0)) {
    const still = await getJobTeamStatus(supabase, jobId);
    if (still && still.openSlots > 0) {
      const stillEligible = await hasEligibleCleanersRemaining(supabase, still.blockedCleanerIds);
      if (!stillEligible || noCleaners) {
        const { sent } = await notifyStaffNoCleanersAvailable(supabase, jobId, {
          reason: `${reason} — no additional cleaners could be auto-offered`,
        });
        return {
          ok: false,
          openSlots: still.openSlots,
          offersSent: 0,
          noCleanersAvailable: true,
          staffNotified: sent,
        };
      }
    }
  }

  return {
    ok: true,
    openSlots: team.openSlots,
    offersSent,
    noCleanersAvailable: false,
    staffNotified: false,
  };
}

// ─── Dispatch approval gate ─────────────────────────────────────────────
//
// Per operator directive (2026-07-06) auto-dispatch no longer texts
// cleaners on its own. Every job that needs staffing is parked in
// "Pending Approval" and the dispatch Discord channel (internal, admin
// facing) is pinged that a cleaner needs to be assigned for the job.
// Offers only go out when an admin approves from the Dispatch console.

const ADMIN_DISPATCH_URL = "https://admin.novaracleaning.com/admin/dispatch";

const log = (s: string, d?: unknown) =>
  console.log(`[dispatch-approval] ${s}${d ? ` ${JSON.stringify(d)}` : ""}`);

/** Is auto-offer mode explicitly enabled by the operator? Default: OFF. */
export async function autoOffersEnabled(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "dispatch_auto_offers_enabled")
      .maybeSingle();
    return data?.value === true || data?.value === "true";
  } catch (_) {
    return false;
  }
}

/**
 * Park a job for admin approval and notify the dispatch Discord channel
 * that a cleaner needs to be assigned. Idempotent-ish: only one approval
 * event per job per 6 hours so decline/expiry churn doesn't spam the
 * channel.
 */
export async function requestDispatchApproval(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  jobId: string,
  reason: string,
): Promise<{ notified: boolean }> {
  const { data: job } = await supabase
    .from("jobs")
    .select("id, status, service_type, city, state, zip, start_datetime, min_cleaners_required")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return { notified: false };

  // Don't yank back a job that's already staffed or running.
  const s = String(job.status || "").toLowerCase();
  if (["assigned", "in progress", "completed", "cancelled"].includes(s)) {
    return { notified: false };
  }

  await supabase
    .from("jobs")
    .update({
      status: "Pending Approval",
      dispatch_alert_reason: reason,
    })
    .eq("id", jobId);

  await supabase.from("dispatch_alerts").insert({
    job_id: jobId,
    reason: `Awaiting admin dispatch approval: ${reason}`,
    severity: "warning",
  }).then(() => undefined).catch(() => undefined);

  // Dedupe the Discord ping (events → discord trigger).
  const sinceIso = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from("events")
    .select("id")
    .eq("job_id", jobId)
    .eq("event_type", "dispatch.approval_needed")
    .gte("created_at", sinceIso)
    .limit(1)
    .maybeSingle();
  if (recent?.id) {
    log("approval ping suppressed (recent duplicate)", { jobId });
    return { notified: false };
  }

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, booking_number, first_name, last_name, service_date, time_slot, arrival_window, total_estimate_cents")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const ref = booking?.booking_number
    ? `NOV-${String(booking.booking_number).padStart(5, "0")}`
    : `Job ${String(jobId).slice(0, 8)}`;
  const customer = booking
    ? `${booking.first_name || ""} ${booking.last_name || ""}`.trim()
    : "";
  const when = booking?.service_date
    ? `${booking.service_date}${booking.time_slot ? ` · ${booking.time_slot}` : ""}`
    : (job.start_datetime
      ? new Date(job.start_datetime).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : "TBD");
  const where = [job.city, job.state].filter(Boolean).join(", ");
  const amount = booking?.total_estimate_cents
    ? ` · $${(Number(booking.total_estimate_cents) / 100).toFixed(0)}`
    : "";

  const summary =
    `${ref}${customer ? ` — ${customer}` : ""} · ${String(job.service_type || "clean").replace(/_/g, " ")} · ${when}` +
    `${where ? ` · ${where}` : ""}${amount}\n` +
    `Needs ${job.min_cleaners_required || 1} cleaner(s). Reason: ${reason}\n` +
    `Approve & assign in the Dispatch console: ${ADMIN_DISPATCH_URL}`;

  await supabase.from("events").insert({
    event_type: "dispatch.approval_needed",
    job_id: jobId,
    booking_id: booking?.id || null,
    source: "dispatch",
    summary,
    data: { reason, need: job.min_cleaners_required || 1 },
  }).then(() => undefined).catch(() => undefined);

  log("approval requested", { jobId, reason });
  return { notified: true };
}

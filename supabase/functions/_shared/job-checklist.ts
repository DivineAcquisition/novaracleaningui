// ─── Job checklist helpers ──────────────────────────────────────────────
//
// One live checklist row per dispatched job (job_checklists). Contractors
// reach it through their per-assignment response_token (the same stable
// token that powered their offer link) at:
//
//   https://contractor.novaracleaning.com/cleaner/job-checklist/<token>
//
// The token resolves to the assignment (→ cleaner identity for progress
// attribution) and the job's shared checklist row (→ shared progress the
// whole team and the admin Dispatch console see live).

import { countChecklistItems, getContractorChecklist, normalizeServiceType } from "./contractor-checklists.ts";
import {
  FOCUSED_SAME_DAY_DEFAULTS,
  FOCUSED_SAME_DAY_SETTINGS_KEY,
  mergeFocusedSameDaySettings,
} from "./focused-same-day.ts";

export const CONTRACTOR_PORTAL_BASE = "https://contractor.novaracleaning.com";

export function checklistUrlForToken(token: string): string {
  return `${CONTRACTOR_PORTAL_BASE}/cleaner/job-checklist/${token}`;
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Get-or-create the job's shared checklist row. Idempotent — safe to call
 * from every dispatch/assign/accept path.
 */
export async function ensureJobChecklist(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  args: { jobId: string; bookingId?: string | null; serviceType?: string | null },
): Promise<{ id: string; token: string } | null> {
  const { jobId } = args;
  if (!jobId) return null;

  const { data: existing } = await supabase
    .from("job_checklists")
    .select("id, token")
    .eq("job_id", jobId)
    .maybeSingle();
  if (existing?.id) return { id: existing.id, token: existing.token };

  let bookingId = args.bookingId ?? null;
  let serviceType = args.serviceType ?? null;
  let focusedAreas: Array<{ areaId: string; quantity: number }> | null = null;
  {
    const { data: booking } = await supabase
      .from("bookings")
      .select("id, service_type, focused_areas")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    bookingId = bookingId || booking?.id || null;
    serviceType = serviceType || booking?.service_type || null;
    if (Array.isArray(booking?.focused_areas)) focusedAreas = booking.focused_areas;
  }
  if (!serviceType) {
    const { data: job } = await supabase
      .from("jobs")
      .select("service_type")
      .eq("id", jobId)
      .maybeSingle();
    serviceType = job?.service_type || "standard";
  }

  const normalized = normalizeServiceType(serviceType);
  let focusedSettings = FOCUSED_SAME_DAY_DEFAULTS;
  if (normalized === "focused") {
    try {
      const { data: settingsRow } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", FOCUSED_SAME_DAY_SETTINGS_KEY)
        .maybeSingle();
      if (settingsRow?.value) focusedSettings = mergeFocusedSameDaySettings(settingsRow.value);
    } catch (_) { /* defaults */ }
  }
  const totalItems = countChecklistItems(getContractorChecklist(normalized, focusedAreas, focusedSettings));

  const { data: created, error } = await supabase
    .from("job_checklists")
    .insert({
      job_id: jobId,
      booking_id: bookingId,
      service_type: normalized,
      token: randomToken(),
      total_items: totalItems,
      section_meta: {},
    })
    .select("id, token")
    .maybeSingle();

  if (error) {
    // Unique-violation race: another path created it first — read it back.
    const { data: raced } = await supabase
      .from("job_checklists")
      .select("id, token")
      .eq("job_id", jobId)
      .maybeSingle();
    return raced?.id ? { id: raced.id, token: raced.token } : null;
  }
  return created?.id ? { id: created.id, token: created.token } : null;
}

/**
 * Resolve the contractor-facing checklist URL for one cleaner on a job.
 * Ensures (a) the job's shared checklist row exists and (b) the cleaner's
 * assignment row has a response_token to use as the access credential
 * (manually assigned rows historically had none — that gap broke every
 * tokenized contractor link for manual assignments).
 *
 * Returns null when the cleaner has no assignment row on the job.
 */
export async function ensureAssignmentChecklistAccess(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  args: { jobId: string; cleanerId: string; bookingId?: string | null; serviceType?: string | null },
): Promise<{ token: string; url: string } | null> {
  const { jobId, cleanerId } = args;
  if (!jobId || !cleanerId) return null;

  await ensureJobChecklist(supabase, args);

  const { data: assignment } = await supabase
    .from("job_assignments")
    .select("id, response_token")
    .eq("job_id", jobId)
    .eq("cleaner_id", cleanerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!assignment?.id) return null;

  let token = assignment.response_token as string | null;
  if (!token) {
    token = randomToken();
    const { error } = await supabase
      .from("job_assignments")
      .update({ response_token: token })
      .eq("id", assignment.id);
    if (error) return null;
  }
  return { token, url: checklistUrlForToken(token) };
}

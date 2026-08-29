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

import {
  contractorChecklistKeyForBooking,
  countChecklistItems,
  getContractorChecklist,
  jobServiceTypeForBooking,
} from "./contractor-checklists.ts";
import {
  FOCUSED_SAME_DAY_DEFAULTS,
  FOCUSED_SAME_DAY_SETTINGS_KEY,
  mergeFocusedSameDaySettings,
} from "./focused-same-day.ts";

export const CONTRACTOR_PORTAL_BASE = "https://contractor.novaracleaning.com";

/**
 * The checklist exactly as issued to this crew, pinned onto the job row.
 *
 * Checklist content changes over time now — the feedback loop rewords items
 * from real outcomes. Re-resolving today's content for a job performed in
 * March would show a reviewer a list the crew was never given, which is
 * exactly the wrong answer in a dispute. So the sections are snapshotted at
 * issue time and historical review reads the snapshot.
 *
 * The positional progress key ("<section>:<item>") is unchanged — shifting it
 * under an in-flight crew would lose their progress — and item_id_map carries
 * the stable ids alongside it so the same completion is countable as signal.
 */
// deno-lint-ignore no-explicit-any
function pinnedVersion(checklist: { key: string; name: string; sections: any[] }) {
  const sections = checklist.sections.map((s, si) => ({
    title: s.title,
    items: s.items,
    itemIds: Array.isArray(s.itemIds) ? s.itemIds : null,
    photoRequired: Boolean(s.photoRequired),
    zoneName: s.zoneName ?? null,
    keys: s.items.map((_: string, ii: number) => `${si}:${ii}`),
  }));
  const itemIdMap: Record<string, string> = {};
  sections.forEach((section, si) => {
    if (!section.itemIds) return;
    section.itemIds.forEach((id: string, ii: number) => {
      if (id) itemIdMap[`${si}:${ii}`] = id;
    });
  });
  return {
    snapshot: {
      key: checklist.key,
      name: checklist.name,
      pinned_at: new Date().toISOString(),
      sections,
    },
    itemIdMap,
  };
}

export function checklistUrlForToken(token: string): string {
  return `${CONTRACTOR_PORTAL_BASE}/cleaner/job-checklist/${token}`;
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadBookingForChecklist(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  args: { jobId: string; bookingId?: string | null },
) {
  if (args.bookingId) {
    const { data } = await supabase
      .from("bookings")
      .select("id, service_type, is_recurring, membership_plan, booking_channel, focused_areas, scope_level, photo_zones")
      .eq("id", args.bookingId)
      .maybeSingle();
    if (data) return data;
  }
  const { data } = await supabase
    .from("bookings")
    .select("id, service_type, is_recurring, membership_plan, booking_channel, focused_areas, scope_level, photo_zones")
    .eq("job_id", args.jobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

/**
 * Get-or-create the job's shared checklist row. Idempotent — safe to call
 * from every dispatch/assign/accept path.
 *
 * Existing rows are synced from the booking: a membership/recurring visit
 * that was cloned off a Deep first-clean must not keep serving the Deep
 * list. Completed checklists are left as historical (what the crew actually
 * worked).
 */
export async function ensureJobChecklist(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  args: { jobId: string; bookingId?: string | null; serviceType?: string | null },
): Promise<{ id: string; token: string } | null> {
  const { jobId } = args;
  if (!jobId) return null;

  const booking = await loadBookingForChecklist(supabase, args);
  let focusedAreas: Array<{ areaId: string; quantity: number }> | null = null;
  if (Array.isArray(booking?.focused_areas)) focusedAreas = booking.focused_areas;
  // A commercial booking carries its scope level and documentation zones, and
  // both change the item count — so the checklist row's total has to be built
  // from the same spec the crew will actually see.
  const commercialOpts = {
    scopeLevel: booking?.scope_level || null,
    photoZones: Array.isArray(booking?.photo_zones)
      ? booking.photo_zones.map(String).filter(Boolean)
      : null,
  };

  const checklistKey = contractorChecklistKeyForBooking(
    booking,
    args.serviceType || booking?.service_type || null,
  );
  const jobType = jobServiceTypeForBooking(
    booking,
    args.serviceType || booking?.service_type || null,
  );

  try {
    await supabase.from("jobs").update({ service_type: jobType }).eq("id", jobId);
  } catch (_) { /* job row may not exist yet during insert */ }

  const { data: existing } = await supabase
    .from("job_checklists")
    .select("id, token, service_type, completed_at, started_at, completed_items")
    .eq("job_id", jobId)
    .maybeSingle();

  if (existing?.id) {
    const stale = String(existing.service_type || "") !== checklistKey;
    if (stale && !existing.completed_at) {
      let focusedSettings = FOCUSED_SAME_DAY_DEFAULTS;
      if (checklistKey === "focused") {
        try {
          const { data: settingsRow } = await supabase
            .from("app_settings")
            .select("value")
            .eq("key", FOCUSED_SAME_DAY_SETTINGS_KEY)
            .maybeSingle();
          if (settingsRow?.value) focusedSettings = mergeFocusedSameDaySettings(settingsRow.value);
        } catch (_) { /* defaults */ }
      }
      const resolved = getContractorChecklist(checklistKey, focusedAreas, focusedSettings, commercialOpts);
      const totalItems = countChecklistItems(resolved);
      const pinned = pinnedVersion(resolved);
      await supabase.from("job_checklists").update({
        service_type: checklistKey,
        booking_id: booking?.id || args.bookingId || null,
        total_items: totalItems,
        items: {},
        completed_items: 0,
        progress_pct: 0,
        started_at: null,
        section_meta: {},
        // Re-issued because the booking changed type — the crew gets a new
        // list, so the pin moves with it.
        checklist_key: checklistKey,
        sections_snapshot: pinned.snapshot,
        item_id_map: pinned.itemIdMap,
      }).eq("id", existing.id);
    }
    return { id: existing.id, token: existing.token };
  }

  let focusedSettings = FOCUSED_SAME_DAY_DEFAULTS;
  if (checklistKey === "focused") {
    try {
      const { data: settingsRow } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", FOCUSED_SAME_DAY_SETTINGS_KEY)
        .maybeSingle();
      if (settingsRow?.value) focusedSettings = mergeFocusedSameDaySettings(settingsRow.value);
    } catch (_) { /* defaults */ }
  }
  const resolved = getContractorChecklist(checklistKey, focusedAreas, focusedSettings, commercialOpts);
  const totalItems = countChecklistItems(resolved);
  const pinned = pinnedVersion(resolved);

  const { data: created, error } = await supabase
    .from("job_checklists")
    .insert({
      job_id: jobId,
      booking_id: booking?.id || args.bookingId || null,
      service_type: checklistKey,
      token: randomToken(),
      total_items: totalItems,
      section_meta: {},
      checklist_key: checklistKey,
      sections_snapshot: pinned.snapshot,
      item_id_map: pinned.itemIdMap,
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

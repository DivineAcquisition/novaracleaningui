// cleaner-job-checklist
//
// Token-protected API behind the contractor-dedicated per-job checklist
// page: contractor.novaracleaning.com/cleaner/job-checklist/<token>
//
// Access tokens (no other auth gate, same model as job-offer/job-photos):
//   • a cleaner's job_assignments.response_token (accepted/confirmed
//     assignment) → full read/write with cleaner attribution
//   • the job_checklists.token itself → read-only preview (used by the
//     admin Dispatch console "view checklist" link)
//
// Actions (POST body):
//   { token }                                    → full checklist state
//   { token, action:'toggle', itemKey, done }    → check/uncheck an item
//   { token, action:'skip', itemKey, reason }    → skip item with required reason
//   { token, action:'complete' }                 → mark checklist finished
//   { token, action:'confirm_zones', zones:[{name,status,note?}] }
//                                                → Crew Lead close: every named
//                                                  zone complete|partial|not_done
//   { token, action:'save_section_photos', sectionIndex, before?, after? }
//   { token, action:'conditions_found', sectionIndex, note, photos? }
//   { token, action:'request_scope_addition', note }
//   { token, action:'request_addon', addonId, note? }
//   { token, action:'report_site_finding', findingType, location, confined,
//     infestationOrBedBugs?, overThreshold?, areaId?, beforePhotoUrl }
//   { token, action:'complete_site_finding', findingId, afterPhotoUrl }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  CONTRACTOR_ADDON_CATALOG,
  contractorChecklistKeyForBooking,
  countChecklistItems,
  checklistFromSnapshot,
  getContractorChecklist,
  includedAddonIdsForChecklistKey,
  photoRequiredSectionIndexes,
} from "../_shared/contractor-checklists.ts";
import { ensureJobChecklist } from "../_shared/job-checklist.ts";
import { documentBookingAddonsInQcSafe } from "../_shared/addon-qc.ts";
import {
  FOCUSED_SAME_DAY_DEFAULTS,
  FOCUSED_SAME_DAY_SETTINGS_KEY,
  formatFocusedAreasLabel,
  focusedScopeBoundaryText,
  mergeFocusedSameDaySettings,
  type FocusedAreaSelection,
  type FocusedSameDaySettings,
} from "../_shared/focused-same-day.ts";
import {
  completeSiteFinding,
  createSiteFindingQc,
  evaluateSiteFindingScope,
  httpUrls,
  isSiteFindingType,
  listSiteFindings,
  lookupRecurrence,
  pendingAfterFinding,
  previewSiteFindingPrice,
  stopFieldReportText,
} from "../_shared/site-finding.ts";
import {
  customerZoneIncompleteMessage,
  incompleteZoneCompletions,
  isZoneStatus,
  parseZoneCompletions,
  siteZoneNames,
  zoneCompletionGate,
  zoneFollowUpNote,
  type ZoneCompletion,
} from "../_shared/site-zones.ts";
import { sendSms } from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

const WRITE_STATUSES = ["confirmed", "accepted", "assigned", "in progress", "completed"];

// deno-lint-ignore no-explicit-any
type SB = any;
type ItemEntry = {
  done?: boolean;
  skipped?: boolean;
  skipReason?: string;
  at?: string;
  by?: string;
};
type SectionMeta = {
  before?: string[];
  after?: string[];
  conditions_note?: string | null;
  conditions_photos?: string[];
  conditions_at?: string | null;
};

// deno-lint-ignore no-explicit-any
async function contractorAddonsEnabled(supabase: any): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "contractor_addons_enabled")
      .maybeSingle();
    if (data == null) return true;
    return data.value === true || data.value === "true";
  } catch (_) {
    return true;
  }
}

async function loadFocusedSettings(supabase: SB): Promise<FocusedSameDaySettings> {
  try {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", FOCUSED_SAME_DAY_SETTINGS_KEY)
      .maybeSingle();
    if (data?.value) return mergeFocusedSameDaySettings(data.value);
  } catch (_) { /* defaults */ }
  return FOCUSED_SAME_DAY_DEFAULTS;
}

function isItemKey(key: string): boolean {
  return /^\d+:\d+$/.test(key);
}

function isResolved(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as ItemEntry;
  if (e.skipped && String(e.skipReason || "").trim()) return true;
  if (e.done && !e.skipped) return true;
  return false;
}

function countResolved(items: Record<string, unknown>, totalItems: number, sections: { items: string[] }[]): {
  completed: number;
  unresolvedKeys: string[];
  skips: Array<{ key: string; reason: string; by?: string }>;
} {
  const unresolvedKeys: string[] = [];
  const skips: Array<{ key: string; reason: string; by?: string }> = [];
  let completed = 0;
  for (let s = 0; s < sections.length; s++) {
    for (let i = 0; i < sections[s].items.length; i++) {
      const key = `${s}:${i}`;
      const entry = items[key];
      if (isResolved(entry)) {
        completed++;
        const e = entry as ItemEntry;
        if (e.skipped && e.skipReason) {
          skips.push({ key, reason: String(e.skipReason), by: e.by });
        }
      } else {
        unresolvedKeys.push(key);
      }
    }
  }
  // Ignore stale keys outside the current spec when counting.
  void totalItems;
  return { completed, unresolvedKeys, skips };
}

/**
 * Which photo-required sections still lack a before/after pair.
 *
 * Focused cleans mark every area; a large commercial site marks every
 * documentation zone. Sections that aren't marked (arrival, close-out) are not
 * photo evidence and are not checked here.
 */
function sectionPhotosOk(meta: Record<string, SectionMeta>, requiredIndexes: number[]): {
  ok: boolean;
  missing: number[];
} {
  const missing: number[] = [];
  for (const i of requiredIndexes) {
    const m = meta[String(i)] || {};
    const before = Array.isArray(m.before) ? m.before : [];
    const after = Array.isArray(m.after) ? m.after : [];
    if (before.length === 0 || after.length === 0) missing.push(i);
  }
  return { ok: missing.length === 0, missing };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token || "").trim();
    const action = String(body?.action || "get").toLowerCase();
    if (!token) return json({ ok: false, error: "Missing token" }, 400);

    let jobId: string | null = null;
    let cleaner: { id: string; first_name: string | null; last_name: string | null; pay_percentage: number | null } | null = null;
    let assignmentPct: number | null = null;
    let canWrite = false;
    let assignmentRole = "";

    const { data: assignment } = await supabase
      .from("job_assignments")
      .select("id, job_id, cleaner_id, status, role, pay_percentage_snapshot, cleaners(id, first_name, last_name, pay_percentage)")
      .eq("response_token", token)
      .maybeSingle();

    if (assignment?.job_id) {
      const s = String(assignment.status || "").toLowerCase();
      if (!WRITE_STATUSES.includes(s)) {
        return json({ ok: false, reason: "not_assigned", error: "This job isn't assigned to you (yet). Accept the offer first." }, 403);
      }
      jobId = assignment.job_id;
      const c = Array.isArray(assignment.cleaners) ? assignment.cleaners[0] : assignment.cleaners;
      if (c?.id) cleaner = c;
      assignmentPct = assignment.pay_percentage_snapshot != null ? Number(assignment.pay_percentage_snapshot) : null;
      assignmentRole = String(assignment.role || "");
      canWrite = true;
    } else {
      const { data: byChecklistToken } = await supabase
        .from("job_checklists")
        .select("job_id")
        .eq("token", token)
        .maybeSingle();
      if (byChecklistToken?.job_id) {
        jobId = byChecklistToken.job_id;
        canWrite = false;
      }
    }

    if (!jobId) return json({ ok: false, reason: "not_found", error: "Checklist link not found or expired." }, 404);

    const { data: job } = await supabase
      .from("jobs")
      .select("id, service_type, address, city, state, zip, start_datetime, duration_est_hours, status, min_cleaners_required")
      .eq("id", jobId)
      .maybeSingle();
    if (!job) return json({ ok: false, reason: "not_found", error: "Job not found." }, 404);

    const { data: booking } = await supabase
      .from("bookings")
      .select("id, booking_number, first_name, phone, email, service_date, time_slot, arrival_window, add_ons, access_notes, team_notes, dispatch_notes, service_type, status, focused_areas, is_recurring, membership_plan, booking_channel, scope_level, photo_zones, facility_type, square_footage, hard_deadline, business_site_id")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const ensured = await ensureJobChecklist(supabase, {
      jobId,
      bookingId: booking?.id || null,
      serviceType: booking?.service_type || job.service_type || null,
    });
    if (!ensured) return json({ ok: false, error: "Could not load checklist." }, 500);

    const { data: checklistRow } = await supabase
      .from("job_checklists")
      .select("*")
      .eq("id", ensured.id)
      .maybeSingle();
    if (!checklistRow) return json({ ok: false, error: "Could not load checklist." }, 500);

    const focusedAreas: FocusedAreaSelection[] = Array.isArray(booking?.focused_areas)
      ? booking.focused_areas
      : [];
    const serviceTypeRaw = String(booking?.service_type || job.service_type || "standard");
    const isFocused = String(serviceTypeRaw).toLowerCase().replace(/[\s-]/g, "_") === "focused"
      || String(serviceTypeRaw).toLowerCase() === "single_area"
      || String(checklistRow.service_type).toLowerCase() === "focused";

    const focusedSettings = await loadFocusedSettings(supabase);
    // Completed / in-progress checklists keep the list the crew actually
    // worked (the pinned snapshot). Unstarted jobs follow the live booking
    // template (membership visits → maintenance, not Deep).
    const checklistKey = checklistRow.completed_at
      ? String(checklistRow.service_type || serviceTypeRaw)
      : contractorChecklistKeyForBooking(booking, serviceTypeRaw);
    const photoZones: string[] = siteZoneNames(booking?.photo_zones);
    const liveSpec = getContractorChecklist(checklistKey, focusedAreas, focusedSettings, {
      scopeLevel: booking?.scope_level || null,
      photoZones,
      bookedAddOns: Array.isArray(booking?.add_ons) ? booking.add_ons.map(String) : [],
    });
    const pinned = checklistFromSnapshot(checklistRow.sections_snapshot);
    const inFlight = Boolean(
      checklistRow.completed_at
      || checklistRow.started_at
      || Number(checklistRow.completed_items) > 0,
    );
    const spec = inFlight && pinned ? pinned : liveSpec;
    // Sections that are photo evidence: every focused area, every commercial
    // documentation zone. These are what the completion gate checks.
    const photoSections = photoRequiredSectionIndexes(spec);
    const hasPhotoSections = photoSections.length > 0;
    const totalItems = countChecklistItems(spec);
    const nowIso = new Date().toISOString();
    const cleanerName = cleaner
      ? `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim() || "Cleaner"
      : "Team";
    const bookingRef = booking?.booking_number
      ? `NVC-${String(booking.booking_number).padStart(4, "0")}`
      : `Job ${String(jobId).slice(0, 8)}`;

    let sectionMeta: Record<string, SectionMeta> = {
      ...((checklistRow.section_meta && typeof checklistRow.section_meta === "object")
        ? checklistRow.section_meta
        : {}),
    };

    const persistProgress = async (items: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
      const { completed, unresolvedKeys, skips } = countResolved(items, totalItems, spec.sections);
      const progressPct = totalItems > 0 ? Math.round((completed / totalItems) * 100) : 0;
      const patch: Record<string, unknown> = {
        items,
        total_items: totalItems,
        completed_items: completed,
        progress_pct: progressPct,
        started_at: checklistRow.started_at || nowIso,
        last_activity_at: nowIso,
        last_activity_by: cleanerName,
        updated_at: nowIso,
        section_meta: sectionMeta,
        ...extra,
      };
      if (extra.completed_at === undefined) {
        if (checklistRow.completed_at && unresolvedKeys.length > 0) patch.completed_at = null;
      }
      const { error: updErr } = await supabase
        .from("job_checklists")
        .update(patch)
        .eq("id", checklistRow.id);
      if (updErr) throw new Error(updErr.message);
      Object.assign(checklistRow, patch);
      return { completed, unresolvedKeys, skips, progressPct };
    };

    // ─── Mutations ───────────────────────────────────────────────────────
    if (action === "toggle" || action === "skip" || action === "complete"
      || action === "save_section_photos" || action === "conditions_found"
      || action === "request_scope_addition"
      || action === "report_site_finding" || action === "complete_site_finding"
      || action === "confirm_zones") {
      if (!canWrite) return json({ ok: false, error: "This link is view-only." }, 403);
    }

    if (action === "toggle" || action === "skip") {
      const items: Record<string, unknown> = { ...(checklistRow.items || {}) };
      const itemKey = String(body?.itemKey || "");
      const [secIdx, itemIdx] = itemKey.split(":").map((n) => Number(n));
      const validKey = isItemKey(itemKey) && Number.isInteger(secIdx) && Number.isInteger(itemIdx)
        && spec.sections[secIdx]?.items[itemIdx] != null;
      if (!validKey) return json({ ok: false, error: "Unknown checklist item." }, 400);

      if (action === "toggle") {
        const done = body?.done === true;
        if (done) {
          items[itemKey] = { done: true, at: nowIso, by: cleanerName };
        } else {
          delete items[itemKey];
        }
      } else {
        const reason = String(body?.reason || "").trim().slice(0, 300);
        if (reason.length < 3) {
          return json({ ok: false, error: "Skip requires a short reason (e.g. \"customer asked us not to touch\")." }, 400);
        }
        items[itemKey] = {
          done: true,
          skipped: true,
          skipReason: reason,
          at: nowIso,
          by: cleanerName,
        };
      }
      await persistProgress(items);
    }

    if (action === "save_section_photos") {
      if (!hasPhotoSections) {
        return json({ ok: false, error: "This job documents with one site-wide before/after pair, not per-section photos." }, 400);
      }
      const sectionIndex = Number(body?.sectionIndex);
      if (!Number.isInteger(sectionIndex) || !spec.sections[sectionIndex]) {
        return json({ ok: false, error: "Unknown area section." }, 400);
      }
      if (!photoSections.includes(sectionIndex)) {
        return json({ ok: false, error: "That section isn't one of this job's documented areas." }, 400);
      }
      const before = Array.isArray(body?.before) ? body.before.map(String).filter(Boolean).slice(0, 12) : null;
      const after = Array.isArray(body?.after) ? body.after.map(String).filter(Boolean).slice(0, 12) : null;
      const prev = sectionMeta[String(sectionIndex)] || {};
      sectionMeta[String(sectionIndex)] = {
        ...prev,
        before: before ?? (prev.before || []),
        after: after ?? (prev.after || []),
      };
      await persistProgress({ ...(checklistRow.items || {}) });
    }

    if (action === "conditions_found") {
      if (!isFocused) return json({ ok: false, error: "Conditions-found notes are per focused area." }, 400);
      const sectionIndex = Number(body?.sectionIndex);
      if (!Number.isInteger(sectionIndex) || !spec.sections[sectionIndex]) {
        return json({ ok: false, error: "Unknown area section." }, 400);
      }
      const note = String(body?.note || "").trim().slice(0, 2000);
      if (note.length < 3) return json({ ok: false, error: "Describe the condition found." }, 400);
      const photos = Array.isArray(body?.photos) ? body.photos.map(String).filter(Boolean).slice(0, 12) : [];
      const sectionTitle = spec.sections[sectionIndex].title;
      const prev = sectionMeta[String(sectionIndex)] || {};
      sectionMeta[String(sectionIndex)] = {
        ...prev,
        conditions_note: note,
        conditions_photos: photos,
        conditions_at: nowIso,
      };
      await persistProgress({ ...(checklistRow.items || {}) });

      // Feed existing QC system (stop-and-report for biohazard/mold defaults high).
      const severityHint = /biohazard|mold|blood|feces|urine|sewage/i.test(note) ? "critical" : "high";
      try {
        await supabase.functions.invoke("qc-issues", {
          body: {
            action: "field_report",
            token,
            issueType: "quality_flag",
            severity: severityHint,
            description: `[Focused · ${sectionTitle}] Conditions found: ${note}${
              photos.length ? ` (${photos.length} photo${photos.length === 1 ? "" : "s"})` : ""
            }`,
          },
        });
      } catch (_) { /* non-blocking — note still saved on checklist */ }

      await supabase.from("events").insert({
        event_type: "job.focused.conditions_found",
        job_id: jobId,
        booking_id: booking?.id || null,
        cleaner_id: cleaner?.id || null,
        source: "cleaner-job-checklist",
        summary: `${bookingRef} — conditions found in ${sectionTitle} by ${cleanerName}`,
        data: { section_index: sectionIndex, section_title: sectionTitle, note, photos },
      }).then(() => undefined).catch(() => undefined);
    }

    if (action === "request_scope_addition") {
      if (!isFocused) return json({ ok: false, error: "Scope-addition requests are for focused cleans." }, 400);
      const note = String(body?.note || "").trim().slice(0, 1000);
      if (note.length < 3) {
        return json({ ok: false, error: "Tell the office what extra area/work the customer asked for." }, 400);
      }
      const areasLabel = formatFocusedAreasLabel(focusedAreas, focusedSettings);
      await supabase.from("events").insert({
        event_type: "job.scope_addition_requested",
        job_id: jobId,
        booking_id: booking?.id || null,
        cleaner_id: cleaner?.id || null,
        source: "cleaner-job-checklist",
        summary:
          `${bookingRef} — ${cleanerName} requests a scope addition on a focused clean ` +
          `(booked: ${areasLabel || "selected areas"}). Customer asked: "${note}". ` +
          `Open Admin → booking → Scope adjustment to add & price — do not absorb free.`,
        data: {
          focused_areas: focusedAreas,
          note,
          booking_id: booking?.id,
          open_scope_adjustment: true,
        },
      });
      try {
        await supabase.functions.invoke("qc-issues", {
          body: {
            action: "field_report",
            token,
            issueType: "other",
            severity: "high",
            description:
              `[Focused scope addition] Booked scope: ${areasLabel || "selected areas"}. ` +
              `Customer asked for extra work: ${note}. Price via scope adjustment — do not absorb free.`,
          },
        });
      } catch (_) { /* event already recorded */ }
    }

    if (action === "report_site_finding") {
      if (!booking?.id) return json({ ok: false, error: "No booking on this job." }, 400);
      if (!isSiteFindingType(body?.findingType)) {
        return json({ ok: false, error: "Pick Pest — Light or Mold — Minor." }, 400);
      }
      const location = String(body?.location || "").trim().slice(0, 120);
      if (location.length < 2) {
        return json({ ok: false, error: "Say where on the property this is (room / area)." }, 400);
      }
      const beforeUrls = httpUrls(
        body?.beforePhotoUrl ? [body.beforePhotoUrl] : (Array.isArray(body?.beforePhotoUrls) ? body.beforePhotoUrls : []),
        4,
      );
      if (beforeUrls.length === 0) {
        return json({ ok: false, error: "A before photo of the area is required before proceeding." }, 400);
      }
      if (body.findingType === "pest_light" && typeof body?.infestationOrBedBugs !== "boolean") {
        return json({ ok: false, error: "Confirm whether this looks like an active infestation or bed bugs." }, 400);
      }
      if (body.findingType === "mold_minor" && typeof body?.overThreshold !== "boolean") {
        return json({ ok: false, error: "Confirm whether the mold is over ~10 sq ft, porous, or has a hidden-source odor." }, 400);
      }
      const scope = evaluateSiteFindingScope({
        findingType: body.findingType,
        infestationOrBedBugs: body?.infestationOrBedBugs === true,
        overThreshold: body?.overThreshold === true,
        confined: body?.confined === true,
      });
      if (scope.inScope && typeof body?.confined !== "boolean") {
        return json({ ok: false, error: "Confirm whether this is confined to one small area." }, 400);
      }

      if (!scope.inScope) {
        try {
          await supabase.functions.invoke("qc-issues", {
            body: {
              action: "field_report",
              token,
              issueType: "quality_flag",
              severity: "critical",
              description: stopFieldReportText({
                findingType: body.findingType,
                location,
                stopReason: scope.stopReason,
                beforePhotoUrl: beforeUrls[0],
              }),
            },
          });
        } catch (_) { /* still return the stop so the cleaner doesn't proceed */ }
        await supabase.from("events").insert({
          event_type: "job.site_finding.stop_and_report",
          job_id: jobId,
          booking_id: booking.id,
          cleaner_id: cleaner?.id || null,
          source: "cleaner-job-checklist",
          summary: `${bookingRef} — ${cleanerName} flagged ${body.findingType} in ${location} past the minor threshold. Routed to stop-and-report.`,
          data: { finding_type: body.findingType, location, stop_reason: scope.stopReason },
        }).then(() => undefined, () => undefined);
        return json({
          ok: true,
          routed: "stop_and_report",
          stopReason: scope.stopReason,
          message: scope.stopDescription,
        });
      }

      const { data: fullBooking } = await supabase
        .from("bookings")
        .select("id, job_id, booking_number, first_name, last_name, email, phone, address, city, state, zip_code, customer_id, service_type, service_date, home_size_id, focused_areas, condition_level, add_ons, membership_plan, total_estimate_cents, final_charge_cents, team_notes, before_photos, after_photos, booking_type, partner_details")
        .eq("id", booking.id)
        .maybeSingle();
      if (!fullBooking) return json({ ok: false, error: "Booking not found." }, 404);
      if (!fullBooking.zip_code && job.zip) fullBooking.zip_code = job.zip;

      const areaId = body?.areaId ? String(body.areaId) : null;
      const preview = await previewSiteFindingPrice(supabase, fullBooking, {
        confined: scope.confined,
        areaId,
      });
      const recurrence = await lookupRecurrence(supabase, fullBooking, body.findingType, location);
      const finding = await createSiteFindingQc(supabase, {
        booking: fullBooking,
        cleanerId: cleaner?.id || null,
        cleanerName,
        findingType: body.findingType,
        location,
        areaId,
        confined: scope.confined,
        sizeConfirmation: {
          in_scope: true,
          confined: scope.confined,
          infestation_or_bed_bugs: body?.infestationOrBedBugs === true,
          over_threshold: body?.overThreshold === true,
        },
        beforePhotoUrl: beforeUrls[0],
        preview,
        recurrence,
      });
      await supabase.from("events").insert({
        event_type: "job.site_finding.reported",
        job_id: jobId,
        booking_id: booking.id,
        cleaner_id: cleaner?.id || null,
        source: "cleaner-job-checklist",
        summary:
          `${bookingRef} — ${cleanerName} confirmed ${finding.details.finding_type} in ${location} ` +
          `(${preview.ruleLabel}). After photo required before pricing.`,
        data: { issue_id: finding.id, preview },
      }).then(() => undefined, () => undefined);
    }

    if (action === "complete_site_finding") {
      if (!booking?.id) return json({ ok: false, error: "No booking on this job." }, 400);
      const findingId = String(body?.findingId || "");
      const afterUrls = httpUrls(
        body?.afterPhotoUrl ? [body.afterPhotoUrl] : (Array.isArray(body?.afterPhotoUrls) ? body.afterPhotoUrls : []),
        4,
      );
      if (!findingId) return json({ ok: false, error: "findingId required." }, 400);
      if (afterUrls.length === 0) {
        return json({ ok: false, error: "An after photo is required before this finding can be priced." }, 400);
      }
      const { data: fullBooking } = await supabase
        .from("bookings")
        .select("id, job_id, booking_number, first_name, last_name, email, phone, address, city, state, zip_code, customer_id, service_type, service_date, home_size_id, focused_areas, condition_level, add_ons, membership_plan, total_estimate_cents, final_charge_cents, team_notes, before_photos, after_photos, booking_type, partner_details")
        .eq("id", booking.id)
        .maybeSingle();
      if (!fullBooking) return json({ ok: false, error: "Booking not found." }, 404);
      if (!fullBooking.zip_code && job.zip) fullBooking.zip_code = job.zip;
      await completeSiteFinding(supabase, {
        booking: fullBooking,
        issueId: findingId,
        afterPhotoUrl: afterUrls[0],
        cleanerId: cleaner?.id || null,
        cleanerName,
      });
    }

    if (action === "confirm_zones") {
      if (photoZones.length === 0) {
        return json({ ok: false, error: "This job isn't documented by zone." }, 400);
      }
      const { count: crewCount } = await supabase
        .from("job_assignments")
        .select("id", { count: "exact", head: true })
        .eq("job_id", jobId)
        .or("status.ilike.confirmed,status.ilike.accepted,status.ilike.assigned,status.ilike.in progress");
      const crewSize = Math.max(1, crewCount ?? 1);
      const isLead = crewSize === 1 || /lead/i.test(assignmentRole);
      if (!isLead) {
        return json({
          ok: false,
          error: "The Crew Lead confirms each zone before the crew leaves. Ask the lead to close this job.",
        }, 403);
      }
      const incoming = Array.isArray(body?.zones) ? body.zones : [];
      const completions: ZoneCompletion[] = [];
      for (const name of photoZones) {
        const row = incoming.find((z: { name?: unknown }) =>
          String(z?.name || "").trim().toLowerCase() === name.toLowerCase()
        ) as { status?: unknown; note?: unknown; zoneId?: unknown } | undefined;
        if (!row || !isZoneStatus(row.status)) {
          return json({
            ok: false,
            error: `Mark ${name} complete, partial, or not done — none can be left blank.`,
          }, 400);
        }
        if ((row.status === "partial" || row.status === "not_done") && !String(row.note || "").trim()) {
          return json({
            ok: false,
            error: `Say what was left in ${name} so the next visit (and the client) know.`,
          }, 400);
        }
        completions.push({
          zoneId: String(row.zoneId || name),
          name,
          status: row.status,
          note: String(row.note || "").trim().slice(0, 500),
          by: cleanerName,
          at: nowIso,
        });
      }
      for (const zone of completions) {
        if (zone.status !== "complete") continue;
        const idx = spec.sections.findIndex(
          (s) => String(s.zoneName || "").trim().toLowerCase() === zone.name.toLowerCase(),
        );
        if (idx < 0 || !spec.sections[idx]?.photoRequired) continue;
        const photos = sectionPhotosOk(sectionMeta, [idx]);
        if (!photos.ok) {
          return json({
            ok: false,
            error: `${zone.name} needs before and after photos before it can be marked complete.`,
            missingSections: photos.missing,
          }, 400);
        }
      }
      const gate = zoneCompletionGate(photoZones, completions);
      if (!gate.ok) {
        return json({
          ok: false,
          error: `Every zone needs a status. Still unmarked: ${[...gate.missing, ...gate.unmarked].join(", ")}.`,
          missing: gate.missing,
        }, 400);
      }
      await persistProgress({ ...(checklistRow.items || {}) }, { zone_completion: completions });

      const incomplete = incompleteZoneCompletions(completions);
      if (incomplete.length && booking?.id) {
        const nextNote = incomplete.map(zoneFollowUpNote).join("\n");
        const existingDispatch = String(booking.dispatch_notes || "").trim();
        await supabase.from("bookings").update({
          dispatch_notes: [existingDispatch, `ZONE FOLLOW-UP:\n${nextNote}`].filter(Boolean).join("\n\n").slice(0, 4000),
        }).eq("id", booking.id);

        const customerMessage = customerZoneIncompleteMessage(booking.first_name, completions);
        for (const zone of incomplete) {
          await supabase.from("job_zone_followups").insert({
            booking_id: booking.id,
            job_id: jobId,
            business_site_id: booking.business_site_id || null,
            zone_id: zone.zoneId,
            zone_name: zone.name,
            status: zone.status,
            note: zone.note,
            customer_message: customerMessage,
          });
        }
        if (booking.phone && customerMessage) {
          await sendSms({
            toPhone: booking.phone,
            message: customerMessage,
            type: "confirmation",
          }).catch(() => undefined);
          await supabase.from("job_zone_followups")
            .update({ customer_notified_at: nowIso })
            .eq("booking_id", booking.id)
            .is("customer_notified_at", null);
        }
        if (booking.email && customerMessage) {
          await supabase.functions.invoke("admin-send-email", {
            body: {
              to: booking.email,
              subject: "Today's visit — a section still needs finishing",
              html: `<p>${customerMessage.replace(/\n/g, "<br/>")}</p>`,
            },
          }).then(() => undefined, () => undefined);
        }
        await supabase.from("events").insert({
          event_type: "job.zone.incomplete",
          job_id: jobId,
          booking_id: booking.id,
          cleaner_id: cleaner?.id || null,
          source: "cleaner-job-checklist",
          summary:
            `${bookingRef} — ${cleanerName} closed with ${incomplete.length} zone${incomplete.length === 1 ? "" : "s"} unfinished: ` +
            `${incomplete.map((z) => `${z.name} (${z.status})`).join(", ")}. Client told; next visit must finish those sections.`,
          data: { zones: incomplete, customer_notified: Boolean(booking.phone || booking.email) },
        }).then(() => undefined, () => undefined);
      } else {
        await supabase.from("events").insert({
          event_type: "job.zone.confirmed",
          job_id: jobId,
          booking_id: booking?.id || null,
          cleaner_id: cleaner?.id || null,
          source: "cleaner-job-checklist",
          summary: `${bookingRef} — ${cleanerName} confirmed every zone complete.`,
          data: { zones: completions },
        }).then(() => undefined, () => undefined);
      }
    }

    if (action === "complete") {
      const items: Record<string, unknown> = { ...(checklistRow.items || {}) };
      const { completed, unresolvedKeys, skips } = countResolved(items, totalItems, spec.sections);
      if (unresolvedKeys.length > 0) {
        return json({
          ok: false,
          error: `Finish every task first — ${unresolvedKeys.length} still open. Check each item or skip with a reason.`,
          unresolvedKeys,
        }, 400);
      }
      if (photoZones.length) {
        const completions = parseZoneCompletions(checklistRow.zone_completion);
        const gate = zoneCompletionGate(photoZones, completions);
        if (!gate.ok) {
          const unmarked = [...gate.missing, ...gate.unmarked];
          return json({
            ok: false,
            error: `Every zone must be marked complete, partial, or not-done before this job can close. Still unmarked: ${unmarked.join(", ")}.`,
            unmarked_zones: unmarked,
          }, 400);
        }
      }
      if (hasPhotoSections) {
        let required = photoSections;
        if (photoZones.length) {
          const completions = parseZoneCompletions(checklistRow.zone_completion);
          required = photoSections.filter((i) => {
            const zone = spec.sections[i]?.zoneName;
            if (!zone) return true;
            const row = completions.find((c) => c.name.toLowerCase() === zone.toLowerCase());
            return !row || row.status === "complete";
          });
        }
        const photoGate = sectionPhotosOk(sectionMeta, required);
        if (!photoGate.ok) {
          const names = photoGate.missing.map((i) => spec.sections[i]?.title || `Area ${i + 1}`).join(", ");
          return json({
            ok: false,
            error: `Before and after photos are required for every completed area. Missing: ${names}.`,
            missingSections: photoGate.missing,
          }, 400);
        }
      }
      if (booking?.id) {
        const openFinding = pendingAfterFinding(await listSiteFindings(supabase, booking.id));
        if (openFinding) {
          return json({
            ok: false,
            error: `An after photo is required for the ${openFinding.details.finding_type === "pest_light" ? "light pest" : "minor mold"} finding in ${openFinding.details.location} before this job can be priced and finished.`,
            pendingFindingId: openFinding.id,
          }, 400);
        }
      }
      await persistProgress(items, { completed_at: nowIso });
      if (booking?.id) {
        await documentBookingAddonsInQcSafe(supabase, { booking, source: "booked" });
      }
      await supabase.from("events").insert({
        event_type: "job.checklist.completed",
        job_id: jobId,
        booking_id: booking?.id || null,
        cleaner_id: cleaner?.id || null,
        source: "cleaner-job-checklist",
        summary: `${bookingRef} — job checklist completed by ${cleanerName} (${completed}/${totalItems} items` +
          `${skips.length ? `, ${skips.length} skipped` : ""}).`,
        data: {
          checklist_id: checklistRow.id,
          completed_items: completed,
          total_items: totalItems,
          skips,
          section_meta: hasPhotoSections ? sectionMeta : undefined,
        },
      }).then(() => undefined).catch(() => undefined);
    }

    const addonsEnabled = await contractorAddonsEnabled(supabase);
    const includedAddOns: string[] = Array.isArray(booking?.add_ons) ? booking.add_ons.map(String) : [];
    const freeAddonIds = includedAddonIdsForChecklistKey(checklistKey);
    const freeForService = (id: string) => freeAddonIds.has(id);

    const { count: confirmedCount } = await supabase
      .from("job_assignments")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId)
      .or("status.ilike.confirmed,status.ilike.accepted");
    const teamSize = Math.max(1, confirmedCount ?? 1);
    const sharePct = assignmentPct ??
      (cleaner?.pay_percentage != null && Number.isFinite(Number(cleaner.pay_percentage))
        ? Number(cleaner.pay_percentage)
        : 35);

    if (action === "request_addon") {
      if (!canWrite) return json({ ok: false, error: "This link is view-only." }, 403);
      if (!cleaner) return json({ ok: false, error: "Add-on requests need a cleaner link." }, 403);
      if (!addonsEnabled) {
        return json({ ok: false, reason: "addons_disabled", error: "Add-on reporting is currently turned off. Contact dispatch instead." }, 403);
      }
      const addonId = String(body?.addonId || "");
      const catalogEntry = CONTRACTOR_ADDON_CATALOG[addonId];
      if (!catalogEntry) return json({ ok: false, error: "Unknown add-on." }, 400);
      if (includedAddOns.includes(addonId)) {
        return json({ ok: false, error: "That add-on is already included in this booking." }, 400);
      }
      if (freeForService(addonId)) {
        return json({ ok: false, error: "That add-on is already included free with this service type." }, 400);
      }
      const { data: existingReq } = await supabase
        .from("job_addon_requests")
        .select("id, status")
        .eq("job_id", jobId)
        .eq("addon_id", addonId)
        .in("status", ["pending", "approved"])
        .limit(1)
        .maybeSingle();
      if (existingReq?.id) {
        return json({ ok: false, error: `That add-on was already ${existingReq.status === "approved" ? "approved" : "submitted and is awaiting admin approval"}.` }, 409);
      }

      const amountCents = Math.round(catalogEntry.price * 100);
      const cleanerShareCents = Math.floor((amountCents * sharePct) / 100 / teamSize);
      const note = String(body?.note || "").slice(0, 500) || null;

      const { data: request, error: reqErr } = await supabase
        .from("job_addon_requests")
        .insert({
          job_id: jobId,
          booking_id: booking?.id || null,
          checklist_id: checklistRow.id,
          cleaner_id: cleaner.id,
          cleaner_name: cleanerName,
          addon_id: addonId,
          addon_label: catalogEntry.label,
          amount_cents: amountCents,
          cleaner_share_cents: cleanerShareCents,
          note,
          status: "pending",
        })
        .select("*")
        .single();
      if (reqErr) return json({ ok: false, error: reqErr.message }, 500);

      await supabase.from("events").insert({
        event_type: "job.addon.requested",
        job_id: jobId,
        booking_id: booking?.id || null,
        cleaner_id: cleaner.id,
        source: "cleaner-job-checklist",
        summary:
          `${bookingRef} — ${cleanerName} reports an add-on performed: ${catalogEntry.label} ($${catalogEntry.price.toFixed(2)})` +
          `${note ? ` — "${note}"` : ""}.\nApprove in the Dispatch console to charge the customer and bump the cleaner's pay by ~$${(cleanerShareCents / 100).toFixed(2)}.`,
        data: { request_id: request.id, addon_id: addonId, amount_cents: amountCents },
      }).then(() => undefined).catch(() => undefined);
    }

    const { data: requests } = await supabase
      .from("job_addon_requests")
      .select("id, addon_id, addon_label, amount_cents, cleaner_share_cents, note, status, cleaner_name, created_at, reviewed_at, charge_status")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false });

    const { data: freshChecklist } = await supabase
      .from("job_checklists")
      .select("items, total_items, completed_items, progress_pct, started_at, completed_at, last_activity_at, last_activity_by, service_type, section_meta, zone_completion")
      .eq("id", checklistRow.id)
      .maybeSingle();

    const itemsMap = (freshChecklist?.items || {}) as Record<string, unknown>;
    const { completed, unresolvedKeys, skips } = countResolved(itemsMap, totalItems, spec.sections);
    const progressPct = totalItems > 0 ? Math.round((completed / totalItems) * 100) : 0;
    const liveMeta = (freshChecklist?.section_meta && typeof freshChecklist.section_meta === "object")
      ? freshChecklist.section_meta as Record<string, SectionMeta>
      : sectionMeta;
    const photoGate = hasPhotoSections
      ? sectionPhotosOk(liveMeta, photoSections)
      : { ok: true, missing: [] as number[] };

    const areasComplete = spec.sections.map((section, sIdx) => {
      const itemDone = section.items.every((_, iIdx) => isResolved(itemsMap[`${sIdx}:${iIdx}`]));
      const m = liveMeta[String(sIdx)] || {};
      const photosDone = !section.photoRequired
        || ((Array.isArray(m.before) && m.before.length > 0) && (Array.isArray(m.after) && m.after.length > 0));
      return {
        title: section.title,
        areaId: section.areaId || null,
        zoneName: section.zoneName || null,
        photoRequired: Boolean(section.photoRequired),
        tasksDone: itemDone,
        photosDone,
        complete: itemDone && photosDone,
      };
    });

    const catalog = Object.entries(CONTRACTOR_ADDON_CATALOG).map(([id, a]) => ({
      id,
      label: a.label,
      price: a.price,
      note: a.note,
      included: includedAddOns.includes(id) || freeForService(id),
    }));

    const zoneCompletion = parseZoneCompletions(
      (freshChecklist as { zone_completion?: unknown } | null)?.zone_completion
        ?? (checklistRow as { zone_completion?: unknown }).zone_completion,
    );
    const { count: liveCrewCount } = await supabase
      .from("job_assignments")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId)
      .or("status.ilike.confirmed,status.ilike.accepted,status.ilike.assigned,status.ilike.in progress");
    const crewSize = Math.max(1, liveCrewCount ?? 1);
    const isCrewLead = crewSize === 1 || /lead/i.test(assignmentRole);

    return json({
      ok: true,
      canWrite,
      is_crew_lead: isCrewLead,
      crew_size: crewSize,
      zone_completion: zoneCompletion,
      job: {
        id: job.id,
        service_type: checklistKey,
        address: job.address,
        city: job.city,
        state: job.state,
        zip: job.zip,
        start_datetime: job.start_datetime,
        duration_est_hours: job.duration_est_hours,
        status: job.status,
      },
      booking: booking
        ? {
          ref: bookingRef,
          first_name: booking.first_name,
          service_date: booking.service_date,
          time_slot: booking.time_slot || booking.arrival_window,
          access_notes: booking.access_notes,
          team_notes: booking.team_notes || null,
          dispatch_notes: booking.dispatch_notes || null,
          add_ons: includedAddOns,
          focused_areas: focusedAreas,
          facility_type: booking.facility_type || null,
          scope_level: booking.scope_level || null,
          square_footage: booking.square_footage || null,
          hard_deadline: booking.hard_deadline || null,
        }
        : null,
      cleaner: cleaner ? { id: cleaner.id, first_name: cleaner.first_name } : null,
      checklist: {
        key: spec.key,
        name: spec.name,
        blurb: spec.blurb || null,
        sections: spec.sections,
        items: itemsMap,
        total_items: totalItems,
        completed_items: completed,
        progress_pct: progressPct,
        started_at: freshChecklist?.started_at || checklistRow.started_at,
        completed_at: freshChecklist?.completed_at || null,
        last_activity_at: freshChecklist?.last_activity_at || null,
        last_activity_by: freshChecklist?.last_activity_by || null,
        section_meta: liveMeta,
        unresolved_count: unresolvedKeys.length,
        skips,
      },
      focused: isFocused
        ? {
          enabled: true,
          areas_label: formatFocusedAreasLabel(focusedAreas, focusedSettings),
          scope_boundary: focusedScopeBoundaryText(focusedAreas, focusedSettings),
          areas_progress: areasComplete,
          photos_complete: photoGate.ok,
          missing_photo_sections: photoGate.missing,
        }
        : { enabled: false },
      // Same shape as `focused` — a large site is documented zone by zone, so
      // the UI drives per-section photo capture the same way.
      zones: photoZones.length
        ? {
          enabled: true,
          names: photoZones,
          sections: photoSections,
          progress: areasComplete,
          photos_complete: photoGate.ok,
          missing_photo_sections: photoGate.missing,
          completion: zoneCompletion,
        }
        : { enabled: false },
      addons: {
        enabled: addonsEnabled,
        sharePct,
        teamSize,
        catalog,
        requests: requests || [],
      },
      findings: booking?.id ? await listSiteFindings(supabase, booking.id) : [],
      finding_areas: focusedSettings.areas.map((a) => ({
        id: a.id,
        label: a.label,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cleaner-job-checklist]", msg);
    return json({ ok: false, error: msg }, 500);
  }
});

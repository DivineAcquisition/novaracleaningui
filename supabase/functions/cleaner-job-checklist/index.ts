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
//   { token, action:'save_section_photos', sectionIndex, before?, after? }
//   { token, action:'conditions_found', sectionIndex, note, photos? }
//   { token, action:'request_scope_addition', note }
//   { token, action:'request_addon', addonId, note? }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  CONTRACTOR_ADDON_CATALOG,
  countChecklistItems,
  getContractorChecklist,
} from "../_shared/contractor-checklists.ts";
import { ensureJobChecklist } from "../_shared/job-checklist.ts";
import {
  FOCUSED_SAME_DAY_DEFAULTS,
  FOCUSED_SAME_DAY_SETTINGS_KEY,
  formatFocusedAreasLabel,
  focusedScopeBoundaryText,
  mergeFocusedSameDaySettings,
  type FocusedAreaSelection,
  type FocusedSameDaySettings,
} from "../_shared/focused-same-day.ts";

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

function sectionPhotosOk(meta: Record<string, SectionMeta>, sectionCount: number): {
  ok: boolean;
  missing: number[];
} {
  const missing: number[] = [];
  for (let i = 0; i < sectionCount; i++) {
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

    const { data: assignment } = await supabase
      .from("job_assignments")
      .select("id, job_id, cleaner_id, status, pay_percentage_snapshot, cleaners(id, first_name, last_name, pay_percentage)")
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
      .select("id, booking_number, first_name, service_date, time_slot, arrival_window, add_ons, access_notes, service_type, status, focused_areas")
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

    const focusedSettings = isFocused ? await loadFocusedSettings(supabase) : FOCUSED_SAME_DAY_DEFAULTS;
    const spec = getContractorChecklist(checklistRow.service_type, focusedAreas, focusedSettings);
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
      || action === "request_scope_addition") {
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
      if (!isFocused) return json({ ok: false, error: "Per-area photos apply to focused cleans." }, 400);
      const sectionIndex = Number(body?.sectionIndex);
      if (!Number.isInteger(sectionIndex) || !spec.sections[sectionIndex]) {
        return json({ ok: false, error: "Unknown area section." }, 400);
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
      if (isFocused) {
        const photoGate = sectionPhotosOk(sectionMeta, spec.sections.length);
        if (!photoGate.ok) {
          const names = photoGate.missing.map((i) => spec.sections[i]?.title || `Area ${i + 1}`).join(", ");
          return json({
            ok: false,
            error: `Before and after photos are required for every area. Missing: ${names}.`,
            missingSections: photoGate.missing,
          }, 400);
        }
      }
      await persistProgress(items, { completed_at: nowIso });
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
          section_meta: isFocused ? sectionMeta : undefined,
        },
      }).then(() => undefined).catch(() => undefined);
    }

    const addonsEnabled = await contractorAddonsEnabled(supabase);
    const includedAddOns: string[] = Array.isArray(booking?.add_ons) ? booking.add_ons.map(String) : [];
    const freeForService = (id: string) =>
      serviceTypeRaw === "moveInOut" && (id === "fridge" || id === "oven");

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
      .select("items, total_items, completed_items, progress_pct, started_at, completed_at, last_activity_at, last_activity_by, service_type, section_meta")
      .eq("id", checklistRow.id)
      .maybeSingle();

    const itemsMap = (freshChecklist?.items || {}) as Record<string, unknown>;
    const { completed, unresolvedKeys, skips } = countResolved(itemsMap, totalItems, spec.sections);
    const progressPct = totalItems > 0 ? Math.round((completed / totalItems) * 100) : 0;
    const liveMeta = (freshChecklist?.section_meta && typeof freshChecklist.section_meta === "object")
      ? freshChecklist.section_meta as Record<string, SectionMeta>
      : sectionMeta;
    const photoGate = isFocused ? sectionPhotosOk(liveMeta, spec.sections.length) : { ok: true, missing: [] as number[] };

    const areasComplete = spec.sections.map((section, sIdx) => {
      const itemDone = section.items.every((_, iIdx) => isResolved(itemsMap[`${sIdx}:${iIdx}`]));
      const m = liveMeta[String(sIdx)] || {};
      const photosDone = !isFocused
        || ((Array.isArray(m.before) && m.before.length > 0) && (Array.isArray(m.after) && m.after.length > 0));
      return {
        title: section.title,
        areaId: section.areaId || null,
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

    return json({
      ok: true,
      canWrite,
      job: {
        id: job.id,
        service_type: serviceTypeRaw,
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
          add_ons: includedAddOns,
          focused_areas: focusedAreas,
        }
        : null,
      cleaner: cleaner ? { id: cleaner.id, first_name: cleaner.first_name } : null,
      checklist: {
        name: spec.name,
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
      addons: {
        enabled: addonsEnabled,
        sharePct,
        teamSize,
        catalog,
        requests: requests || [],
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cleaner-job-checklist]", msg);
    return json({ ok: false, error: msg }, 500);
  }
});

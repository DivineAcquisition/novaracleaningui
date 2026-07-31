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
//   { token, action:'complete' }                 → mark checklist finished
//   { token, action:'request_addon', addonId, note? }
//       → contractor reports an add-on they performed. The request is
//         PENDING until an admin approves it in the Dispatch console —
//         only then is the customer charged and the cleaner's pay bumped.
//         Disabled entirely when app_settings.contractor_addons_enabled
//         is false.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  CONTRACTOR_ADDON_CATALOG,
  countChecklistItems,
  getContractorChecklist,
} from "../_shared/contractor-checklists.ts";
import { ensureJobChecklist } from "../_shared/job-checklist.ts";

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // deno-lint-ignore no-explicit-any
  const supabase: any = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token || "").trim();
    const action = String(body?.action || "get").toLowerCase();
    if (!token) return json({ ok: false, error: "Missing token" }, 400);

    // ─── Resolve token → job (+ cleaner when it's an assignment token) ───
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
        canWrite = false; // admin preview — read-only
      }
    }

    if (!jobId) return json({ ok: false, reason: "not_found", error: "Checklist link not found or expired." }, 404);

    // ─── Load job + booking + checklist row ──────────────────────────────
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

    const focusedAreas = Array.isArray(booking?.focused_areas) ? booking.focused_areas : [];
    const spec = getContractorChecklist(checklistRow.service_type, focusedAreas);
    const totalItems = countChecklistItems(spec);
    const nowIso = new Date().toISOString();
    const cleanerName = cleaner
      ? `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim() || "Cleaner"
      : "Team";
    const bookingRef = booking?.booking_number
      ? `NVC-${String(booking.booking_number).padStart(4, "0")}`
      : `Job ${String(jobId).slice(0, 8)}`;

    // ─── Mutations ───────────────────────────────────────────────────────
    if (action === "toggle" || action === "complete") {
      if (!canWrite) return json({ ok: false, error: "This link is view-only." }, 403);

      const items: Record<string, unknown> = { ...(checklistRow.items || {}) };

      if (action === "toggle") {
        const itemKey = String(body?.itemKey || "");
        const done = body?.done === true;
        const [secIdx, itemIdx] = itemKey.split(":").map((n) => Number(n));
        const validKey = Number.isInteger(secIdx) && Number.isInteger(itemIdx) &&
          spec.sections[secIdx]?.items[itemIdx] != null;
        if (!validKey) return json({ ok: false, error: "Unknown checklist item." }, 400);
        if (done) {
          items[itemKey] = { done: true, at: nowIso, by: cleanerName };
        } else {
          delete items[itemKey];
        }
      }

      const completedCount = Object.keys(items).length;
      const progressPct = totalItems > 0 ? Math.round((completedCount / totalItems) * 100) : 0;
      const patch: Record<string, unknown> = {
        items,
        total_items: totalItems,
        completed_items: completedCount,
        progress_pct: progressPct,
        started_at: checklistRow.started_at || nowIso,
        last_activity_at: nowIso,
        last_activity_by: cleanerName,
        updated_at: nowIso,
      };
      if (action === "complete") {
        patch.completed_at = nowIso;
      } else if (checklistRow.completed_at && completedCount < totalItems) {
        patch.completed_at = null;
      }

      const { error: updErr } = await supabase
        .from("job_checklists")
        .update(patch)
        .eq("id", checklistRow.id);
      if (updErr) return json({ ok: false, error: updErr.message }, 500);

      if (action === "complete") {
        await supabase.from("events").insert({
          event_type: "job.checklist.completed",
          job_id: jobId,
          booking_id: booking?.id || null,
          cleaner_id: cleaner?.id || null,
          source: "cleaner-job-checklist",
          summary: `${bookingRef} — job checklist completed by ${cleanerName} (${completedCount}/${totalItems} items).`,
          data: { checklist_id: checklistRow.id, completed_items: completedCount, total_items: totalItems },
        }).then(() => undefined).catch(() => undefined);
      }

      Object.assign(checklistRow, patch);
    }

    const addonsEnabled = await contractorAddonsEnabled(supabase);
    const includedAddOns: string[] = Array.isArray(booking?.add_ons) ? booking.add_ons.map(String) : [];
    const serviceTypeRaw = String(booking?.service_type || job.service_type || "standard");
    const freeForService = (id: string) =>
      serviceTypeRaw === "moveInOut" && (id === "fridge" || id === "oven");

    // Team size + share pct for the visible "your pay grows by" hint.
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

    // ─── Full state response (all actions end here) ──────────────────────
    const { data: requests } = await supabase
      .from("job_addon_requests")
      .select("id, addon_id, addon_label, amount_cents, cleaner_share_cents, note, status, cleaner_name, created_at, reviewed_at, charge_status")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false });

    const { data: freshChecklist } = await supabase
      .from("job_checklists")
      .select("items, total_items, completed_items, progress_pct, started_at, completed_at, last_activity_at, last_activity_by, service_type")
      .eq("id", checklistRow.id)
      .maybeSingle();

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
        }
        : null,
      cleaner: cleaner ? { id: cleaner.id, first_name: cleaner.first_name } : null,
      checklist: {
        name: spec.name,
        sections: spec.sections,
        ...(freshChecklist || {}),
        total_items: totalItems,
      },
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

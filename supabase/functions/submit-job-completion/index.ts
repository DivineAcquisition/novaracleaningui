// submit-job-completion
//
// Cleaner posts the final outcome of a job via this endpoint.
//
// Body: {
//   token: string,                                         (required)
//   outcome: 'completed' | 'quality_issue' | 'incomplete' | 'escalated',
//   notes?: string,
//   beforePhotoUrls?: string[],
//   afterPhotoUrls?: string[],
// }
//
// On completed: sets assignment/job/booking to Completed, stamps
// completed_at, syncs GHL contact custom fields (job_status,
// before_photos, after_photos, completion_notes, job_completed_at).
// Other outcomes: same status push + dispatch_alerts + cleaner_flags
// insert so admin sees the issue immediately. GHL always re-synced.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

async function loadCustomFieldMap(token: string, locationId: string): Promise<Record<string, string>> {
  try {
    const r = await fetch(`${GHL_BASE}/locations/${encodeURIComponent(locationId)}/customFields`, {
      headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION, Accept: "application/json" },
    });
    if (!r.ok) return {};
    const j = await r.json();
    const map: Record<string, string> = {};
    for (const f of (j.customFields ?? []) as Array<any>) {
      if (!f?.id) continue;
      const raw = (f.fieldKey || f.key || "") as string;
      const bare = raw.split(".").pop() || raw;
      if (bare) map[bare] = f.id;
      if (raw) map[raw] = f.id;
      if (f.name) map[f.name] = f.id;
    }
    return map;
  } catch { return {}; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token || "").trim();
    const outcome = String(body?.outcome || "").toLowerCase();
    const allowed = ["completed", "quality_issue", "incomplete", "escalated"];
    if (!token || !allowed.includes(outcome)) {
      return new Response(JSON.stringify({ ok: false, reason: "bad_request", message: "Missing token or invalid outcome" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const notes = body?.notes ? String(body.notes).slice(0, 2000) : null;
    const beforePhotos: string[] = Array.isArray(body?.beforePhotoUrls) ? body.beforePhotoUrls.slice(0, 12) : [];
    const afterPhotos: string[] = Array.isArray(body?.afterPhotoUrls) ? body.afterPhotoUrls.slice(0, 12) : [];

    if (outcome === "completed" && (beforePhotos.length === 0 || afterPhotos.length === 0)) {
      return new Response(JSON.stringify({ ok: false, reason: "photos_required", message: "Upload at least one before AND one after photo to mark complete." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: assignment } = await supabase
      .from("job_assignments")
      .select("id, job_id, cleaner_id, role, status, completion_submitted_at")
      .eq("completion_token", token)
      .maybeSingle();
    if (!assignment) {
      return new Response(JSON.stringify({ ok: false, reason: "not_found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }
    if (assignment.completion_submitted_at) {
      return new Response(JSON.stringify({ ok: true, reason: "already_submitted" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const newStatus =
      outcome === "completed" ? "Completed"
      : outcome === "quality_issue" ? "Quality Issue"
      : outcome === "incomplete" ? "Incomplete"
      : "Escalated";
    const nowIso = new Date().toISOString();

    await supabase
      .from("job_assignments")
      .update({
        status: newStatus,
        completion_submitted_at: nowIso,
        completion_outcome: outcome,
        completion_notes: notes,
        before_photo_urls: beforePhotos,
        after_photo_urls: afterPhotos,
      })
      .eq("id", assignment.id);

    const isLead = String(assignment.role || "").toLowerCase() === "lead";
    const { data: job } = await supabase
      .from("jobs")
      .select("id, customer_id, status, start_datetime")
      .eq("id", assignment.job_id)
      .maybeSingle();

    let booking: any = null;
    if (job) {
      const jobPatch: any = {};
      if (outcome === "completed") {
        jobPatch.status = "Completed";
        jobPatch.check_out_time = nowIso;
      } else if (outcome === "incomplete") {
        jobPatch.status = "Incomplete";
      } else if (outcome === "escalated") {
        jobPatch.status = "Escalated";
        jobPatch.manual_intervention_required = true;
        jobPatch.dispatch_alert_reason = "Cleaner escalated post-job";
      } else if (outcome === "quality_issue") {
        jobPatch.status = "Quality Issue";
        jobPatch.manual_intervention_required = true;
      }
      if (isLead && Object.keys(jobPatch).length > 0) {
        await supabase.from("jobs").update(jobPatch).eq("id", job.id);
      }

      const { data: b } = await supabase
        .from("bookings")
        .select("id, ghl_contact_id, status, before_photos, after_photos, issues_notes")
        .eq("job_id", job.id)
        .limit(1)
        .maybeSingle();
      booking = b;
      if (booking && isLead) {
        const bookingPatch: any = {
          before_photos: Array.from(new Set([...(booking.before_photos || []), ...beforePhotos])),
          after_photos: Array.from(new Set([...(booking.after_photos || []), ...afterPhotos])),
          issues_notes: notes || booking.issues_notes,
          issues_flag: outcome !== "completed",
        };
        if (outcome === "completed") {
          bookingPatch.status = "completed";
          bookingPatch.completed_at = nowIso;
        }
        await supabase.from("bookings").update(bookingPatch).eq("id", booking.id);
      }
    }

    // GHL contact sync.
    try {
      const ghlToken = (Deno.env.get("GHL_PIT_TOKEN") || "").trim();
      const ghlLocation = (Deno.env.get("GHL_LOCATION_ID") || "").trim();
      const customerContactId = (booking as any)?.ghl_contact_id as string | undefined;
      if (ghlToken && ghlLocation && customerContactId) {
        const fieldMap = await loadCustomFieldMap(ghlToken, ghlLocation);
        const ghlStatus =
          outcome === "completed" ? "Completed"
          : outcome === "quality_issue" ? "Quality Issue Reported"
          : outcome === "incomplete" ? "Incomplete"
          : "Escalated";
        const desired: Record<string, string> = {
          job_status: ghlStatus,
          completion_notes: notes || "",
          before_photos: beforePhotos.join("\n"),
          after_photos: afterPhotos.join("\n"),
          job_completed_at: outcome === "completed" ? nowIso : "",
        };
        const customFields: Array<{ id: string; field_value: string }> = [];
        for (const [key, val] of Object.entries(desired)) {
          const fid = fieldMap[key] ?? fieldMap[`contact.${key}`];
          if (fid && val) customFields.push({ id: fid, field_value: val });
        }
        const tags =
          outcome === "completed" ? ["job-complete"]
          : outcome === "escalated" ? ["job-escalated"]
          : ["job-needs-review"];
        if (customFields.length > 0 || tags.length > 0) {
          await fetch(`${GHL_BASE}/contacts/${encodeURIComponent(customerContactId)}`, {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${ghlToken}`,
              Version: GHL_VERSION,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ customFields, tags }),
          });
        }
      }
    } catch (err) {
      console.warn("[submit-job-completion] GHL update failed (non-fatal)", err instanceof Error ? err.message : String(err));
    }

    if (outcome !== "completed") {
      try {
        await supabase.from("dispatch_alerts").insert({
          job_id: assignment.job_id,
          reason: `Cleaner submitted '${outcome.replace(/_/g, " ")}' on wrap-up`,
          severity: outcome === "escalated" ? "critical" : "warning",
        });
      } catch { /* non-blocking */ }
      try {
        await supabase.from("cleaner_flags").insert({
          cleaner_id: assignment.cleaner_id,
          issue_type: outcome === "escalated" ? "customer_complaint" : "quality_issue",
          severity: outcome === "escalated" ? "high" : "medium",
          details: notes,
          job_id: assignment.job_id,
        });
      } catch { /* non-blocking */ }
    }

    if (outcome === "completed") {
      try {
        const { data: c } = await supabase
          .from("cleaners")
          .select("completed_bookings, total_bookings")
          .eq("id", assignment.cleaner_id)
          .maybeSingle();
        if (c) {
          await supabase
            .from("cleaners")
            .update({
              completed_bookings: Number(c.completed_bookings || 0) + 1,
              total_bookings: Math.max(
                Number(c.total_bookings || 0),
                Number(c.completed_bookings || 0) + 1,
              ),
            })
            .eq("id", assignment.cleaner_id);
        }
      } catch { /* non-blocking */ }
    }

    try {
      await supabase.from("events").insert({
        event_type:
          outcome === "completed" ? "booking.completed"
          : outcome === "quality_issue" ? "booking.quality_issue"
          : outcome === "incomplete" ? "booking.incomplete"
          : "booking.escalated",
        cleaner_id: assignment.cleaner_id,
        job_id: assignment.job_id,
        booking_id: (booking as any)?.id || null,
        source: "submit-job-completion",
        summary: `Cleaner submitted '${outcome.replace(/_/g, " ")}' on wrap-up`,
        data: {
          assignment_id: assignment.id,
          role: assignment.role,
          photos: beforePhotos.length + afterPhotos.length,
        },
      });
    } catch { /* non-blocking */ }

    return new Response(JSON.stringify({ ok: true, outcome, status: newStatus }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[submit-job-completion] error", msg);
    return new Response(JSON.stringify({ ok: false, reason: "server_error", message: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

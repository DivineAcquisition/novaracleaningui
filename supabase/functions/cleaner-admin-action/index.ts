// cleaner-admin-action
//
// Single state-machine for ALL administrative actions on a cleaner.
// Phase-3 spec: deactivateCleaner, terminateCleaner, reactivateCleaner,
// flagCleanerIssue, resolveCleanerFlag, updateCompliance.
//
// Guardrails (all enforced server-side):
//  * Caller must hold admin or va role (from user_roles).
//  * Reactivate validates background-check + insurance are CURRENT;
//    returns a structured error naming the exact reason if not.
//  * Deactivate / terminate NEVER delete the cleaner row — they set
//    status + deactivated_at + reason + available_for_bookings=false,
//    then mark all OPEN future job_assignments as 'needs_reassignment'
//    (a NEW status value that the existing dispatch loop ignores
//    because it filters for 'assigned' / 'accepted').
//  * Termination requires a stronger reason set and persists
//    terminated_at + termination_reason.
//  * Every action writes an event to public.events and a job_status_
//    history row when relevant, so the activity feed lights up.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEACTIVATION_REASONS = new Set([
  "personal_request", "performance_issue", "no_show_pattern",
  "compliance_failure", "low_rating", "customer_complaint", "other",
]);

const TERMINATION_REASONS = new Set([
  "misconduct", "compliance_failure", "persistent_no_show",
  "contract_violation", "abandoned_role", "other",
]);

const FLAG_ISSUE_TYPES = new Set([
  "background_check_expiring", "insurance_expiring", "low_rating",
  "attendance_problem", "customer_complaint", "quality_issue",
  "policy_violation", "no_show", "other",
]);

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}

async function ensureCallerCanAdminister(adminClient: any, jwt: string) {
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: user, error } = await userClient.auth.getUser();
  if (error || !user?.user) throw new Error("unauthorized");
  const uid = user.user.id;

  const { data: roles } = await adminClient
    .from("user_roles").select("role").eq("user_id", uid);
  const allowed = (roles || []).some((r: any) => ["admin", "va"].includes(r.role));
  if (!allowed) throw new Error("forbidden: requires admin or va role");
  return uid;
}

async function markFutureAssignmentsForReassignment(
  adminClient: any, cleanerId: string, callerId: string, reason: string,
) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: openAssignments } = await adminClient
    .from("job_assignments").select("id, job_id, status")
    .eq("cleaner_id", cleanerId)
    .in("status", ["assigned", "accepted"]);

  if (!openAssignments || openAssignments.length === 0) return [];

  const jobIds = openAssignments.map((a: any) => a.job_id);
  const { data: futureJobs } = await adminClient
    .from("bookings").select("id, job_id, booking_number, service_date, time_slot, address")
    .in("job_id", jobIds).gte("service_date", today);
  const futureJobIds = new Set((futureJobs || []).map((j: any) => j.job_id));
  const targets = openAssignments.filter((a: any) => futureJobIds.has(a.job_id));

  if (targets.length === 0) return [];

  const ids = targets.map((t: any) => t.id);
  await adminClient.from("job_assignments")
    .update({ status: "needs_reassignment" })
    .in("id", ids);

  for (const t of targets) {
    await adminClient.from("job_status_history").insert({
      job_id: t.job_id, from_status: t.status, to_status: "needs_reassignment",
      changed_by: callerId,
      metadata: { reason, source: "cleaner-admin-action", cleaner_id: cleanerId },
    });
  }
  return futureJobs || [];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  let callerId: string;
  try {
    const auth = req.headers.get("Authorization") || "";
    const jwt = auth.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "missing bearer token" }, 401);
    callerId = await ensureCallerCanAdminister(adminClient, jwt);
  } catch (e) {
    return json({ error: String((e as Error).message) }, 403);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  const { action, cleanerId } = body || {};
  if (!action || !cleanerId) return json({ error: "action + cleanerId required" }, 400);

  const { data: cleaner, error: cErr } = await adminClient
    .from("cleaners").select("*").eq("id", cleanerId).maybeSingle();
  if (cErr || !cleaner) return json({ error: "cleaner not found" }, 404);

  try {
    switch (action) {
      case "deactivate": {
        const reason = String(body.reason || "").trim();
        if (!DEACTIVATION_REASONS.has(reason)) {
          return json({ error: `reason must be one of: ${[...DEACTIVATION_REASONS].join(", ")}` }, 400);
        }
        if (cleaner.status === "terminated") {
          return json({ error: "cannot deactivate a terminated cleaner" }, 409);
        }
        const { data: updated } = await adminClient
          .from("cleaners")
          .update({
            status: "inactive", deactivated_at: new Date().toISOString(),
            deactivation_reason: reason, available_for_bookings: false,
            updated_at: new Date().toISOString(),
          })
          .eq("id", cleanerId).select().maybeSingle();
        const reassigned = await markFutureAssignmentsForReassignment(adminClient, cleanerId, callerId, `cleaner_deactivated:${reason}`);
        await adminClient.from("events").insert({
          event_type: "cleaner.deactivated", cleaner_id: cleanerId, source: "cleaner-admin-action",
          summary: `Cleaner ${cleaner.first_name || ""} ${cleaner.last_name || ""} deactivated — ${reason}`,
          data: { reason, by: callerId, reassigned_jobs: reassigned.length },
        });
        return json({ ok: true, cleaner: updated, reassignedJobs: reassigned });
      }

      case "terminate": {
        const reason = String(body.reason || "").trim();
        if (!TERMINATION_REASONS.has(reason)) {
          return json({ error: `reason must be one of: ${[...TERMINATION_REASONS].join(", ")}` }, 400);
        }
        const { data: updated } = await adminClient
          .from("cleaners")
          .update({
            status: "terminated",
            terminated_at: new Date().toISOString(), termination_reason: reason,
            deactivated_at: cleaner.deactivated_at ?? new Date().toISOString(),
            deactivation_reason: cleaner.deactivation_reason ?? reason,
            available_for_bookings: false, approved: false,
            updated_at: new Date().toISOString(),
          })
          .eq("id", cleanerId).select().maybeSingle();
        const reassigned = await markFutureAssignmentsForReassignment(adminClient, cleanerId, callerId, `cleaner_terminated:${reason}`);
        await adminClient.from("events").insert({
          event_type: "cleaner.terminated", cleaner_id: cleanerId, source: "cleaner-admin-action",
          summary: `Cleaner ${cleaner.first_name || ""} ${cleaner.last_name || ""} terminated — ${reason}`,
          data: { reason, by: callerId, reassigned_jobs: reassigned.length },
        });
        return json({ ok: true, cleaner: updated, reassignedJobs: reassigned });
      }

      case "reactivate": {
        if (cleaner.status === "terminated") {
          return json({ error: "cannot reactivate a terminated cleaner; create a new record instead", code: "TERMINATED" }, 409);
        }
        const today = new Date().toISOString().slice(0, 10);
        const blockers: string[] = [];
        if (!cleaner.background_check_expires_at) blockers.push("background_check_not_on_file");
        else if (cleaner.background_check_expires_at < today) blockers.push("background_check_expired");
        if (!cleaner.insurance_verified) blockers.push("insurance_not_verified");
        else if (cleaner.insurance_expires_at && cleaner.insurance_expires_at < today) blockers.push("insurance_expired");
        if (blockers.length > 0) {
          return json({ error: "compliance blockers prevent reactivation", blockers }, 409);
        }
        const { data: updated } = await adminClient
          .from("cleaners")
          .update({
            status: "active", available_for_bookings: true,
            deactivated_at: null, deactivation_reason: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", cleanerId).select().maybeSingle();
        await adminClient.from("events").insert({
          event_type: "cleaner.reactivated", cleaner_id: cleanerId, source: "cleaner-admin-action",
          summary: `Cleaner ${cleaner.first_name || ""} ${cleaner.last_name || ""} reactivated`,
          data: { by: callerId },
        });
        return json({ ok: true, cleaner: updated });
      }

      case "flag": {
        const issueType = String(body.issueType || "").trim();
        if (!FLAG_ISSUE_TYPES.has(issueType)) {
          return json({ error: `issueType must be one of: ${[...FLAG_ISSUE_TYPES].join(", ")}` }, 400);
        }
        const severity = body.severity || "medium";
        const { data: flag, error } = await adminClient
          .from("cleaner_flags")
          .insert({
            cleaner_id: cleanerId, issue_type: issueType, severity,
            details: body.details || null, flagged_by: callerId,
            job_id: body.jobId || null,
          })
          .select().maybeSingle();
        if (error) throw error;

        const since = new Date(Date.now() - 30 * 86400000).toISOString();
        const { count: openCount } = await adminClient
          .from("cleaner_flags").select("id", { count: "exact", head: true })
          .eq("cleaner_id", cleanerId).eq("resolved", false).gte("created_at", since);
        if ((openCount ?? 0) >= 3) {
          await adminClient.from("events").insert({
            event_type: "cleaner.escalation", cleaner_id: cleanerId, source: "cleaner-admin-action",
            summary: `⚠️ Escalation: ${cleaner.first_name || ""} ${cleaner.last_name || ""} — ${openCount} open flags in last 30 days`,
            data: { open_flag_count: openCount, latest_issue: issueType },
          });
        }

        await adminClient.from("events").insert({
          event_type: "cleaner.flagged", cleaner_id: cleanerId, source: "cleaner-admin-action",
          summary: `Flag added — ${issueType} (${severity})`,
          data: { issue_type: issueType, severity, by: callerId, flag_id: flag?.id },
        });
        return json({ ok: true, flag, openFlagCount: openCount });
      }

      case "resolve_flag": {
        const flagId = body.flagId;
        if (!flagId) return json({ error: "flagId required" }, 400);
        const { data: updated, error } = await adminClient
          .from("cleaner_flags")
          .update({
            resolved: true, resolved_at: new Date().toISOString(),
            resolved_by: callerId, resolution_notes: body.resolutionNotes || null,
          })
          .eq("id", flagId).eq("cleaner_id", cleanerId).select().maybeSingle();
        if (error) throw error;
        return json({ ok: true, flag: updated });
      }

      case "update_compliance": {
        const c = body.compliance || {};
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (c.backgroundCheckStatus !== undefined) patch.background_check_status = c.backgroundCheckStatus;
        if (c.backgroundCheckDate !== undefined) patch.background_check_date = c.backgroundCheckDate;
        if (c.backgroundCheckExpiresAt !== undefined) patch.background_check_expires_at = c.backgroundCheckExpiresAt;
        if (c.insuranceVerified !== undefined) patch.insurance_verified = c.insuranceVerified;
        if (c.insuranceCarrier !== undefined) patch.insurance_carrier = c.insuranceCarrier;
        if (c.insurancePolicyNumber !== undefined) patch.insurance_policy_number = c.insurancePolicyNumber;
        if (c.insuranceExpiresAt !== undefined) patch.insurance_expires_at = c.insuranceExpiresAt;
        const { data: updated, error } = await adminClient
          .from("cleaners").update(patch).eq("id", cleanerId).select().maybeSingle();
        if (error) throw error;
        await adminClient.from("events").insert({
          event_type: "cleaner.compliance_updated", cleaner_id: cleanerId, source: "cleaner-admin-action",
          summary: `Compliance updated for ${cleaner.first_name || ""} ${cleaner.last_name || ""}`,
          data: { patch, by: callerId },
        });
        return json({ ok: true, cleaner: updated });
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[cleaner-admin-action]", message);
    return json({ error: message }, 500);
  }
});

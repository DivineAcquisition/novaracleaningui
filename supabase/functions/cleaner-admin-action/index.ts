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
    .in("status", ["Offered", "Accepted", "Confirmed"]);

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
    .update({ status: "Needs Reassignment" })
    .in("id", ids);

  for (const t of targets) {
    await adminClient.from("job_status_history").insert({
      job_id: t.job_id, from_status: t.status, to_status: "Needs Reassignment",
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
  if (!action) return json({ error: "action required" }, 400);

  // bypass_onboarding has its own pre-cleaner lookup path because it
  // also supports a phone-only call (no cleanerId yet — we resolve or
  // create the row from the phone).
  if (action !== "bypass_onboarding_send_code" && action !== "bypass_onboarding_verify_code") {
    if (!cleanerId) return json({ error: "cleanerId required" }, 400);
  }

  let cleaner: any = null;
  if (cleanerId) {
    const { data, error: cErr } = await adminClient
      .from("cleaners").select("*").eq("id", cleanerId).maybeSingle();
    if (cErr) return json({ error: "cleaner lookup failed" }, 500);
    if (!data) return json({ error: "cleaner not found" }, 404);
    cleaner = data;
  }

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
        adminClient.functions.invoke("sync-cleaner-to-ghl", { body: { cleanerId } })
          .catch((e: any) => console.warn("[cleaner-admin-action] GHL sync failed", e?.message || e));
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
        adminClient.functions.invoke("sync-cleaner-to-ghl", { body: { cleanerId } })
          .catch((e: any) => console.warn("[cleaner-admin-action] GHL sync failed", e?.message || e));
        return json({ ok: true, cleaner: updated, reassignedJobs: reassigned });
      }

      case "set_status": {
        const ALLOWED = new Set(["pending", "active", "inactive", "terminated"]);
        const newStatus = String(body.status || "").trim().toLowerCase();
        if (!ALLOWED.has(newStatus)) {
          return json({ error: `status must be one of: ${[...ALLOWED].join(", ")}` }, 400);
        }
        const prevStatus = String(cleaner.status || "pending").toLowerCase();
        if (newStatus === prevStatus) {
          return json({ ok: true, cleaner, unchanged: true });
        }

        const reason = String(body.reason || "admin_manual_status_change").trim();
        const skipCompliance = Boolean(body.skipComplianceCheck);

        if (newStatus === "active" && !skipCompliance) {
          const today = new Date().toISOString().slice(0, 10);
          const blockers: string[] = [];
          if (!cleaner.background_check_expires_at) blockers.push("background_check_not_on_file");
          else if (cleaner.background_check_expires_at < today) blockers.push("background_check_expired");
          if (!cleaner.insurance_verified) blockers.push("insurance_not_verified");
          else if (cleaner.insurance_expires_at && cleaner.insurance_expires_at < today) {
            blockers.push("insurance_expired");
          }
          if (blockers.length > 0) {
            return json({
              error: "compliance blockers prevent setting active — use skipComplianceCheck to override",
              blockers,
            }, 409);
          }
        }

        if (skipCompliance) {
          const { data: adminRoles } = await adminClient
            .from("user_roles").select("role").eq("user_id", callerId);
          const isAdmin = (adminRoles || []).some((r: any) => r.role === "admin");
          if (!isAdmin) {
            return json({ error: "Only admins can skip compliance checks" }, 403);
          }
        }

        const patch: Record<string, unknown> = {
          status: newStatus,
          updated_at: new Date().toISOString(),
        };

        if (body.approved !== undefined) patch.approved = Boolean(body.approved);
        if (body.availableForBookings !== undefined) {
          patch.available_for_bookings = Boolean(body.availableForBookings);
        }

        if (newStatus === "active") {
          patch.available_for_bookings = body.availableForBookings ?? true;
          patch.approved = body.approved ?? true;
          patch.deactivated_at = null;
          patch.deactivation_reason = null;
          // Manual reactivation also clears any accountability suspension
          // window so the row can't carry a stale suspended_until stamp.
          patch.suspended_at = null;
          patch.suspended_until = null;
          patch.suspension_reason = null;
          if (!cleaner.activated_at) patch.activated_at = new Date().toISOString();
        } else if (newStatus === "pending") {
          patch.available_for_bookings = body.availableForBookings ?? false;
          if (body.approved === undefined) patch.approved = false;
        } else if (newStatus === "inactive") {
          patch.available_for_bookings = false;
          patch.deactivated_at = new Date().toISOString();
          patch.deactivation_reason = reason;
        } else if (newStatus === "terminated") {
          patch.available_for_bookings = false;
          patch.approved = false;
          patch.terminated_at = new Date().toISOString();
          patch.termination_reason = reason;
          patch.deactivated_at = cleaner.deactivated_at ?? new Date().toISOString();
          patch.deactivation_reason = cleaner.deactivation_reason ?? reason;
        }

        const { data: updated, error: upErr } = await adminClient
          .from("cleaners")
          .update(patch)
          .eq("id", cleanerId)
          .select()
          .maybeSingle();
        if (upErr) throw upErr;

        let reassigned: unknown[] = [];
        if (newStatus === "inactive" || newStatus === "terminated") {
          reassigned = await markFutureAssignmentsForReassignment(
            adminClient, cleanerId, callerId, `cleaner_status_${newStatus}:${reason}`,
          );
        }

        await adminClient.from("events").insert({
          event_type: "cleaner.status_changed",
          cleaner_id: cleanerId,
          source: "cleaner-admin-action",
          summary: `Cleaner ${cleaner.first_name || ""} ${cleaner.last_name || ""}: ${prevStatus} → ${newStatus}`,
          data: {
            from: prevStatus,
            to: newStatus,
            reason,
            by: callerId,
            skip_compliance: skipCompliance,
            reassigned_jobs: reassigned.length,
          },
        });

        adminClient.functions.invoke("sync-cleaner-to-ghl", { body: { cleanerId } })
          .catch((e: any) => console.warn("[cleaner-admin-action] GHL sync failed", e?.message || e));

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
            suspended_at: null, suspended_until: null, suspension_reason: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", cleanerId).select().maybeSingle();
        await adminClient.from("events").insert({
          event_type: "cleaner.reactivated", cleaner_id: cleanerId, source: "cleaner-admin-action",
          summary: `Cleaner ${cleaner.first_name || ""} ${cleaner.last_name || ""} reactivated`,
          data: { by: callerId },
        });
        adminClient.functions.invoke("sync-cleaner-to-ghl", { body: { cleanerId } })
          .catch((e: any) => console.warn("[cleaner-admin-action] GHL sync failed", e?.message || e));
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

      case "delete_cleaner": {
        // Hard-remove from the directory (admin only). Reassign open jobs first.
        const { data: adminRoles } = await adminClient
          .from("user_roles").select("role").eq("user_id", callerId);
        const isAdmin = (adminRoles || []).some((r: any) => r.role === "admin");
        if (!isAdmin) return json({ error: "Only admins can permanently delete cleaners" }, 403);

        const confirm = String(body.confirmName || "").trim().toLowerCase();
        const expected = `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim().toLowerCase();
        if (!confirm || confirm !== expected) {
          return json({
            error: "Type the cleaner's full name in confirmName to confirm permanent deletion",
            expectedName: `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim(),
          }, 400);
        }

        const reassigned = await markFutureAssignmentsForReassignment(
          adminClient, cleanerId, callerId, "cleaner_deleted",
        );

        if (cleaner.user_id) {
          try {
            await adminClient.auth.admin.deleteUser(cleaner.user_id);
          } catch (authErr) {
            console.warn("[cleaner-admin-action] auth user delete failed", authErr);
          }
        }

        const { error: delErr } = await adminClient.from("cleaners").delete().eq("id", cleanerId);
        if (delErr) throw delErr;

        await adminClient.from("events").insert({
          event_type: "cleaner.deleted",
          source: "cleaner-admin-action",
          summary: `Cleaner permanently removed from directory: ${cleaner.first_name || ""} ${cleaner.last_name || ""}`,
          data: { cleaner_id: cleanerId, by: callerId, reassigned_jobs: reassigned.length },
        });

        return json({ ok: true, deleted: true, reassignedJobs: reassigned });
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
        // Push compliance tag changes (bg-check-passed / -expiring,
        // insurance-on-file, etc.) into the contractor's GHL contact.
        adminClient.functions.invoke("sync-cleaner-to-ghl", { body: { cleanerId } })
          .catch((e: any) => console.warn("[cleaner-admin-action] GHL sync failed", e?.message || e));
        return json({ ok: true, cleaner: updated });
      }

      // ─── BYPASS ONBOARDING ───────────────────────────────────────────
      // Two-step admin flow that converts a phone number into an
      // active, dispatch-ready cleaner without forcing the full
      // multi-step onboarding portal.
      //
      // STEP 1: bypass_onboarding_send_code
      //   body: { phone, firstName?, lastName?, email?, homeAddress?, city?, state?, zip? }
      //   * Upsert (or find) the cleaners row by phone.
      //   * Generate a 6-digit code, store it on
      //     cleaner_verification_codes with a 10-minute expiry.
      //   * SMS the code via Telnyx (send-sms-notification), GHL fallback.
      //   * Returns the cleanerId so the UI can poll/show the code field.
      //
      // STEP 2: bypass_onboarding_verify_code
      //   body: { cleanerId, code }
      //   * Validate the code is present, unexpired, and matches.
      //   * Flip the cleaner row to status='active', approved=true,
      //     phone_verified=true, onboarding_complete=true,
      //     available_for_bookings=true. Stamp activated_at.
      //   * Fire-and-forget sync-cleaner-to-ghl + lifecycle email.
      case "bypass_onboarding_send_code": {
        const phoneRaw = String(body.phone || "").trim();
        if (!phoneRaw) return json({ error: "phone required" }, 400);
        const digits = phoneRaw.replace(/[^0-9]/g, "");
        const phoneE164 = digits.length === 10
          ? `+1${digits}`
          : digits.length === 11 && digits.startsWith("1")
          ? `+${digits}`
          : phoneRaw.startsWith("+") ? phoneRaw : `+${digits}`;
        const phoneShort = digits.length >= 10 ? digits.slice(-10) : digits;

        // Find or create the cleaner row.
        let { data: c } = await adminClient
          .from("cleaners")
          .select("*")
          .eq("phone", phoneShort)
          .maybeSingle();
        if (!c) {
          const { data: created, error: createErr } = await adminClient
            .from("cleaners")
            .insert({
              first_name: body.firstName || "Cleaner",
              last_name: body.lastName || "",
              email: body.email || `${phoneShort}@pending.novara`,
              phone: phoneShort,
              status: "pending",
              approved: false,
              available_for_bookings: false,
              home_address: body.homeAddress || null,
              home_city: body.city || null,
              home_state: body.state || null,
              home_zip: body.zip || null,
            })
            .select()
            .maybeSingle();
          if (createErr) throw createErr;
          c = created;
        }

        // Generate code.
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        try {
          await adminClient
            .from("cleaner_verification_codes")
            .insert({
              cleaner_id: c.id,
              code,
              expires_at: expiresAt,
              consumed: false,
            });
        } catch (insErr) {
          console.warn("[bypass] verification-code insert failed (will still SMS)", insErr);
        }

        await adminClient.from("events").insert({
          event_type: "cleaner.bypass_code_sent",
          cleaner_id: c.id,
          source: "cleaner-admin-action",
          summary: `Admin sent onboarding-bypass code to ${c.first_name} ${c.last_name || ""}`,
          data: { phone: phoneE164, by: callerId },
        }).then(() => undefined).catch(() => undefined);

        // SMS the code via GHL.
        try {
          await adminClient.functions.invoke("send-ghl-sms", {
            body: {
              phone: phoneE164,
              email: c.email || undefined,
              firstName: c.first_name || undefined,
              message: `Novara Cleaning: Your activation code is ${code}. It expires in 10 minutes. (Admin onboarding bypass)`,
              type: "cleaner_bypass_otp",
            },
          });
        } catch (smsErr) {
          return json({ error: "sms send failed", detail: String((smsErr as Error).message) }, 502);
        }

        return json({ ok: true, cleanerId: c.id, phone: phoneE164, expiresAt });
      }

      case "bypass_onboarding_verify_code": {
        if (!cleanerId) return json({ error: "cleanerId required" }, 400);
        const code = String(body.code || "").trim();
        if (code.length < 4) return json({ error: "code required" }, 400);
        const { data: c } = await adminClient
          .from("cleaners").select("*").eq("id", cleanerId).maybeSingle();
        if (!c) return json({ error: "cleaner not found" }, 404);

        const { data: vc } = await adminClient
          .from("cleaner_verification_codes")
          .select("id, code, expires_at, consumed")
          .eq("cleaner_id", cleanerId)
          .eq("code", code)
          .eq("consumed", false)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!vc) return json({ error: "invalid code" }, 401);
        if (vc.expires_at && new Date(vc.expires_at).getTime() < Date.now()) {
          return json({ error: "code expired" }, 401);
        }

        await adminClient
          .from("cleaner_verification_codes")
          .update({ consumed: true, consumed_at: new Date().toISOString() })
          .eq("id", vc.id);

        const { data: updated, error: updErr } = await adminClient
          .from("cleaners")
          .update({
            status: "active",
            approved: true,
            phone_verified: true,
            onboarding_complete: true,
            available_for_bookings: true,
            activated_at: c.activated_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", cleanerId)
          .select()
          .maybeSingle();
        if (updErr) throw updErr;

        await adminClient.from("events").insert({
          event_type: "cleaner.bypass_activated",
          cleaner_id: cleanerId,
          source: "cleaner-admin-action",
          summary: `Cleaner ${c.first_name || ""} ${c.last_name || ""} activated via admin bypass`,
          data: { by: callerId },
        }).then(() => undefined).catch(() => undefined);

        adminClient.functions.invoke("sync-cleaner-to-ghl", { body: { cleanerId } })
          .catch((e: any) => console.warn("[cleaner-admin-action] GHL sync failed", e?.message || e));
        adminClient.functions.invoke("send-cleaner-lifecycle-email", {
          body: { cleanerId, lifecycle: "activated" },
        }).catch(() => undefined);

        return json({ ok: true, cleaner: updated });
      }

      // ─── ADVANCE PAY TIER ─────────────────────────────────────────────
      // Bump foundation → proven (35→40) or proven → elite (40→45).
      // Writing pay_tier alone is enough — the DB trigger syncs
      // pay_percentage. Historical jobs keep their snapshot %.
      // Emails the cleaner via send-cleaner-email (tier_promotion).
      case "advance_pay_tier": {
        const TIER_ORDER = ["foundation", "proven", "elite"] as const;
        const TIER_PCT: Record<string, number> = {
          foundation: 35,
          proven: 40,
          elite: 45,
        };
        const currentRaw = String(cleaner.pay_tier || "foundation").toLowerCase().trim();
        const currentTier = (TIER_ORDER as readonly string[]).includes(currentRaw)
          ? currentRaw
          : "foundation";
        const idx = TIER_ORDER.indexOf(currentTier as typeof TIER_ORDER[number]);
        if (idx < 0 || idx >= TIER_ORDER.length - 1) {
          return json({
            error: "Cleaner is already at the highest pay tier (Elite · 45%).",
            code: "ALREADY_MAX_TIER",
            payTier: currentTier,
            payPercentage: TIER_PCT[currentTier] ?? Number(cleaner.pay_percentage) || 45,
          }, 409);
        }
        const nextTier = TIER_ORDER[idx + 1];
        const prevPct = TIER_PCT[currentTier] ?? Number(cleaner.pay_percentage) || 35;
        const nextPct = TIER_PCT[nextTier];
        const note = String(body.note || body.reason || "").trim() || null;

        const { data: updated, error: upErr } = await adminClient
          .from("cleaners")
          .update({
            pay_tier: nextTier,
            // Trigger also sets this; writing both keeps the response
            // correct even if the trigger is temporarily missing.
            pay_percentage: nextPct,
            updated_at: new Date().toISOString(),
          })
          .eq("id", cleanerId)
          .select()
          .maybeSingle();
        if (upErr) throw upErr;

        await adminClient.from("events").insert({
          event_type: "cleaner.pay_tier_advanced",
          cleaner_id: cleanerId,
          source: "cleaner-admin-action",
          summary: `Pay tier: ${currentTier} (${prevPct}%) → ${nextTier} (${nextPct}%) for ${cleaner.first_name || ""} ${cleaner.last_name || ""}`,
          data: {
            from_tier: currentTier,
            to_tier: nextTier,
            from_percentage: prevPct,
            to_percentage: nextPct,
            note,
            by: callerId,
          },
        }).then(() => undefined, () => undefined);

        let emailSent = false;
        const email = String(cleaner.email || "").trim();
        if (email && !email.endsWith("@pending.novara")) {
          try {
            const { error: mailErr } = await adminClient.functions.invoke("send-cleaner-email", {
              body: {
                type: "tier_promotion",
                email,
                data: {
                  firstName: cleaner.first_name || "",
                  previousTier: currentTier,
                  newTier: nextTier,
                  previousPercentage: prevPct,
                  newPercentage: nextPct,
                  dashboardUrl: "https://contractor.novaracleaning.com/cleaner",
                },
              },
            });
            emailSent = !mailErr;
            if (mailErr) {
              console.warn("[cleaner-admin-action] tier promotion email failed", mailErr);
            }
          } catch (mailCatch) {
            console.warn(
              "[cleaner-admin-action] tier promotion email failed",
              mailCatch instanceof Error ? mailCatch.message : String(mailCatch),
            );
          }
        }

        adminClient.functions.invoke("sync-cleaner-to-ghl", { body: { cleanerId } })
          .catch((e: any) => console.warn("[cleaner-admin-action] GHL sync failed", e?.message || e));

        return json({
          ok: true,
          cleaner: updated,
          fromTier: currentTier,
          toTier: nextTier,
          fromPercentage: prevPct,
          toPercentage: nextPct,
          emailSent,
        });
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

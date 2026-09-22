// ─── terminate-cleaner ──────────────────────────────────────────────────────
//
// Two admin actions, plus a preview and a letter resend:
//   preview    — abandonment count, W-9, YTD (nothing is written)
//   terminate  — company-initiated. Basis is Section 5.2, 5.3, or 6.4.
//   resign     — contractor-initiated. No disciplinary reason.
//   resend_letter — resends the stored notice, or the matching template.
//
// Notices come from app_settings.contractor_departure_notices when that
// override still passes the wording rules. The specific reason and the
// internal note are never interpolated. No 1099 document is generated.
//
// Cleaner accountability removal does not call this function. It still
// uses its own email and the shared closure SMS.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendSms } from "../_shared/sms.ts";
import { prepareDepartureTax } from "../_shared/departure-tax.ts";
import {
  CONTRACTOR_LETTER_CC,
  CONTRACTOR_OPS_DISPLAY_NAME,
  CONTRACTOR_OPS_FROM,
  CONTRACTOR_OPS_REPLY_TO,
  CONTRACTOR_SIGNER_LINE,
  DEFAULT_NOTICES,
  abandonmentInstancesInWindow,
  engagementAlreadyEnded,
  forCauseGroundLabel,
  formatEffectiveDate,
  mergeNoticeTemplate,
  noticeWordingProblems,
  renderDepartureNotice,
  validateTerminationSelection,
  type NoticeKind,
  type NoticeTemplate,
} from "../_shared/engagement-end.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}

const REHIRE_STATUSES = new Set(["rehireable", "no_rehire", "under_review", "blacklist"]);
const REHIRE_LABELS: Record<string, string> = {
  rehireable: "Eligible for rehire",
  no_rehire: "Not eligible for rehire",
  under_review: "Rehire eligibility under review",
  blacklist: "Blacklisted — do not hire",
};

// deno-lint-ignore no-explicit-any
async function ensureAdminOrVa(admin: any, req: Request): Promise<string> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) throw new Error("Not signed in.");
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  if (!(roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role))) {
    throw new Error("Admins or VAs only.");
  }
  return u.user.id;
}

function isServiceRole(req: Request): boolean {
  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (serviceKey && (bearer === serviceKey || authHeader === serviceKey)) return true;
  if (bearer.split(".").length === 3) {
    try {
      const payload = JSON.parse(atob(bearer.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return payload?.role === "service_role";
    } catch { /* ignore */ }
  }
  return false;
}

// deno-lint-ignore no-explicit-any
async function releaseFutureAssignments(admin: any, cleanerId: string, callerId: string, reason: string) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: open } = await admin
    .from("job_assignments").select("id, job_id, status")
    .eq("cleaner_id", cleanerId)
    .in("status", ["Offered", "Accepted", "Confirmed"]);
  if (!open || open.length === 0) return 0;
  const jobIds = open.map((a: { job_id: string }) => a.job_id);
  const { data: futureJobs } = await admin
    .from("bookings").select("job_id").in("job_id", jobIds).gte("service_date", today);
  const futureSet = new Set((futureJobs || []).map((j: { job_id: string }) => j.job_id));
  const targets = open.filter((a: { job_id: string }) => futureSet.has(a.job_id));
  if (targets.length === 0) return 0;
  await admin.from("job_assignments").update({ status: "Needs Reassignment" })
    .in("id", targets.map((t: { id: string }) => t.id));
  for (const t of targets) {
    await admin.from("job_status_history").insert({
      job_id: t.job_id, from_status: t.status, to_status: "Needs Reassignment",
      changed_by: callerId, metadata: { reason, source: "terminate-cleaner", cleaner_id: cleanerId },
    }).then(() => undefined, () => undefined);
  }
  return targets.length;
}

// deno-lint-ignore no-explicit-any
async function loadAbandonment(admin: any, cleanerId: string) {
  const flags = await admin
    .from("cleaner_flags")
    .select("id, job_id, created_at, issue_type")
    .eq("cleaner_id", cleanerId)
    .in("issue_type", ["no_show", "job_abandonment", "abandonment"]);
  if (flags.error) throw new Error(flags.error.message || "Could not read abandonment flags");
  const qc = await admin
    .from("qc_issues")
    .select("id, job_id, created_at, issue_type")
    .eq("cleaner_id", cleanerId)
    .eq("issue_type", "no_show");
  if (qc.error) throw new Error(qc.error.message || "Could not read no-show cases");
  return abandonmentInstancesInWindow([...(flags.data || []), ...(qc.data || [])]);
}

// deno-lint-ignore no-explicit-any
async function loadNotice(admin: any, kind: NoticeKind): Promise<NoticeTemplate> {
  const { data, error } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "contractor_departure_notices")
    .maybeSingle();
  if (error) throw new Error(error.message || "Could not read departure notices");
  const override = data?.value && typeof data.value === "object" ? data.value[kind] : null;
  return mergeNoticeTemplate(DEFAULT_NOTICES[kind], override);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function letterHtml(bodyText: string): string {
  const paragraphs = escapeHtml(bodyText).split(/\n{2,}/).map((part) =>
    `<p style="margin:0 0 14px">${part.replace(/\n/g, "<br>")}</p>`
  ).join("");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:28px;color:#0f172a;line-height:1.6">
    <div style="border-bottom:2px solid #5C0FFE;padding-bottom:12px;margin-bottom:20px">
      <span style="font-weight:800;font-size:18px;color:#5C0FFE">NovaraCleaning</span>
      <span style="float:right;color:#64748b;font-size:12px">${escapeHtml(CONTRACTOR_OPS_DISPLAY_NAME)}</span>
    </div>
    ${paragraphs}
  </div>`;
}

async function sendNoticeEmail(opts: {
  toEmail: string;
  subject: string;
  body: string;
}): Promise<{ letterSent: boolean; letterError: string | null }> {
  try {
    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
    const { error: sendErr } = await resend.emails.send({
      from: CONTRACTOR_OPS_FROM,
      to: [opts.toEmail],
      cc: [...CONTRACTOR_LETTER_CC],
      reply_to: CONTRACTOR_OPS_REPLY_TO,
      subject: opts.subject,
      html: letterHtml(opts.body),
    });
    if (sendErr) {
      return {
        letterSent: false,
        letterError: (sendErr as { message?: string }).message || String(sendErr),
      };
    }
    return { letterSent: true, letterError: null };
  } catch (e) {
    return { letterSent: false, letterError: e instanceof Error ? e.message : String(e) };
  }
}

function noticeForCleaner(template: NoticeTemplate, cleaner: { first_name?: string | null }, effectiveDate: string) {
  const firstName = String(cleaner.first_name || "").trim() || "there";
  return renderDepartureNotice(template, {
    firstName,
    effectiveDate: formatEffectiveDate(effectiveDate),
    signoff: CONTRACTOR_SIGNER_LINE,
    operationsEmail: CONTRACTOR_OPS_REPLY_TO,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").toLowerCase();
    if (!action) {
      return json({
        error: "action required: preview, terminate, resign, or resend_letter",
        code: "ACTION_REQUIRED",
      }, 400);
    }

    let callerId: string;
    if (action === "resend_letter" && isServiceRole(req)) {
      callerId = "service";
    } else {
      try {
        callerId = await ensureAdminOrVa(admin, req);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 403);
      }
    }

    if (action === "resend_letter") {
      const cleanerId = String(body?.cleanerId || "");
      if (!cleanerId) return json({ error: "cleanerId required" }, 400);
      const { data: cleaner } = await admin.from("cleaners").select("*").eq("id", cleanerId).maybeSingle();
      if (!cleaner) return json({ error: "Cleaner not found" }, 404);
      const { data: term } = await admin
        .from("cleaner_terminations")
        .select("*")
        .eq("cleaner_id", cleanerId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!term) return json({ error: "No engagement-end record found for this contractor." }, 404);

      const toEmail = (cleaner.email || term.letter_to || "").trim();
      if (!toEmail || toEmail.endsWith("@pending.novara")) {
        return json({ error: "No valid contractor email on file — letter not sent." }, 400);
      }
      const kind: NoticeKind = String(term.action || "") === "resigned" ? "resignation" : "termination";
      const effectiveDate = String(term.effective_date || new Date().toISOString().slice(0, 10));
      const template = await loadNotice(admin, kind);
      const rendered = term.email_subject && term.email_body
        ? {
          subject: String(term.email_subject),
          body: String(term.email_body),
          sms: String(term.sms_body || ""),
        }
        : noticeForCleaner(template, cleaner, effectiveDate);
      const problems = noticeWordingProblems(kind, rendered, { internalNote: term.notes ? String(term.notes) : null });
      if (problems.length) {
        return json({
          error: "Departure notice failed the wording check, so it was not sent.",
          code: "TEMPLATE_INVALID",
          problems,
        }, 409);
      }
      const { letterSent, letterError } = await sendNoticeEmail({
        toEmail,
        subject: rendered.subject,
        body: rendered.body,
      });
      if (letterSent) {
        await admin.from("cleaners").update({ termination_letter_sent_at: new Date().toISOString() }).eq("id", cleanerId)
          .then(() => undefined, () => undefined);
        await admin.from("cleaner_terminations").update({
          letter_to: toEmail,
          letter_cc: CONTRACTOR_LETTER_CC.join(", "),
          letter_sent: true,
          letter_error: null,
          email_subject: rendered.subject,
          email_body: rendered.body,
        }).eq("id", term.id).then(() => undefined, () => undefined);
        const name = `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim() || "Contractor";
        await admin.from("events").insert({
          event_type: "cleaner.termination_letter_resent",
          cleaner_id: cleanerId,
          source: "terminate-cleaner",
          summary: `${kind === "resignation" ? "Resignation" : "Termination"} notice resent to ${name}`,
          data: { by: callerId, letter_to: toEmail, letter_cc: CONTRACTOR_LETTER_CC, termination_id: term.id, action: kind },
        }).then(() => undefined, () => undefined);
      }
      return json({ ok: letterSent, letterSent, letterError, letterCc: CONTRACTOR_LETTER_CC, to: toEmail });
    }

    const cleanerId = String(body?.cleanerId || "");
    if (!cleanerId) return json({ error: "cleanerId required" }, 400);
    const { data: cleaner } = await admin.from("cleaners").select("*").eq("id", cleanerId).maybeSingle();
    if (!cleaner) return json({ error: "Cleaner not found" }, 404);

    if (action === "preview") {
      const abandonment = await loadAbandonment(admin, cleanerId);
      const year = new Date().getUTCFullYear();
      const tax = await prepareDepartureTax(admin, cleaner, year);
      return json({
        ok: true,
        status: cleaner.status,
        engagementEndAction: cleaner.engagement_end_action,
        alreadyEnded: engagementAlreadyEnded(cleaner),
        abandonment,
        w9Status: tax.w9Status,
        w9Followup: tax.w9Followup,
        ytd: { cents: tax.cents, source: tax.source, year: tax.year },
      });
    }

    if (action !== "terminate" && action !== "resign") {
      return json({ error: "action must be preview, terminate, resign, or resend_letter" }, 400);
    }

    if (body?.reason && !body?.basis && action === "terminate") {
      return json({
        error: "Pass basis (no_cause, for_cause, or job_abandonment). The old reason list is retired.",
        code: "BASIS_REQUIRED",
      }, 400);
    }

    if (engagementAlreadyEnded(cleaner)) {
      return json({
        error: "This engagement is already ended. Resignation does not relabel a termination, and a second end action is blocked.",
        code: "ENGAGEMENT_ALREADY_ENDED",
        status: cleaner.status,
        engagementEndAction: cleaner.engagement_end_action,
      }, 409);
    }

    const notes = body?.notes ? String(body.notes).slice(0, 2000) : null;
    const effectiveDate = (body?.effectiveDate && String(body.effectiveDate)) || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      return json({ error: "effectiveDate must be YYYY-MM-DD" }, 400);
    }
    const rehireStatus = String(body?.rehireStatus || (action === "resign" ? "rehireable" : "no_rehire"));
    if (!REHIRE_STATUSES.has(rehireStatus)) {
      return json({ error: `rehireStatus must be one of: ${[...REHIRE_STATUSES].join(", ")}` }, 400);
    }

    const kind: NoticeKind = action === "resign" ? "resignation" : "termination";
    let basis: string | null = null;
    let ground: string | null = null;
    let section: string | null = null;
    let reasonCode = "resignation";
    let reasonLabel = "Resignation";
    const forbiddenPhrases: string[] = [];

    if (action === "terminate") {
      const abandonment = await loadAbandonment(admin, cleanerId);
      const selection = validateTerminationSelection({
        basis: String(body?.basis || ""),
        ground: body?.ground ? String(body.ground) : null,
        abandonmentAllowed: abandonment.allowed,
      });
      if (!selection.ok) {
        const status = selection.code === "ABANDONMENT_THRESHOLD" ? 409 : 400;
        return json({ error: selection.error, code: selection.code, abandonment }, status);
      }
      basis = selection.basis;
      ground = selection.ground;
      section = selection.section;
      reasonCode = ground ? `${basis}:${ground}` : basis;
      const groundLabel = ground ? forCauseGroundLabel(ground) : null;
      reasonLabel = groundLabel
        ? `For-cause (Section ${section}): ${groundLabel}`
        : basis === "job_abandonment"
          ? `Job abandonment (Section ${section})`
          : `No-cause (Section ${section})`;
      if (groundLabel) forbiddenPhrases.push(groundLabel);
      if (basis === "job_abandonment") forbiddenPhrases.push("Job abandonment");
    }

    const template = await loadNotice(admin, kind);
    const rendered = noticeForCleaner(template, cleaner, effectiveDate);
    const problems = noticeWordingProblems(kind, rendered, { internalNote: notes, forbiddenPhrases });
    if (problems.length) {
      return json({
        error: "Departure notice failed the wording check, so nothing was sent and the engagement was not ended.",
        code: "TEMPLATE_INVALID",
        problems,
      }, 409);
    }

    const year = Number(effectiveDate.slice(0, 4));
    const tax = await prepareDepartureTax(admin, cleaner, year);
    const nowIso = new Date().toISOString();
    const name = `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim() || "Contractor";
    const endedAction = action === "resign" ? "resigned" : "terminated";

    const patch: Record<string, unknown> = {
      status: endedAction,
      engagement_end_action: endedAction,
      engagement_ended_at: nowIso,
      termination_basis: basis,
      termination_ground: ground,
      termination_section: section,
      available_for_bookings: false,
      approved: false,
      deactivated_at: cleaner.deactivated_at ?? nowIso,
      terminated_by: callerId === "service" ? null : callerId,
      rehire_status: rehireStatus,
      rehire_notes: notes,
      ytd_earnings_cents_locked: tax.cents,
      ytd_earnings_year: tax.year,
      ytd_earnings_locked_at: nowIso,
      ytd_earnings_source: tax.source,
      nec_1099_include: true,
      nec_1099_batch_year: tax.year,
      w9_status: tax.w9Status,
      w9_followup_required: tax.w9Followup,
      w9_followup_flagged_at: tax.w9Followup ? nowIso : null,
      updated_at: nowIso,
    };
    if (action === "terminate") {
      patch.terminated_at = nowIso;
      patch.termination_reason = reasonCode;
      patch.termination_effective_date = effectiveDate;
      patch.deactivation_reason = cleaner.deactivation_reason ?? reasonCode;
    } else {
      patch.termination_reason = null;
      patch.terminated_at = null;
      patch.termination_effective_date = null;
    }

    const { data: updated, error: upErr } = await admin
      .from("cleaners")
      .update(patch)
      .eq("id", cleanerId)
      .select()
      .maybeSingle();
    if (upErr) throw upErr;

    const reassigned = await releaseFutureAssignments(
      admin,
      cleanerId,
      callerId,
      action === "resign" ? "cleaner_resigned" : `cleaner_terminated:${reasonCode}`,
    );

    let letterSent = false;
    let letterError: string | null = null;
    const toEmail = String(cleaner.email || "").trim();
    if (toEmail && !toEmail.endsWith("@pending.novara")) {
      const sent = await sendNoticeEmail({ toEmail, subject: rendered.subject, body: rendered.body });
      letterSent = sent.letterSent;
      letterError = sent.letterError;
    } else {
      letterError = "No valid contractor email on file — letter not sent.";
    }
    if (letterSent) {
      await admin.from("cleaners").update({ termination_letter_sent_at: nowIso }).eq("id", cleanerId)
        .then(() => undefined, () => undefined);
    }

    let smsSent = false;
    try {
      smsSent = await sendSms(admin, {
        toPhone: cleaner.phone,
        message: rendered.sms,
        type: "confirmation",
      });
    } catch (err) {
      console.warn("[terminate-cleaner] sms failed", err instanceof Error ? err.message : String(err));
    }

    await admin.from("cleaner_terminations").insert({
      cleaner_id: cleanerId,
      action: endedAction,
      reason: reasonCode,
      reason_label: reasonLabel,
      basis,
      ground,
      agreement_section: section,
      rehire_status: rehireStatus,
      notes,
      effective_date: effectiveDate,
      letter_to: toEmail || null,
      letter_cc: CONTRACTOR_LETTER_CC.join(", "),
      letter_sent: letterSent,
      letter_error: letterError,
      terminated_by: callerId === "service" ? null : callerId,
      sms_body: rendered.sms,
      email_subject: rendered.subject,
      email_body: rendered.body,
      ytd_earnings_cents: tax.cents,
      nec_1099_batch_year: tax.year,
      w9_status: tax.w9Status,
      w9_followup_required: tax.w9Followup,
    }).then(() => undefined, () => undefined);

    const eventType = action === "resign" ? "cleaner.resigned" : "cleaner.terminated";
    const summary = action === "resign"
      ? `Cleaner ${name} resigned · ${REHIRE_LABELS[rehireStatus]}`
      : `Cleaner ${name} terminated — ${reasonLabel} · ${REHIRE_LABELS[rehireStatus]}`;
    await admin.from("events").insert({
      event_type: eventType,
      cleaner_id: cleanerId,
      source: "terminate-cleaner",
      summary,
      data: {
        action: endedAction,
        basis,
        ground,
        section,
        rehireStatus,
        by: callerId,
        reassigned_jobs: reassigned,
        letter_sent: letterSent,
        letter_cc: CONTRACTOR_LETTER_CC,
        sms_sent: smsSent,
        ytd_earnings_cents: tax.cents,
        ytd_source: tax.source,
        nec_1099_batch_year: tax.year,
        nec_1099_sent: false,
        w9_status: tax.w9Status,
      },
    }).then(() => undefined, () => undefined);

    if (tax.w9Followup) {
      await admin.from("events").insert({
        event_type: "cleaner.w9_followup_required",
        cleaner_id: cleanerId,
        source: "terminate-cleaner",
        summary: `W-9 follow-up required for ${name} (${tax.w9Status}) before the ${tax.year} 1099 batch`,
        data: { w9_status: tax.w9Status, batch_year: tax.year, by: callerId },
      }).then(() => undefined, () => undefined);
    }

    admin.functions.invoke("sync-cleaner-to-ghl", { body: { cleanerId } })
      .catch((e: unknown) => console.warn("[terminate-cleaner] GHL sync failed", e));

    return json({
      ok: true,
      action: endedAction,
      cleaner: updated,
      reassignedJobs: reassigned,
      letterSent,
      letterError,
      smsSent,
      rehireStatus,
      ytd: { cents: tax.cents, source: tax.source, year: tax.year },
      nec1099Include: true,
      nec1099Sent: false,
      w9Status: tax.w9Status,
      w9Followup: tax.w9Followup,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[terminate-cleaner]", msg);
    return json({ error: msg }, 500);
  }
});

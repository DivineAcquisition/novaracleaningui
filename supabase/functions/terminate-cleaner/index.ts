// ─── terminate-cleaner ──────────────────────────────────────────────────────
//
// Complete contractor off-boarding in one call:
//   1. flips the cleaner to status='terminated' (no portal / no payouts / not
//      bookable) and records the reason + effective date + who did it
//   2. stamps an internal rehire label (rehireable / no_rehire / under_review /
//      blacklist) so the directory knows if they're hireable again
//   3. releases their open future jobs for reassignment
//   4. emails a termination letter to the contractor, CC'ing HR and
//      contact@novaracleaning.com (reply-to HR). If they were blacklisted,
//      the letter says so.
//   5. writes a cleaner_terminations audit row + an events row
//
// Admin/VA gated.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}

const HR_EMAIL = "hr@novaracleaning.com";
const CONTACT_EMAIL = "contact@novaracleaning.com";
const LETTER_CC = [HR_EMAIL, CONTACT_EMAIL];

// The 7 core reasons a contractor leaves the role (+ "other").
const REASON_LABELS: Record<string, string> = {
  voluntary_resignation: "Voluntary resignation",
  job_abandonment: "Job abandonment / no contact",
  attendance: "Persistent no-shows or lateness",
  performance: "Cleaning quality / performance",
  misconduct: "Misconduct or unprofessional conduct",
  policy_violation: "Policy or contract violation",
  customer_complaints: "Repeated customer complaints",
  other: "Other",
};

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

function fmtDate(d: string): string {
  try { return new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }); }
  catch { return d; }
}

function letterHtml(opts: {
  name: string; reasonLabel: string; effectiveDate: string; blacklisted: boolean; notes?: string | null;
}): string {
  const { name, reasonLabel, effectiveDate, blacklisted, notes } = opts;
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:28px;color:#0f172a;line-height:1.6">
    <div style="border-bottom:2px solid #5C0FFE;padding-bottom:12px;margin-bottom:20px">
      <span style="font-weight:800;font-size:18px;color:#5C0FFE">Novara Cleaning</span>
      <span style="float:right;color:#64748b;font-size:12px">Human Resources</span>
    </div>
    <p style="margin:0 0 4px;color:#64748b;font-size:13px">${fmtDate(new Date().toISOString().slice(0,10))}</p>
    <h2 style="margin:0 0 16px;font-size:18px">Notice of Termination of Contractor Engagement</h2>
    <p style="margin:0 0 14px">Dear ${name},</p>
    <p style="margin:0 0 14px">
      This letter confirms that your independent-contractor engagement with Novara Cleaning is
      terminated effective <strong>${fmtDate(effectiveDate)}</strong>.
    </p>
    <p style="margin:0 0 14px">
      <strong>Reason:</strong> ${reasonLabel}.
    </p>
    ${notes ? `<p style="margin:0 0 14px;color:#334155"><strong>Additional notes:</strong> ${notes}</p>` : ""}
    <p style="margin:0 0 14px">
      Effective on the date above, your access to the contractor portal, job offers, and payouts will be
      discontinued, and any upcoming jobs assigned to you have been reassigned. Any payouts already earned
      for completed work will be settled per our standard schedule.
    </p>
    ${blacklisted ? `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px;margin:0 0 14px">
      <p style="margin:0;color:#991b1b"><strong>Do-not-hire notice:</strong> Following this termination, you have been
      placed on Novara Cleaning's do-not-hire list and will not be eligible for future engagement with the company.</p>
    </div>` : ""}
    <p style="margin:0 0 14px">
      Please return any company materials in your possession and direct any questions to
      <a href="mailto:${HR_EMAIL}" style="color:#5C0FFE">${HR_EMAIL}</a>.
    </p>
    <p style="margin:18px 0 4px">Sincerely,</p>
    <p style="margin:0;font-weight:600">Novara Cleaning — Human Resources</p>
    <p style="margin:2px 0 0;color:#64748b;font-size:13px">${HR_EMAIL}</p>
  </div>`;
}

async function sendTerminationLetter(opts: {
  toEmail: string;
  name: string;
  reasonLabel: string;
  effectiveDate: string;
  blacklisted: boolean;
  notes?: string | null;
}): Promise<{ letterSent: boolean; letterError: string | null }> {
  try {
    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
    const { error: sendErr } = await resend.emails.send({
      from: "Novara Cleaning HR <hr@novaracleaning.com>",
      to: [opts.toEmail],
      cc: LETTER_CC,
      reply_to: HR_EMAIL,
      subject: "Notice of Termination — Novara Cleaning",
      html: letterHtml({
        name: opts.name,
        reasonLabel: opts.reasonLabel,
        effectiveDate: opts.effectiveDate,
        blacklisted: opts.blacklisted,
        notes: opts.notes,
      }),
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "terminate").toLowerCase();

    // Service-role may resend letters (ops); terminate still requires admin/VA.
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
    let isService = !!serviceKey && (bearer === serviceKey || authHeader === serviceKey);
    if (!isService && bearer.split(".").length === 3) {
      try {
        const payload = JSON.parse(atob(bearer.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        isService = payload?.role === "service_role";
      } catch { /* ignore */ }
    }

    let callerId: string;
    if (action === "resend_letter" && isService) {
      callerId = "service";
    } else {
      try {
        callerId = await ensureAdminOrVa(admin, req);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 403);
      }
    }

    // Resend an existing termination letter (HR + contact cc'd, reply-to HR).
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
      if (!term) return json({ error: "No termination record found for this cleaner." }, 404);

      const toEmail = (cleaner.email || term.letter_to || "").trim();
      if (!toEmail || toEmail.endsWith("@pending.novara")) {
        return json({ error: "No valid contractor email on file — letter not sent." }, 400);
      }
      const name = `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim() || "Contractor";
      const reasonLabel = String(term.reason_label || REASON_LABELS[String(term.reason)] || term.reason);
      const effectiveDate = String(term.effective_date || new Date().toISOString().slice(0, 10));
      const blacklisted = String(term.rehire_status || "") === "blacklist";
      const notes = term.notes ? String(term.notes) : null;

      const { letterSent, letterError } = await sendTerminationLetter({
        toEmail, name, reasonLabel, effectiveDate, blacklisted, notes,
      });

      if (letterSent) {
        await admin.from("cleaners").update({ termination_letter_sent_at: new Date().toISOString() }).eq("id", cleanerId)
          .then(() => undefined, () => undefined);
        await admin.from("cleaner_terminations").update({
          letter_to: toEmail,
          letter_cc: LETTER_CC.join(", "),
          letter_sent: true,
          letter_error: null,
        }).eq("id", term.id).then(() => undefined, () => undefined);
        await admin.from("events").insert({
          event_type: "cleaner.termination_letter_resent",
          cleaner_id: cleanerId,
          source: "terminate-cleaner",
          summary: `Termination letter resent to ${name} (cc ${LETTER_CC.join(", ")})`,
          data: { by: callerId, letter_to: toEmail, letter_cc: LETTER_CC, termination_id: term.id },
        }).then(() => undefined, () => undefined);
      }

      return json({ ok: letterSent, letterSent, letterError, letterCc: LETTER_CC, to: toEmail });
    }

    const cleanerId = String(body?.cleanerId || "");
    const reason = String(body?.reason || "");
    const rehireStatus = String(body?.rehireStatus || "no_rehire");
    const notes = body?.notes ? String(body.notes).slice(0, 2000) : null;
    const sendLetter = body?.sendLetter !== false; // default: send
    const effectiveDate = (body?.effectiveDate && String(body.effectiveDate)) || new Date().toISOString().slice(0, 10);

    if (!cleanerId) return json({ error: "cleanerId required" }, 400);
    if (!REASON_LABELS[reason]) return json({ error: `reason must be one of: ${Object.keys(REASON_LABELS).join(", ")}` }, 400);
    if (!REHIRE_STATUSES.has(rehireStatus)) return json({ error: `rehireStatus must be one of: ${[...REHIRE_STATUSES].join(", ")}` }, 400);
    if (reason === "other" && !notes) return json({ error: "Notes are required when reason is 'other'." }, 400);

    const { data: cleaner } = await admin.from("cleaners").select("*").eq("id", cleanerId).maybeSingle();
    if (!cleaner) return json({ error: "Cleaner not found" }, 404);

    const reasonLabel = REASON_LABELS[reason];
    const name = `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim() || "Contractor";
    const blacklisted = rehireStatus === "blacklist";

    // 1. Flip the cleaner to terminated + stamp the rehire label.
    const { data: updated, error: upErr } = await admin
      .from("cleaners")
      .update({
        status: "terminated",
        terminated_at: new Date().toISOString(),
        termination_reason: reason,
        termination_effective_date: effectiveDate,
        terminated_by: callerId,
        rehire_status: rehireStatus,
        rehire_notes: notes,
        available_for_bookings: false,
        approved: false,
        deactivated_at: cleaner.deactivated_at ?? new Date().toISOString(),
        deactivation_reason: cleaner.deactivation_reason ?? reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cleanerId)
      .select()
      .maybeSingle();
    if (upErr) throw upErr;

    // 2. Release open future jobs.
    const reassigned = await releaseFutureAssignments(admin, cleanerId, callerId, `cleaner_terminated:${reason}`);

    // 3. Termination letter — to the contractor; HR + contact cc'd; reply-to HR.
    let letterSent = false;
    let letterError: string | null = null;
    const toEmail = (cleaner.email || "").trim();
    if (sendLetter && toEmail && !toEmail.endsWith("@pending.novara")) {
      const sent = await sendTerminationLetter({
        toEmail, name, reasonLabel, effectiveDate, blacklisted, notes,
      });
      letterSent = sent.letterSent;
      letterError = sent.letterError;
    } else if (sendLetter) {
      letterError = "No valid contractor email on file — letter not sent.";
    }

    if (letterSent) {
      await admin.from("cleaners").update({ termination_letter_sent_at: new Date().toISOString() }).eq("id", cleanerId)
        .then(() => undefined, () => undefined);
    }

    // 4. Audit row + event.
    await admin.from("cleaner_terminations").insert({
      cleaner_id: cleanerId, reason, reason_label: reasonLabel, rehire_status: rehireStatus,
      notes, effective_date: effectiveDate, letter_to: toEmail || null,
      letter_cc: LETTER_CC.join(", "),
      letter_sent: letterSent, letter_error: letterError, terminated_by: callerId,
    }).then(() => undefined, () => undefined);

    await admin.from("events").insert({
      event_type: "cleaner.terminated", cleaner_id: cleanerId, source: "terminate-cleaner",
      summary: `Cleaner ${name} terminated — ${reasonLabel} · ${REHIRE_LABELS[rehireStatus]}`,
      data: {
        reason, reasonLabel, rehireStatus, blacklisted, by: callerId,
        reassigned_jobs: reassigned, letter_sent: letterSent, letter_cc: LETTER_CC,
      },
    }).then(() => undefined, () => undefined);

    // 5. Mirror the off-boarding into GHL (tags), best-effort.
    admin.functions.invoke("sync-cleaner-to-ghl", { body: { cleanerId } })
      .catch((e: unknown) => console.warn("[terminate-cleaner] GHL sync failed", e));

    return json({
      ok: true,
      cleaner: updated,
      reassignedJobs: reassigned,
      letterSent,
      letterError,
      rehireStatus,
      blacklisted,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[terminate-cleaner]", msg);
    return json({ error: msg }, 500);
  }
});

// cleaner-accountability
//
// The formal escalation ladder for contractor reliability/quality failures:
//   coaching note → strike → suspension (new assignments only) → removal.
//
// Every action:
//   * requires a linked QC case OR a documented reason, plus an admin note
//   * is logged permanently (who / when / what / why) — never hard-deleted
//   * sends a formal email (admin-editable before send) that is archived
//     verbatim on the action row
//   * NEVER touches pay for completed work. Suspension only blocks NEW
//     assignments (cleaners.status='suspended' — every dispatch path already
//     filters status='active'); removal reuses terminated offboarding and
//     payouts owed still settle on the normal cycle. There is deliberately
//     no code path here that can dock a payout or bill a cleaner.
//
// Proportionality: suspension normally requires 2+ active strikes and
// removal 3+; going straight to either requires severeCause=true with the
// documented reason (recorded on the action).
//
// Actions (admin/VA JWT unless noted):
//   { action:'list', cleanerId }
//   { action:'preview_email', cleanerId, actionType, qcIssueId?, reason?,
//     suspensionStart?, suspensionEnd?, existingJobsHandling? }
//   { action:'create', cleanerId, actionType, qcIssueId?, reason?, note,
//     severeCause?, suspensionStart?, suspensionEnd?, existingJobsHandling?,
//     sendEmail?, emailSubject?, emailBody?, rehireStatus? }
//   { action:'lift_suspension', actionId, note }
//   { action:'dashboard' }
//   { action:'get_settings' } / { action:'set_settings', strikeExpiryMonths }
//   { action:'sweep' } — pg_cron (service-role bearer): auto-restores
//     eligibility when a suspension window ends and ages out expired strikes.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}
const log = (s: string, d?: unknown) =>
  console.log(`[cleaner-accountability] ${s}${d === undefined ? "" : " " + JSON.stringify(d)}`);

// deno-lint-ignore no-explicit-any
type SB = any;

const ACTION_TYPES = ["coaching_note", "strike", "suspension", "removal"] as const;
type ActionType = (typeof ACTION_TYPES)[number];

const FROM_ADDRESS = "NovaraCleaning Operations <hello@novaracleaning.com>";
const REPLY_TO = "hello@novaracleaning.com";

const ISSUE_TYPE_LABELS: Record<string, string> = {
  complaint: "a customer complaint",
  reclean: "a required re-clean",
  damage: "reported property damage",
  no_show: "a no-show",
  late: "a late arrival",
  quality_flag: "a quality flag",
  payment: "a payment issue",
  other: "an incident",
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  } catch { return String(iso); }
}

async function ensureAdminOrVa(admin: SB, jwt: string): Promise<{ id: string; name: string }> {
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const allowed = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
  if (!allowed) throw new Error("Admins or VAs only.");
  const name = String(
    u.user.user_metadata?.full_name || u.user.user_metadata?.name || u.user.email || "Team",
  );
  return { id: u.user.id, name };
}

// Same helper as cleaner-admin-action / terminate-cleaner: flag the
// cleaner's open FUTURE assignments for reassignment (never past work).
async function markFutureAssignmentsForReassignment(
  admin: SB, cleanerId: string, callerId: string, reason: string,
): Promise<number> {
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
      changed_by: callerId,
      metadata: { reason, source: "cleaner-accountability", cleaner_id: cleanerId },
    }).then(() => undefined, () => undefined);
  }
  return targets.length;
}

async function getSettings(admin: SB): Promise<{ strike_expiry_months: number }> {
  const { data } = await admin
    .from("app_settings").select("value").eq("key", "accountability_settings").maybeSingle();
  const months = Number(data?.value?.strike_expiry_months);
  return { strike_expiry_months: Number.isFinite(months) && months >= 0 ? months : 6 };
}

async function countActiveStrikes(admin: SB, cleanerId: string): Promise<number> {
  const { count } = await admin
    .from("cleaner_accountability_actions")
    .select("id", { count: "exact", head: true })
    .eq("cleaner_id", cleanerId)
    .eq("action_type", "strike")
    .eq("status", "active");
  return count ?? 0;
}

async function syncStrikeCount(admin: SB, cleanerId: string): Promise<number> {
  const n = await countActiveStrikes(admin, cleanerId);
  await admin.from("cleaners")
    .update({ active_strike_count: n, updated_at: new Date().toISOString() })
    .eq("id", cleanerId);
  return n;
}

// deno-lint-ignore no-explicit-any
function incidentSummaryFromIssue(issue: any): string {
  if (!issue) return "";
  const what = ISSUE_TYPE_LABELS[String(issue.issue_type)] || "an incident";
  const when = fmtDate(issue.created_at);
  const parts = [`${what} documented on ${when}`];
  if (issue.booking_ref) parts.push(`(job ${issue.booking_ref})`);
  let s = `${parts.join(" ")}: ${issue.title}`;
  if (issue.description) s += ` — ${String(issue.description).slice(0, 400)}`;
  return s;
}

// ─── Formal email templates (auto-filled; admin can edit before send) ────────

interface EmailCtx {
  firstName: string;
  incidentSummary: string;
  incidentDate: string;
  strikeNumber?: number;
  suspensionStart?: string;
  suspensionEnd?: string;
  existingJobsHandling?: string | null;
}

function buildEmailTemplate(actionType: ActionType, ctx: EmailCtx): { subject: string; body: string } {
  const name = ctx.firstName || "there";
  if (actionType === "strike") {
    return {
      subject: "Formal Reliability Notice - NovaraCleaning",
      body:
`${name},

This is a formal written notice regarding the incident on ${ctx.incidentDate}: ${ctx.incidentSummary}.

Reliability is core to how Novara operates and directly affects the work you receive. This notice is Strike ${ctx.strikeNumber ?? 1} on your record. Please understand the escalation policy: further reliability or quality failures may result in suspension from new job assignments, and continued issues may end our working relationship.

We value your work and want you to succeed here - consistent reliability is what earns priority for steady, higher-value jobs. If there were circumstances we should know about, reply to this email.

NovaraCleaning Operations`,
    };
  }
  if (actionType === "suspension") {
    const jobsLine = ctx.existingJobsHandling === "reassign"
      ? "Any existing accepted jobs on your schedule have been reassigned."
      : "Any existing accepted jobs on your schedule are kept and should be completed as planned.";
    return {
      subject: "Suspension from New Assignments - NovaraCleaning",
      body:
`${name},

Following ${ctx.incidentSummary}, you are suspended from receiving new job assignments from ${fmtDate(ctx.suspensionStart)} through ${fmtDate(ctx.suspensionEnd)}.

During this period you will not be offered new jobs. ${jobsLine} Pay for work already completed is unaffected and will be paid on the normal schedule.

This suspension reflects the escalation policy previously communicated. When the suspension ends, your assignment eligibility resumes; however, further issues may result in the end of our working relationship. If you wish to discuss this, reply to this email.

NovaraCleaning Operations`,
    };
  }
  if (actionType === "removal") {
    return {
      subject: "End of Contractor Engagement - NovaraCleaning",
      body:
`${name},

Effective ${fmtDate(new Date().toISOString())}, NovaraCleaning is ending our contractor engagement, following ${ctx.incidentSummary}.

Your portal access has been deactivated. All pay owed for verified completed work will be paid on the normal payout schedule. Please note that your agreement's post-engagement obligations (confidentiality, non-solicitation, and related covenants) remain in effect per its terms.

We wish you well going forward.

NovaraCleaning Operations`,
    };
  }
  // coaching_note
  return {
    subject: `Quick Note on ${ctx.incidentDate} - NovaraCleaning`,
    body:
`${name},

Following up on ${ctx.incidentSummary}. No formal action is being taken - this is a documented heads-up. Reliability and quality drive the work you're offered, and we want to keep sending good jobs your way. Let's keep it tight going forward.

NovaraCleaning Operations`,
  };
}

// Branded HTML wrapper around the (possibly admin-edited) plain-text body.
function emailHtml(bodyText: string): string {
  const paragraphs = bodyText
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:28px;color:#0f172a;line-height:1.6">
    <div style="border-bottom:2px solid #5C0FFE;padding-bottom:12px;margin-bottom:20px">
      <span style="font-weight:800;font-size:18px;color:#5C0FFE">Novara Cleaning</span>
      <span style="float:right;color:#64748b;font-size:12px">Operations</span>
    </div>
    <p style="margin:0 0 16px;color:#64748b;font-size:13px">${fmtDate(new Date().toISOString())}</p>
    ${paragraphs}
  </div>`;
}

async function sendFormalEmail(opts: {
  to: string; subject: string; body: string;
}): Promise<{ sent: boolean; error: string | null }> {
  try {
    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [opts.to],
      reply_to: REPLY_TO,
      subject: opts.subject,
      html: emailHtml(opts.body),
      text: opts.body,
    });
    if (error) return { sent: false, error: (error as { message?: string }).message || String(error) };
    return { sent: true, error: null };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// End of the suspension's last day, with slack for ET (restore sweep runs
// hourly, so eligibility resumes within the hour after the window closes).
function suspensionEndTimestamp(endDate: string): string {
  return new Date(new Date(`${endDate}T00:00:00Z`).getTime() + 29 * 3600_000).toISOString();
}

// ─── Sweep: auto-restore ended suspensions + age out expired strikes ─────────
async function runSweep(admin: SB): Promise<{ restored: number; expiredStrikes: number }> {
  const nowIso = new Date().toISOString();

  // 1. Suspensions whose window has closed → restore assignment eligibility.
  const { data: dueCleaners } = await admin
    .from("cleaners")
    .select("id, first_name, last_name, status, suspended_until")
    .eq("status", "suspended")
    .lt("suspended_until", nowIso);
  let restored = 0;
  for (const c of dueCleaners || []) {
    await admin.from("cleaners").update({
      status: "active",
      available_for_bookings: true,
      suspended_at: null,
      suspended_until: null,
      suspension_reason: null,
      updated_at: nowIso,
    }).eq("id", c.id).eq("status", "suspended");
    await admin.from("cleaner_accountability_actions").update({
      status: "completed", completed_at: nowIso, updated_at: nowIso,
    }).eq("cleaner_id", c.id).eq("action_type", "suspension").eq("status", "active");
    await admin.from("events").insert({
      event_type: "cleaner.suspension_ended",
      cleaner_id: c.id,
      source: "cleaner-accountability",
      summary: `Suspension ended for ${c.first_name || ""} ${c.last_name || ""} — assignment eligibility restored automatically`,
      data: { suspended_until: c.suspended_until },
    }).then(() => undefined, () => undefined);
    restored++;
  }

  // Suspension rows left 'active' for cleaners who are no longer suspended
  // (e.g. removed or reactivated mid-suspension) — close them once the
  // window has passed so the ledger stays truthful.
  const { data: staleSuspensions } = await admin
    .from("cleaner_accountability_actions")
    .select("id, cleaner_id, cleaners(status)")
    .eq("action_type", "suspension")
    .eq("status", "active")
    .lt("suspension_end", nowIso.slice(0, 10));
  for (const s of staleSuspensions || []) {
    const c = Array.isArray(s.cleaners) ? s.cleaners[0] : s.cleaners;
    if (String(c?.status || "").toLowerCase() === "suspended") continue; // restore path owns it
    await admin.from("cleaner_accountability_actions").update({
      status: "completed", completed_at: nowIso, updated_at: nowIso,
    }).eq("id", s.id);
  }

  // 2. Strikes past their expiry → status='expired' (kept in history).
  const { data: dueStrikes } = await admin
    .from("cleaner_accountability_actions")
    .select("id, cleaner_id")
    .eq("action_type", "strike")
    .eq("status", "active")
    .not("expires_at", "is", null)
    .lt("expires_at", nowIso);
  const affected = new Set<string>();
  for (const s of dueStrikes || []) {
    await admin.from("cleaner_accountability_actions").update({
      status: "expired", expired_at: nowIso, updated_at: nowIso,
    }).eq("id", s.id);
    affected.add(s.cleaner_id);
  }
  for (const cleanerId of affected) {
    await syncStrikeCount(admin, cleanerId);
  }

  return { restored, expiredStrikes: (dueStrikes || []).length };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  const admin: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").toLowerCase();
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");

    // ─── sweep — pg_cron with the service-role bearer (admins may also run) ──
    if (action === "sweep") {
      const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      let allowed = Boolean(serviceRole) && bearer === serviceRole;
      if (!allowed) {
        try { await ensureAdminOrVa(admin, bearer); allowed = true; } catch { allowed = false; }
      }
      if (!allowed) return json({ ok: false, error: "Not authorized." }, 403);
      const result = await runSweep(admin);
      log("sweep", result);
      return json({ ok: true, ...result });
    }

    // ─── everything else requires an admin/VA JWT ────────────────────────────
    if (!bearer) return json({ ok: false, error: "Not signed in." }, 401);
    const actor = await ensureAdminOrVa(admin, bearer);
    const nowIso = new Date().toISOString();

    // ─── dashboard — active strikes / suspended / repeat offenders ──────────
    if (action === "dashboard") {
      await runSweep(admin); // keep the watchlist truthful before reading

      const { data: suspendedCleaners } = await admin
        .from("cleaners")
        .select("id, first_name, last_name, suspended_until, suspension_reason, active_strike_count")
        .eq("status", "suspended")
        .order("suspended_until", { ascending: true });

      const { data: strikeRows } = await admin
        .from("cleaner_accountability_actions")
        .select("cleaner_id, status, created_at, strike_number")
        .eq("action_type", "strike")
        .order("created_at", { ascending: false })
        .limit(2000);

      const active = new Map<string, { count: number; latest: string }>();
      const windowMs = 180 * 86400_000;
      const inWindow = new Map<string, number>();
      for (const r of strikeRows || []) {
        if (r.status === "active") {
          const e = active.get(r.cleaner_id) || { count: 0, latest: r.created_at };
          e.count++;
          if (r.created_at > e.latest) e.latest = r.created_at;
          active.set(r.cleaner_id, e);
        }
        if (Date.now() - new Date(r.created_at).getTime() < windowMs) {
          inWindow.set(r.cleaner_id, (inWindow.get(r.cleaner_id) || 0) + 1);
        }
      }

      const ids = [...new Set([...active.keys(), ...inWindow.keys()])];
      const names = new Map<string, { name: string; status: string }>();
      if (ids.length > 0) {
        const { data: rows } = await admin
          .from("cleaners").select("id, first_name, last_name, status").in("id", ids);
        for (const r of rows || []) {
          names.set(r.id, {
            name: `${r.first_name || ""} ${r.last_name || ""}`.trim() || "Cleaner",
            status: String(r.status || ""),
          });
        }
      }

      const activeStrikes = [...active.entries()]
        .map(([cleanerId, e]) => ({
          cleanerId,
          name: names.get(cleanerId)?.name || "Cleaner",
          status: names.get(cleanerId)?.status || "",
          activeStrikes: e.count,
          latestStrikeAt: e.latest,
        }))
        .sort((a, b) => b.activeStrikes - a.activeStrikes);

      // Repeat offenders: 2+ strikes inside the 180-day window (active or
      // not) — a pattern worth reviewing even if individual strikes expired.
      const repeatOffenders = [...inWindow.entries()]
        .filter(([, n]) => n >= 2)
        .map(([cleanerId, n]) => ({
          cleanerId,
          name: names.get(cleanerId)?.name || "Cleaner",
          status: names.get(cleanerId)?.status || "",
          strikesInWindow: n,
          windowDays: 180,
        }))
        .sort((a, b) => b.strikesInWindow - a.strikesInWindow);

      return json({
        ok: true,
        suspended: (suspendedCleaners || []).map((c: Record<string, unknown>) => ({
          cleanerId: c.id,
          name: `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner",
          suspendedUntil: c.suspended_until,
          reason: c.suspension_reason,
          activeStrikes: c.active_strike_count ?? 0,
        })),
        activeStrikes,
        repeatOffenders,
      });
    }

    // ─── settings ────────────────────────────────────────────────────────────
    if (action === "get_settings") {
      return json({ ok: true, settings: await getSettings(admin) });
    }
    if (action === "set_settings") {
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", actor.id);
      if (!(roles || []).some((r: { role: string }) => r.role === "admin")) {
        return json({ ok: false, error: "Only admins can change accountability settings." }, 403);
      }
      const months = Number(body?.strikeExpiryMonths);
      if (!Number.isFinite(months) || months < 0 || months > 60) {
        return json({ ok: false, error: "strikeExpiryMonths must be 0–60 (0 = never expire)." }, 400);
      }
      await admin.from("app_settings").upsert({
        key: "accountability_settings",
        value: { strike_expiry_months: Math.round(months) },
        updated_at: nowIso,
      }, { onConflict: "key" });
      await admin.from("events").insert({
        event_type: "cleaner.accountability_settings_changed",
        source: "cleaner-accountability",
        summary: `Strike expiry set to ${Math.round(months)} month(s) by ${actor.name}`,
        data: { strike_expiry_months: Math.round(months), by: actor.id },
      }).then(() => undefined, () => undefined);
      return json({ ok: true, settings: { strike_expiry_months: Math.round(months) } });
    }

    // ─── list — one cleaner's full accountability record ─────────────────────
    if (action === "list") {
      const cleanerId = String(body?.cleanerId || "");
      if (!cleanerId) return json({ ok: false, error: "cleanerId required" }, 400);

      await runSweep(admin); // lazy restore/expiry so the record is current

      const { data: cleaner } = await admin
        .from("cleaners")
        .select("id, first_name, last_name, email, status, active_strike_count, suspended_at, suspended_until, suspension_reason, novara_score, quality_score, overall_score, terminated_at, termination_reason")
        .eq("id", cleanerId).maybeSingle();
      if (!cleaner) return json({ ok: false, error: "Cleaner not found." }, 404);

      const { data: actions } = await admin
        .from("cleaner_accountability_actions")
        .select("*")
        .eq("cleaner_id", cleanerId)
        .order("created_at", { ascending: false })
        .limit(200);

      return json({
        ok: true,
        cleaner,
        actions: actions || [],
        activeStrikes: cleaner.active_strike_count ?? 0,
        settings: await getSettings(admin),
      });
    }

    // ─── preview_email — the auto-filled template for review/edit ────────────
    if (action === "preview_email" || action === "create") {
      const cleanerId = String(body?.cleanerId || "");
      const actionType = String(body?.actionType || "") as ActionType;
      if (!cleanerId) return json({ ok: false, error: "cleanerId required" }, 400);
      if (!ACTION_TYPES.includes(actionType)) {
        return json({ ok: false, error: `actionType must be one of: ${ACTION_TYPES.join(", ")}` }, 400);
      }

      const { data: cleaner } = await admin
        .from("cleaners").select("*").eq("id", cleanerId).maybeSingle();
      if (!cleaner) return json({ ok: false, error: "Cleaner not found." }, 404);

      // The QC case link — the connective tissue.
      const qcIssueId = body?.qcIssueId ? String(body.qcIssueId) : null;
      // deno-lint-ignore no-explicit-any
      let issue: any = null;
      if (qcIssueId) {
        const { data } = await admin.from("qc_issues").select("*").eq("id", qcIssueId).maybeSingle();
        if (!data) return json({ ok: false, error: "Linked QC issue not found." }, 404);
        issue = data;
      }

      const reasonInput = String(body?.reason || "").trim().slice(0, 2000);
      // Every action needs a linked QC case OR a documented reason.
      // (Previews may render with a placeholder before the admin types one.)
      if (action === "create" && !issue && !reasonInput) {
        return json({
          ok: false,
          error: "A linked QC case or a documented reason is required — no undocumented actions.",
        }, 400);
      }
      const incidentSummary = reasonInput || incidentSummaryFromIssue(issue) || "[incident summary]";
      const incidentDate = fmtDate(issue?.created_at || nowIso);

      const activeStrikes = await countActiveStrikes(admin, cleanerId);
      const strikeNumber = activeStrikes + 1;

      const suspensionStart = body?.suspensionStart
        ? String(body.suspensionStart) : nowIso.slice(0, 10);
      const suspensionEnd = body?.suspensionEnd ? String(body.suspensionEnd) : null;
      const existingJobsHandling = body?.existingJobsHandling === "reassign" ? "reassign" : "keep";

      const template = buildEmailTemplate(actionType, {
        firstName: String(cleaner.first_name || "").trim(),
        incidentSummary,
        incidentDate,
        strikeNumber,
        suspensionStart,
        suspensionEnd: suspensionEnd || suspensionStart,
        existingJobsHandling,
      });

      if (action === "preview_email") {
        return json({
          ok: true,
          subject: template.subject,
          body: template.body,
          context: {
            activeStrikes,
            strikeNumber,
            incidentSummary,
            cleanerEmail: cleaner.email || null,
          },
        });
      }

      // ─── create — take the action ─────────────────────────────────────────
      const note = String(body?.note || "").trim().slice(0, 4000);
      if (!note) return json({ ok: false, error: "An admin note is required — every action is documented." }, 400);

      const cleanerStatus = String(cleaner.status || "").toLowerCase();
      const cleanerName = `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim() || "Cleaner";
      const severeCause = body?.severeCause === true;

      if (cleanerStatus === "terminated") {
        return json({ ok: false, error: "This cleaner has already been removed — history is retained on their record." }, 409);
      }

      // Proportionality gate: direct-to-suspend/remove needs severe cause.
      if (actionType === "suspension" && activeStrikes < 2 && !severeCause) {
        return json({
          ok: false,
          code: "LADDER",
          error: `Suspension is normally Strike 2 territory (this cleaner has ${activeStrikes} active strike${activeStrikes === 1 ? "" : "s"}). Confirm severe cause with a documented reason to suspend directly.`,
        }, 409);
      }
      if (actionType === "removal" && activeStrikes < 3 && !severeCause) {
        return json({
          ok: false,
          code: "LADDER",
          error: `Removal is normally Strike 3 territory (this cleaner has ${activeStrikes} active strike${activeStrikes === 1 ? "" : "s"}). Confirm severe cause with a documented reason to remove directly.`,
        }, 409);
      }
      if ((actionType === "suspension" || actionType === "removal") && severeCause && !reasonInput && !issue) {
        return json({ ok: false, error: "Severe-cause actions require a documented reason." }, 400);
      }

      if (actionType === "suspension") {
        if (!suspensionEnd) return json({ ok: false, error: "A suspension end date is required." }, 400);
        if (suspensionEnd < suspensionStart) {
          return json({ ok: false, error: "Suspension end date must be on or after the start date." }, 400);
        }
        if (cleanerStatus === "suspended") {
          return json({ ok: false, error: "This cleaner is already suspended. Lift the current suspension first." }, 409);
        }
      }

      // The formal email — admin-edited text wins over the template.
      const emailSubject = String(body?.emailSubject || template.subject).trim().slice(0, 300);
      const emailBody = String(body?.emailBody || template.body).trim().slice(0, 10000);
      const defaultSend = actionType !== "coaching_note";
      const sendEmail = body?.sendEmail === undefined ? defaultSend : body.sendEmail === true;
      const toEmail = String(cleaner.email || "").trim();
      const emailDeliverable = Boolean(toEmail) && !toEmail.endsWith("@pending.novara");

      const settings = await getSettings(admin);

      // Build the ledger row.
      const row: Record<string, unknown> = {
        cleaner_id: cleanerId,
        action_type: actionType,
        qc_issue_id: issue?.id || null,
        qc_issue_ref: issue ? `#${issue.issue_number}${issue.booking_ref ? ` · ${issue.booking_ref}` : ""}` : null,
        reason: incidentSummary,
        note,
        severe_cause: severeCause,
        created_by: actor.id,
        created_by_name: actor.name,
        email_to: sendEmail && emailDeliverable ? toEmail : null,
        email_subject: emailSubject,
        email_body: emailBody,
        email_skipped: !sendEmail,
      };

      if (actionType === "strike") {
        row.strike_number = strikeNumber;
        if (settings.strike_expiry_months > 0) {
          const exp = new Date();
          exp.setMonth(exp.getMonth() + settings.strike_expiry_months);
          row.expires_at = exp.toISOString();
        }
      }
      if (actionType === "suspension") {
        row.suspension_start = suspensionStart;
        row.suspension_end = suspensionEnd;
        row.existing_jobs_handling = existingJobsHandling;
      }

      const { data: actionRow, error: insErr } = await admin
        .from("cleaner_accountability_actions")
        .insert(row).select("*").single();
      if (insErr) throw insErr;

      // ── Apply the action's side effects ────────────────────────────────────
      let reassignedJobs = 0;

      if (actionType === "strike") {
        await syncStrikeCount(admin, cleanerId);
        // The Novara Score is the continuous lever: strikes feed the same
        // severity-weighted quality penalty QC cases already apply — the
        // engine recomputes immediately so priority drops right away.
        admin.functions.invoke("compute-cleaner-scores", { body: { source: "cleaner-accountability" } })
          .catch((e: unknown) => log("score recompute failed", String(e)));
      }

      if (actionType === "suspension") {
        await admin.from("cleaners").update({
          status: "suspended",
          available_for_bookings: false,
          suspended_at: nowIso,
          suspended_until: suspensionEndTimestamp(suspensionEnd!),
          suspension_reason: incidentSummary.slice(0, 500),
          updated_at: nowIso,
        }).eq("id", cleanerId);
        if (existingJobsHandling === "reassign") {
          reassignedJobs = await markFutureAssignmentsForReassignment(
            admin, cleanerId, actor.id, "cleaner_suspended",
          );
        }
      }

      if (actionType === "removal") {
        const rehireStatus = ["rehireable", "no_rehire", "under_review", "blacklist"].includes(String(body?.rehireStatus))
          ? String(body.rehireStatus) : "no_rehire";
        // Same offboarding semantics as terminate-cleaner: history retained,
        // portal/dispatch off, verified pay owed still settles normally.
        await admin.from("cleaners").update({
          status: "terminated",
          terminated_at: nowIso,
          termination_reason: "accountability_removal",
          termination_effective_date: nowIso.slice(0, 10),
          terminated_by: actor.id,
          rehire_status: rehireStatus,
          available_for_bookings: false,
          approved: false,
          suspended_at: null,
          suspended_until: null,
          suspension_reason: null,
          deactivated_at: cleaner.deactivated_at ?? nowIso,
          deactivation_reason: cleaner.deactivation_reason ?? "accountability_removal",
          updated_at: nowIso,
        }).eq("id", cleanerId);
        reassignedJobs = await markFutureAssignmentsForReassignment(
          admin, cleanerId, actor.id, "cleaner_removed",
        );
        // Close any open suspension row — the removal supersedes it.
        await admin.from("cleaner_accountability_actions").update({
          status: "completed", completed_at: nowIso, updated_at: nowIso,
        }).eq("cleaner_id", cleanerId).eq("action_type", "suspension").eq("status", "active");
        // Mirror into the offboarding audit ledger.
        await admin.from("cleaner_terminations").insert({
          cleaner_id: cleanerId,
          reason: "other",
          reason_label: "Accountability removal (documented escalation)",
          rehire_status: rehireStatus,
          notes: `${incidentSummary}\n\nAdmin note: ${note}`.slice(0, 2000),
          effective_date: nowIso.slice(0, 10),
          letter_to: emailDeliverable ? toEmail : null,
          letter_sent: false,
          terminated_by: actor.id,
        }).then(() => undefined, () => undefined);
      }

      // ── Send + archive the formal email ────────────────────────────────────
      let emailResult: { sent: boolean; error: string | null } = { sent: false, error: null };
      if (sendEmail) {
        if (!emailDeliverable) {
          emailResult = { sent: false, error: "No valid contractor email on file — notice not sent." };
        } else {
          emailResult = await sendFormalEmail({ to: toEmail, subject: emailSubject, body: emailBody });
        }
        await admin.from("cleaner_accountability_actions").update({
          email_sent: emailResult.sent,
          email_sent_at: emailResult.sent ? new Date().toISOString() : null,
          email_error: emailResult.error,
          updated_at: new Date().toISOString(),
        }).eq("id", actionRow.id);
      }

      // ── Log everywhere it should show up ───────────────────────────────────
      if (issue) {
        await admin.from("qc_issue_events").insert({
          issue_id: issue.id,
          action: "note",
          note: `Accountability action taken from this case: ${
            actionType === "strike" ? `Strike ${strikeNumber} issued`
            : actionType === "suspension" ? `Suspended from new assignments through ${fmtDate(suspensionEnd)}`
            : actionType === "removal" ? "Removed / engagement ended"
            : "Coaching note logged"
          }.${emailResult.sent ? " Formal email sent." : ""}`,
          actor_id: actor.id,
          actor_name: actor.name,
          data: { accountability_action_id: actionRow.id, action_type: actionType },
        }).then(() => undefined, () => undefined);
      }

      const eventType =
        actionType === "strike" ? "cleaner.strike_issued"
        : actionType === "suspension" ? "cleaner.suspended"
        : actionType === "removal" ? "cleaner.removed"
        : "cleaner.coaching_note";
      const summary =
        actionType === "strike"
          ? `⚠️ Strike ${strikeNumber} issued to ${cleanerName} by ${actor.name}${issue ? ` (QC ${actionRow.qc_issue_ref})` : ""} — ${incidentSummary.slice(0, 200)}`
        : actionType === "suspension"
          ? `⛔ ${cleanerName} suspended from new assignments through ${fmtDate(suspensionEnd)} by ${actor.name} (existing jobs: ${existingJobsHandling}) — ${incidentSummary.slice(0, 200)}`
        : actionType === "removal"
          ? `🛑 ${cleanerName} removed (engagement ended) by ${actor.name} — ${incidentSummary.slice(0, 200)}`
          : `📝 Coaching note logged for ${cleanerName} by ${actor.name} — ${incidentSummary.slice(0, 200)}`;
      await admin.from("events").insert({
        event_type: eventType,
        cleaner_id: cleanerId,
        source: "cleaner-accountability",
        summary,
        data: {
          accountability_action_id: actionRow.id,
          action_type: actionType,
          qc_issue_id: issue?.id || null,
          strike_number: actionType === "strike" ? strikeNumber : undefined,
          severe_cause: severeCause,
          email_sent: emailResult.sent,
          reassigned_jobs: reassignedJobs,
          by: actor.id,
        },
      }).then(() => undefined, () => undefined);

      // Keep GHL tags in sync when the lifecycle changed.
      if (actionType === "suspension" || actionType === "removal") {
        admin.functions.invoke("sync-cleaner-to-ghl", { body: { cleanerId } })
          .catch((e: unknown) => log("GHL sync failed", String(e)));
      }

      return json({
        ok: true,
        action: { ...actionRow, email_sent: emailResult.sent, email_error: emailResult.error },
        activeStrikes: actionType === "strike" ? strikeNumber : activeStrikes,
        emailSent: emailResult.sent,
        emailError: emailResult.error,
        reassignedJobs,
      });
    }

    // ─── lift_suspension — admin ends the window early ───────────────────────
    if (action === "lift_suspension") {
      const actionId = String(body?.actionId || "");
      const note = String(body?.note || "").trim().slice(0, 2000);
      if (!actionId) return json({ ok: false, error: "actionId required" }, 400);
      if (!note) return json({ ok: false, error: "A note is required — lifting early is logged like everything else." }, 400);

      const { data: act } = await admin
        .from("cleaner_accountability_actions").select("*").eq("id", actionId).maybeSingle();
      if (!act) return json({ ok: false, error: "Action not found." }, 404);
      if (act.action_type !== "suspension" || act.status !== "active") {
        return json({ ok: false, error: "Only an active suspension can be lifted." }, 409);
      }

      const nowIso2 = new Date().toISOString();
      await admin.from("cleaner_accountability_actions").update({
        status: "lifted", lifted_at: nowIso2, lifted_by: actor.id,
        lifted_by_name: actor.name, lift_note: note, updated_at: nowIso2,
      }).eq("id", actionId);
      await admin.from("cleaners").update({
        status: "active",
        available_for_bookings: true,
        suspended_at: null,
        suspended_until: null,
        suspension_reason: null,
        updated_at: nowIso2,
      }).eq("id", act.cleaner_id).eq("status", "suspended");
      await admin.from("events").insert({
        event_type: "cleaner.suspension_ended",
        cleaner_id: act.cleaner_id,
        source: "cleaner-accountability",
        summary: `Suspension lifted early by ${actor.name} — "${note.slice(0, 200)}"`,
        data: { accountability_action_id: actionId, by: actor.id, lifted_early: true },
      }).then(() => undefined, () => undefined);

      return json({ ok: true });
    }

    return json({ ok: false, error: `Unknown action '${action}'.` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    const status = msg.includes("Not signed in") ? 401 : msg.includes("only") ? 403 : 500;
    return json({ ok: false, error: msg }, status);
  }
});

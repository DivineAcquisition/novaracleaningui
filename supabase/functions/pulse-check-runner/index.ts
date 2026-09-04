// pulse-check-runner
//
// Daily. Two jobs:
//   1. FOLLOW-UP + SILENCE — reminder before the deadline, then unanswered
//      entries are terminated after no_response_terminate_days (default 3).
//      A claimed job without a form submit counts as engagement (completed,
//      not terminated). Does not write scores.
//   2. CYCLE START — only when the configured interval has elapsed
//      (default 14 days). Every active contractor with zero work-like
//      assignments in that lookback gets a unique tokenized link by
//      SMS + email in the same run.
//
// Admin can force a new idle cycle via { force: true } (counts toward the
// 14-day clock). One-off sends go through POST /api/admin/pulse-check
// { action: "send_one" } and never reset that clock.
// Auth: service-role bearer, x-cron-secret (pg_cron), or admin/VA JWT.
// verify_jwt is false so cron can call with the anon key; this gate is the
// real lock. Never leave this function open — a POST would SMS every idle
// contractor.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

const log = (m: string, d?: unknown) =>
  console.log(`[pulse-check-runner] ${m}${d === undefined ? "" : " " + JSON.stringify(d)}`);

// deno-lint-ignore no-explicit-any
type SB = any;

const DEFAULTS = {
  enabled: true,
  interval_days: 14,
  followup_days: 2,
  no_response_terminate_days: 3,
  token_ttl_days: 14,
};
const PULSE_REAPPLY_DAYS = 90;

function parseSettings(raw: unknown) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const clamp = (v: unknown, fb: number, min: number, max: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fb;
  };
  const interval = clamp(src.interval_days, DEFAULTS.interval_days, 1, 90);
  const ttl = clamp(src.token_ttl_days, DEFAULTS.token_ttl_days, 1, 90);
  let terminate = clamp(src.no_response_terminate_days, DEFAULTS.no_response_terminate_days, 1, 30);
  if (terminate > ttl) terminate = ttl;
  let followup = clamp(src.followup_days, DEFAULTS.followup_days, 1, 30);
  if (terminate > 1 && followup >= terminate) followup = terminate - 1;
  if (followup >= ttl) followup = Math.max(1, ttl - 1);
  return {
    enabled: src.enabled !== false,
    interval_days: interval,
    followup_days: followup,
    no_response_terminate_days: terminate,
    token_ttl_days: ttl,
  };
}

function formatRosterDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/** Keep in sync with src/lib/pulse-check/silence.ts */
function pulseSilenceAction(args: {
  submitted: boolean;
  claimedCount: number;
  sentAt: string | null | undefined;
  followupSent: boolean;
  followupDays: number;
  terminateDays: number;
  tokenExpiresAt: string | null | undefined;
  now: Date;
}): "none" | "followup" | "complete_claimed" | "terminate" {
  if (args.submitted) return "none";
  const nowMs = args.now.getTime();
  const sentMs = args.sentAt ? new Date(args.sentAt).getTime() : NaN;
  const sentOk = Number.isFinite(sentMs);
  const terminateDue = sentOk && nowMs >= sentMs + args.terminateDays * 86_400_000;
  const expired = args.tokenExpiresAt
    ? (() => {
      const t = new Date(args.tokenExpiresAt).getTime();
      return Number.isFinite(t) && t < nowMs;
    })()
    : false;
  if (terminateDue || expired) {
    return args.claimedCount > 0 ? "complete_claimed" : "terminate";
  }
  if (args.followupSent || !sentOk) return "none";
  if (nowMs >= sentMs + args.followupDays * 86_400_000) return "followup";
  return "none";
}

function pulseLink(token: string) {
  return `https://contractor.novaracleaning.com/cleaner/pulse/${token}`;
}

function cycleDue(lastStartedAt: string | null, intervalDays: number, now: Date) {
  if (!lastStartedAt) return true;
  const started = new Date(lastStartedAt);
  if (Number.isNaN(started.getTime())) return true;
  return now.getTime() - started.getTime() >= intervalDays * 86_400_000;
}

async function sendPulse(
  admin: SB,
  cleaner: Record<string, unknown>,
  link: string,
  kind: "initial" | "followup" | "closed",
  opts?: { terminateDays?: number; reapplyDate?: string | null },
) {
  const firstName = String(cleaner.first_name || "").trim() || "there";
  const email = String(cleaner.email || "").trim();
  const phone = String(cleaner.phone || "").trim();
  const days = opts?.terminateDays && opts.terminateDays > 0 ? opts.terminateDays : 3;
  let emailed = false;
  let smsSent = false;

  if (email && !email.endsWith("@pending.novara")) {
    try {
      const { data, error } = await admin.functions.invoke("send-cleaner-email", {
        body: {
          type: "pulse_check",
          email,
          data: {
            firstName,
            pulseUrl: link,
            followup: kind === "followup",
            closed: kind === "closed",
            terminateDays: days,
            reapplyDate: opts?.reapplyDate || null,
          },
        },
      });
      emailed = !error && !(data as { error?: string } | null)?.error;
      if (!emailed) log("email failed", { cleanerId: cleaner.id, error: error?.message || data });
    } catch (e) {
      log("email threw", { cleanerId: cleaner.id, err: e instanceof Error ? e.message : String(e) });
    }
  }

  if (phone && cleaner.sms_notifications_enabled !== false) {
    let message: string;
    if (kind === "closed") {
      const until = opts?.reapplyDate
        ? ` You can apply again after ${opts.reapplyDate}.`
        : " You can apply again in 3 months.";
      message =
        `Hi ${firstName} — we didn't hear back on your Novara pulse check, so your contractor account is closed.${until} Reply STOP to opt out.`;
    } else if (kind === "followup") {
      message =
        `Hi ${firstName} — last reminder from Novara Cleaning. Respond to your pulse check or we'll close ` +
        `your contractor account: ${link} Reply STOP to opt out.`;
    } else {
      message =
        `Hi ${firstName} — Novara Cleaning pulse check. Confirm you're still a contractor within ${days} days ` +
        `or we'll close your account (no reapply for 3 months): ${link} Reply STOP to opt out.`;
    }
    try {
      const { data, error } = await admin.functions.invoke("send-ghl-sms", {
        body: {
          phone,
          email: email || undefined,
          firstName,
          lastName: cleaner.last_name || undefined,
          message,
          type: kind === "followup" ? "pulse_check_followup" : kind === "closed" ? "pulse_check_closed" : "pulse_check",
        },
      });
      smsSent = !error && !(data as { error?: string } | null)?.error;
      if (!smsSent) log("sms failed", { cleanerId: cleaner.id, error: error?.message || data });
    } catch (e) {
      log("sms threw", { cleanerId: cleaner.id, err: e instanceof Error ? e.message : String(e) });
    }
  }

  return { emailed, smsSent };
}

async function releaseFutureAssignments(admin: SB, cleanerId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: open } = await admin
    .from("job_assignments")
    .select("id, job_id, status")
    .eq("cleaner_id", cleanerId)
    .in("status", ["Offered", "Accepted", "Confirmed"]);
  if (!open || open.length === 0) return 0;
  const jobIds = open.map((a: { job_id: string }) => a.job_id);
  const { data: futureJobs } = await admin
    .from("bookings")
    .select("job_id")
    .in("job_id", jobIds)
    .gte("service_date", today);
  const futureSet = new Set((futureJobs || []).map((j: { job_id: string }) => j.job_id));
  const targets = open.filter((a: { job_id: string }) => futureSet.has(a.job_id));
  if (targets.length === 0) return 0;
  await admin
    .from("job_assignments")
    .update({ status: "Needs Reassignment" })
    .in("id", targets.map((t: { id: string }) => t.id));
  return targets.length;
}

async function terminateForSilence(
  admin: SB,
  entry: Record<string, unknown>,
  now: Date,
  silentDays: number,
): Promise<boolean> {
  const { data: cleaner } = await admin
    .from("cleaners")
    .select("id, first_name, last_name, email, phone, sms_notifications_enabled, status")
    .eq("id", entry.cleaner_id)
    .maybeSingle();
  if (!cleaner) return false;

  const iso = now.toISOString();
  const eligible = new Date(now.getTime() + PULSE_REAPPLY_DAYS * 86_400_000).toISOString();
  const alreadyTerminated = String(cleaner.status || "").toLowerCase() === "terminated";
  const name = `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim() || "Contractor";
  const reasonLabel =
    `Terminated — no pulse-check response in ${silentDays} day${silentDays === 1 ? "" : "s"} ` +
    "(3-month reapply lockout)";
  let reassignedJobs = 0;

  if (!alreadyTerminated) {
    const { error } = await admin
      .from("cleaners")
      .update({
        status: "terminated",
        available_for_bookings: false,
        approved: false,
        terminated_at: iso,
        termination_reason: "abandoned_role",
        deactivated_at: iso,
        deactivation_reason: "personal_request",
        rehire_status: "no_rehire",
        rehire_notes: `Pulse check — no response. May reapply after ${formatRosterDate(eligible)}.`,
        reapply_eligible_at: eligible,
        inactive_until: null,
        termination_effective_date: iso.slice(0, 10),
        updated_at: iso,
      })
      .eq("id", cleaner.id);
    if (error) {
      log("silence terminate failed", { cleanerId: cleaner.id, error: error.message });
      return false;
    }
    reassignedJobs = await releaseFutureAssignments(admin, String(cleaner.id));
    await admin
      .from("cleaner_terminations")
      .insert({
        cleaner_id: cleaner.id,
        reason: "job_abandonment",
        reason_label: reasonLabel,
        rehire_status: "no_rehire",
        notes: `Pulse check — no form response in ${silentDays} days. Reapply after ${formatRosterDate(eligible)}.`,
        effective_date: iso.slice(0, 10),
        letter_sent: false,
      })
      .then(() => undefined, () => undefined);
    await admin
      .from("events")
      .insert({
        event_type: "cleaner.terminated",
        cleaner_id: cleaner.id,
        source: "pulse-check-runner",
        summary: `${name}: ${reasonLabel}`,
        data: {
          source: "pulse-check-silence",
          roster_action: "terminate",
          entry_id: entry.id,
          cycle_id: entry.cycle_id,
          reapply_eligible_at: eligible,
          reassigned_jobs: reassignedJobs,
          silent_days: silentDays,
        },
      })
      .then(() => undefined, () => undefined);
    admin.functions
      .invoke("sync-cleaner-to-ghl", { body: { cleanerId: cleaner.id } })
      .then(() => undefined, () => undefined);
    await sendPulse(admin, cleaner, pulseLink(String(entry.token || "")), "closed", {
      terminateDays: silentDays,
      reapplyDate: formatRosterDate(eligible),
    });
  }

  await admin
    .from("pulse_check_entries")
    .update({
      outcome: "no_response",
      answers: {
        status: "no_response",
        rosterAction: "terminate",
        reason: "no_response",
        reapplyEligibleAt: eligible,
        silentDays,
      },
      token_expires_at: iso,
      updated_at: iso,
    })
    .eq("id", entry.id);

  await admin
    .from("events")
    .insert({
      event_type: "cleaner.pulse_stale",
      cleaner_id: cleaner.id,
      source: "pulse-check-runner",
      summary: `${name} pulse check: no response in ${silentDays} days — account closed`,
      data: {
        entry_id: entry.id,
        cycle_id: entry.cycle_id,
        roster_action: "terminate",
        reapply_eligible_at: eligible,
        already_terminated: alreadyTerminated,
      },
    })
    .then(() => undefined, () => undefined);

  return !alreadyTerminated;
}

async function authorize(req: Request, admin: SB): Promise<boolean> {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (token && serviceKey && token === serviceKey) return true;

  const cronHeader = (req.headers.get("x-cron-secret") || "").trim();
  if (cronHeader) {
    let expected = (Deno.env.get("CRON_SECRET") || "").trim();
    try {
      const { data } = await admin.from("app_secrets").select("value").eq("key", "CRON_SECRET").maybeSingle();
      if (data?.value && typeof data.value === "string" && data.value.trim()) {
        expected = data.value.trim();
      }
    } catch {
      /* env fallback */
    }
    if (expected && cronHeader === expected) return true;
  }

  if (!token) return false;
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user?.id) return false;
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  return (roles || []).some((r: { role: string }) => r.role === "admin" || r.role === "va");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const admin: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  if (!(await authorize(req, admin))) return json({ error: "Unauthorized" }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const force = Boolean(body?.force);
    const dryRun = Boolean(body?.dryRun || body?.dry_run);
    const source = String(body?.source || "unknown");

    const { data: settingRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "pulse_check_settings")
      .maybeSingle();
    const settings = parseSettings(settingRow?.value);
    const now = new Date();

    if (dryRun) {
      const { data: idleIds, error: idleErr } = await admin.rpc("pulse_check_idle_cleaner_ids", {
        p_lookback_days: settings.interval_days,
      });
      if (idleErr) throw idleErr;
      const { data: latest } = await admin
        .from("pulse_check_cycles")
        .select("id, started_at, qualifying_count, sent_count")
        .eq("counts_toward_interval", true)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const idleCount = (idleIds || []).length;
      return json({
        ok: true,
        dryRun: true,
        enabled: settings.enabled,
        settings,
        idleCount,
        cycleDue: cycleDue(latest?.started_at || null, settings.interval_days, now),
        lastCycle: latest || null,
        source,
      });
    }

    let followups = 0;
    let stale = 0;
    let terminated = 0;

    const { data: pending } = await admin
      .from("pulse_check_entries")
      .select("id, cycle_id, cleaner_id, token, token_expires_at, sent_at, followup_sent_at, submitted_at, opened_at, claimed_job_ids, outcome")
      .eq("outcome", "pending")
      .limit(500);

    for (const entry of pending || []) {
      const claimed = Array.isArray(entry.claimed_job_ids) ? entry.claimed_job_ids.length : 0;
      const action = pulseSilenceAction({
        submitted: Boolean(entry.submitted_at),
        claimedCount: claimed,
        sentAt: entry.sent_at,
        followupSent: Boolean(entry.followup_sent_at),
        followupDays: settings.followup_days,
        terminateDays: settings.no_response_terminate_days,
        tokenExpiresAt: entry.token_expires_at,
        now,
      });

      if (action === "complete_claimed") {
        await admin.from("pulse_check_entries").update({
          outcome: "completed",
          updated_at: now.toISOString(),
        }).eq("id", entry.id);
        stale++;
        continue;
      }

      if (action === "terminate") {
        const did = await terminateForSilence(admin, entry, now, settings.no_response_terminate_days);
        if (did) terminated++;
        stale++;
        continue;
      }

      if (action !== "followup" || !entry.token) continue;

      const { data: cleaner } = await admin
        .from("cleaners")
        .select("id, first_name, last_name, email, phone, sms_notifications_enabled, status")
        .eq("id", entry.cleaner_id)
        .maybeSingle();
      if (!cleaner || String(cleaner.status) === "terminated") continue;

      const link = pulseLink(entry.token);
      const sent = await sendPulse(admin, cleaner, link, "followup", {
        terminateDays: settings.no_response_terminate_days,
      });
      await admin.from("pulse_check_entries").update({
        followup_sent_at: now.toISOString(),
        updated_at: now.toISOString(),
      }).eq("id", entry.id);
      followups++;
      await admin.from("events").insert({
        event_type: "cleaner.pulse_followup_sent",
        cleaner_id: cleaner.id,
        source: "pulse-check-runner",
        summary: `Pulse check follow-up sent to ${cleaner.first_name || "contractor"}`,
        data: { entry_id: entry.id, emailed: sent.emailed, sms_sent: sent.smsSent },
      }).then(() => undefined, () => undefined);
    }

    let skippedCycle = false;
    let cycleId: string | null = null;
    let qualified = 0;
    let sentCount = 0;

    if (!settings.enabled && !force) {
      return json({ ok: true, disabled: true, followups, stale, terminated, source });
    }

    const { data: latest } = await admin
      .from("pulse_check_cycles")
      .select("id, started_at")
      .eq("counts_toward_interval", true)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!force && !cycleDue(latest?.started_at || null, settings.interval_days, now)) {
      skippedCycle = true;
      return json({ ok: true, skippedCycle: true, followups, stale, terminated, source });
    }

    const startedBy = typeof body?.startedBy === "string" && /^[0-9a-f-]{36}$/i.test(body.startedBy)
      ? body.startedBy
      : null;
    const cycleSource = source === "admin" || source === "pg_cron" || source === "cron" ? source : "cron";

    const { data: cycle, error: cycleErr } = await admin
      .from("pulse_check_cycles")
      .insert({
        started_at: now.toISOString(),
        interval_days: settings.interval_days,
        followup_days: settings.followup_days,
        token_ttl_days: settings.token_ttl_days,
        settings_snapshot: { ...settings, source: cycleSource },
        counts_toward_interval: true,
        source: cycleSource,
        started_by: startedBy,
      })
      .select("id")
      .single();
    if (cycleErr || !cycle) throw cycleErr || new Error("Could not open a pulse-check cycle");
    cycleId = cycle.id;

    const { data: idleIds, error: idleErr } = await admin.rpc("pulse_check_idle_cleaner_ids", {
      p_lookback_days: settings.interval_days,
    });
    if (idleErr) throw idleErr;
    const ids = (idleIds || []).map((r: { cleaner_id: string }) => r.cleaner_id).filter(Boolean);
    qualified = ids.length;

    if (ids.length > 0) {
      const rows = ids.map((cleaner_id: string) => ({
        cycle_id: cycleId,
        cleaner_id,
        outcome: "pending",
      }));
      const { error: insErr } = await admin.from("pulse_check_entries").insert(rows);
      if (insErr) throw insErr;
    }

    const { data: entries } = await admin
      .from("pulse_check_entries")
      .select("id, cleaner_id, token")
      .eq("cycle_id", cycleId);

    for (const entry of entries || []) {
      const { data: token, error: mintErr } = await admin.rpc("mint_cleaner_pulse_token", {
        p_entry_id: entry.id,
        p_ttl_days: settings.token_ttl_days,
      });
      if (mintErr || !token) {
        log("mint failed", { entryId: entry.id, error: mintErr?.message });
        continue;
      }
      const { data: cleaner } = await admin
        .from("cleaners")
        .select("id, first_name, last_name, email, phone, sms_notifications_enabled")
        .eq("id", entry.cleaner_id)
        .maybeSingle();
      if (!cleaner) continue;
      const link = pulseLink(String(token));
      const sent = await sendPulse(admin, cleaner, link, "initial", {
        terminateDays: settings.no_response_terminate_days,
      });
      const reached = sent.emailed || sent.smsSent;
      await admin.from("pulse_check_entries").update({
        sent_at: now.toISOString(),
        emailed: sent.emailed,
        sms_sent: sent.smsSent,
        updated_at: now.toISOString(),
      }).eq("id", entry.id);
      if (reached) sentCount++;
      await admin.from("events").insert({
        event_type: "cleaner.pulse_sent",
        cleaner_id: cleaner.id,
        source: "pulse-check-runner",
        summary:
          `Pulse check sent to ${`${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim()}` +
          ` (email: ${sent.emailed ? "sent" : "not sent"}, SMS: ${sent.smsSent ? "sent" : "not sent"})`,
        data: { entry_id: entry.id, cycle_id: cycleId, emailed: sent.emailed, sms_sent: sent.smsSent },
      }).then(() => undefined, () => undefined);
    }

    await admin.from("pulse_check_cycles").update({
      qualifying_count: qualified,
      sent_count: sentCount,
      completed_at: new Date().toISOString(),
    }).eq("id", cycleId);

    await admin.from("events").insert({
      event_type: "cleaner.pulse_cycle_ran",
      source: "pulse-check-runner",
      summary:
        `Pulse check cycle sent to ${sentCount}/${qualified} idle contractors` +
        (followups ? ` · ${followups} follow-up(s)` : "") +
        (terminated ? ` · ${terminated} closed for no response` : "") +
        (stale ? ` · ${stale} stale` : ""),
      data: { cycle_id: cycleId, qualified, sent: sentCount, followups, stale, terminated, source },
    }).then(() => undefined, () => undefined);

    log("cycle complete", { cycleId, qualified, sentCount, followups, stale, terminated, source });
    return json({
      ok: true,
      cycleId,
      qualified,
      sent: sentCount,
      followups,
      stale,
      terminated,
      skippedCycle,
      source,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("error", msg);
    return json({ error: msg }, 500);
  }
});

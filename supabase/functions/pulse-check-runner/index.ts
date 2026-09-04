// pulse-check-runner
//
// Daily. Two jobs:
//   1. FOLLOW-UP + STALE — one in-cycle reminder for unanswered entries,
//      then expired silence becomes no_response (admin queue). Never
//      auto-changes roster status, eligibility, or scores.
//   2. CYCLE START — only when the configured interval has elapsed
//      (default 14 days). Every active contractor with zero work-like
//      assignments in that lookback gets a unique tokenized link by
//      SMS + email in the same run.
//
// Admin can force a new cycle via { force: true }.

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
  followup_days: 3,
  token_ttl_days: 14,
};

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
  let followup = clamp(src.followup_days, DEFAULTS.followup_days, 1, 30);
  if (followup >= ttl) followup = Math.max(1, ttl - 1);
  return {
    enabled: src.enabled !== false,
    interval_days: interval,
    followup_days: followup,
    token_ttl_days: ttl,
  };
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

async function sendPulse(admin: SB, cleaner: Record<string, unknown>, link: string, kind: "initial" | "followup") {
  const firstName = String(cleaner.first_name || "").trim() || "there";
  const email = String(cleaner.email || "").trim();
  const phone = String(cleaner.phone || "").trim();
  let emailed = false;
  let smsSent = false;

  if (email && !email.endsWith("@pending.novara")) {
    try {
      const { data, error } = await admin.functions.invoke("send-cleaner-email", {
        body: {
          type: "pulse_check",
          email,
          data: { firstName, pulseUrl: link, followup: kind === "followup" },
        },
      });
      emailed = !error && !(data as { error?: string } | null)?.error;
      if (!emailed) log("email failed", { cleanerId: cleaner.id, error: error?.message || data });
    } catch (e) {
      log("email threw", { cleanerId: cleaner.id, err: e instanceof Error ? e.message : String(e) });
    }
  }

  if (phone && cleaner.sms_notifications_enabled !== false) {
    const message = kind === "followup"
      ? `Hi ${firstName} — Novara Cleaning checking in. We still need a quick status update, and there may be jobs you can claim: ${link} Reply STOP to opt out.`
      : `Hi ${firstName} — Novara Cleaning pulse check. Are you still available for jobs? Open this link to confirm and see work you can claim: ${link} Reply STOP to opt out.`;
    try {
      const { data, error } = await admin.functions.invoke("send-ghl-sms", {
        body: {
          phone,
          email: email || undefined,
          firstName,
          lastName: cleaner.last_name || undefined,
          message,
          type: kind === "followup" ? "pulse_check_followup" : "pulse_check",
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const force = Boolean(body?.force);
    const source = String(body?.source || "unknown");

    const { data: settingRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "pulse_check_settings")
      .maybeSingle();
    const settings = parseSettings(settingRow?.value);
    const now = new Date();

    let followups = 0;
    let stale = 0;

    const { data: pending } = await admin
      .from("pulse_check_entries")
      .select("id, cycle_id, cleaner_id, token, token_expires_at, sent_at, followup_sent_at, submitted_at, opened_at, claimed_job_ids, outcome")
      .eq("outcome", "pending")
      .limit(500);

    for (const entry of pending || []) {
      const expires = entry.token_expires_at ? new Date(entry.token_expires_at).getTime() : 0;
      const claimed = Array.isArray(entry.claimed_job_ids) ? entry.claimed_job_ids.length : 0;

      if (expires && expires < now.getTime() && !entry.submitted_at) {
        const outcome = claimed > 0 ? "completed" : "no_response";
        await admin.from("pulse_check_entries").update({
          outcome,
          updated_at: now.toISOString(),
        }).eq("id", entry.id);
        stale++;
        if (outcome === "no_response") {
          await admin.from("events").insert({
            event_type: "cleaner.pulse_stale",
            cleaner_id: entry.cleaner_id,
            source: "pulse-check-runner",
            summary: "Pulse check expired with no response — needs admin review",
            data: { entry_id: entry.id, cycle_id: entry.cycle_id },
          }).then(() => undefined, () => undefined);
        }
        continue;
      }

      if (entry.followup_sent_at || !entry.sent_at || !entry.token) continue;
      const dueAt = new Date(entry.sent_at).getTime() + settings.followup_days * 86_400_000;
      if (now.getTime() < dueAt) continue;
      if (expires && expires < now.getTime()) continue;

      const { data: cleaner } = await admin
        .from("cleaners")
        .select("id, first_name, last_name, email, phone, sms_notifications_enabled, status")
        .eq("id", entry.cleaner_id)
        .maybeSingle();
      if (!cleaner || String(cleaner.status) === "terminated") continue;

      const link = pulseLink(entry.token);
      const sent = await sendPulse(admin, cleaner, link, "followup");
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
      return json({ ok: true, disabled: true, followups, stale, source });
    }

    const { data: latest } = await admin
      .from("pulse_check_cycles")
      .select("id, started_at")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!force && !cycleDue(latest?.started_at || null, settings.interval_days, now)) {
      skippedCycle = true;
      return json({ ok: true, skippedCycle: true, followups, stale, source });
    }

    const { data: cycle, error: cycleErr } = await admin
      .from("pulse_check_cycles")
      .insert({
        started_at: now.toISOString(),
        interval_days: settings.interval_days,
        followup_days: settings.followup_days,
        token_ttl_days: settings.token_ttl_days,
        settings_snapshot: settings,
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
      const sent = await sendPulse(admin, cleaner, link, "initial");
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
        (stale ? ` · ${stale} no-response` : ""),
      data: { cycle_id: cycleId, qualified, sent: sentCount, followups, stale, source },
    }).then(() => undefined, () => undefined);

    log("cycle complete", { cycleId, qualified, sentCount, followups, stale, source });
    return json({
      ok: true,
      cycleId,
      qualified,
      sent: sentCount,
      followups,
      stale,
      skippedCycle,
      source,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("error", msg);
    return json({ error: msg }, 500);
  }
});

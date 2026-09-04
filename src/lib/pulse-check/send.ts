import type { SupabaseClient } from "@supabase/supabase-js";

import { edgeResult } from "@/lib/edge-invoke";
import {
  pulseCheckLink,
  pulseSendBlockedReason,
  type PulseCheckSettings,
} from "@/lib/pulse-check/settings";

export type PulseSendKind = "initial" | "followup" | "closed";

export function pulseSmsMessage(
  firstName: string,
  link: string,
  kind: PulseSendKind,
  opts?: { terminateDays?: number; reapplyDate?: string | null },
): string {
  const name = firstName.trim() || "there";
  const days = opts?.terminateDays && opts.terminateDays > 0 ? opts.terminateDays : 3;
  if (kind === "closed") {
    const until = opts?.reapplyDate ? ` You can apply again after ${opts.reapplyDate}.` : " You can apply again in 3 months.";
    return `Hi ${name} — we didn't hear back on your Novara pulse check, so your contractor account is closed.${until} Reply STOP to opt out.`;
  }
  if (kind === "followup") {
    return (
      `Hi ${name} — last reminder from Novara Cleaning. Respond to your pulse check or we'll close ` +
      `your contractor account: ${link} Reply STOP to opt out.`
    );
  }
  return (
    `Hi ${name} — Novara Cleaning pulse check. Confirm you're still a contractor within ${days} days ` +
    `or we'll close your account (no reapply for 3 months): ${link} Reply STOP to opt out.`
  );
}

type CleanerContact = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  status?: string | null;
  sms_notifications_enabled?: boolean | null;
};

export async function sendPulseChannels(
  supabase: SupabaseClient,
  cleaner: CleanerContact,
  link: string,
  kind: PulseSendKind = "initial",
  opts?: { terminateDays?: number; reapplyDate?: string | null },
): Promise<{ emailed: boolean; smsSent: boolean; emailError: string | null; smsError: string | null }> {
  const firstName = String(cleaner.first_name || "").trim() || "there";
  const email = String(cleaner.email || "").trim();
  const phone = String(cleaner.phone || "").trim();
  const out = {
    emailed: false,
    smsSent: false,
    emailError: null as string | null,
    smsError: null as string | null,
  };

  if (email && !email.toLowerCase().endsWith("@pending.novara")) {
    const { data, error } = await supabase.functions.invoke("send-cleaner-email", {
      body: {
        type: "pulse_check",
        email,
        data: {
          firstName,
          pulseUrl: link,
          followup: kind === "followup",
          closed: kind === "closed",
          terminateDays: opts?.terminateDays ?? 3,
          reapplyDate: opts?.reapplyDate || null,
        },
      },
    });
    const res = await edgeResult(error, data);
    out.emailed = res.ok;
    if (!res.ok) out.emailError = res.error;
  } else if (!email) {
    out.emailError = "No email on the contractor record.";
  } else {
    out.emailError = "Placeholder email is not sendable.";
  }

  if (!phone) {
    out.smsError = "No phone on the contractor record.";
  } else if (cleaner.sms_notifications_enabled === false) {
    out.smsError = "SMS notifications are off for this contractor.";
  } else {
    const { data, error } = await supabase.functions.invoke("send-ghl-sms", {
      body: {
        phone,
        email: email || undefined,
        firstName,
        lastName: cleaner.last_name || undefined,
        message: pulseSmsMessage(firstName, link, kind, opts),
        type: kind === "followup" ? "pulse_check_followup" : "pulse_check",
      },
    });
    const res = await edgeResult(error, data);
    out.smsSent = res.ok;
    if (!res.ok) out.smsError = res.error;
  }

  return out;
}

export type AdminPulseSendResult =
  | {
      ok: true;
      dryRun?: boolean;
      reused: boolean;
      emailed: boolean;
      smsSent: boolean;
      emailError: string | null;
      smsError: string | null;
      entryId: string | null;
      cycleId: string | null;
    }
  | { ok: false; error: string; status: number };

/**
 * Send (or resend) a pulse check to one contractor.
 * Does not require them to be idle. Does not move the 14-day schedule.
 * If a pending unexpired entry already exists, remint that token and resend.
 */
export async function sendAdminPulseCheck(args: {
  supabase: SupabaseClient;
  cleanerId: string;
  actorId: string;
  settings: PulseCheckSettings;
  dryRun?: boolean;
}): Promise<AdminPulseSendResult> {
  const { supabase, cleanerId, actorId, settings, dryRun } = args;
  const { data: cleaner, error: cleanerErr } = await supabase
    .from("cleaners")
    .select("id, first_name, last_name, email, phone, status, sms_notifications_enabled")
    .eq("id", cleanerId)
    .maybeSingle();
  if (cleanerErr) return { ok: false, error: cleanerErr.message, status: 400 };
  if (!cleaner) return { ok: false, error: "Cleaner not found.", status: 404 };

  const blocked = pulseSendBlockedReason(cleaner.status);
  if (blocked) return { ok: false, error: blocked, status: 400 };

  const now = new Date();
  const { data: pendingRows, error: pendingErr } = await (supabase.from as any)("pulse_check_entries")
    .select("id, cycle_id, token_expires_at, outcome")
    .eq("cleaner_id", cleanerId)
    .eq("outcome", "pending")
    .order("created_at", { ascending: false })
    .limit(8);
  if (pendingErr) return { ok: false, error: pendingErr.message, status: 400 };

  const pending = ((pendingRows || []) as Array<{
    id: string;
    cycle_id: string;
    token_expires_at: string | null;
  }>).find((row) => {
    if (!row.token_expires_at) return true;
    return new Date(row.token_expires_at).getTime() > now.getTime();
  }) || null;

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      reused: Boolean(pending),
      emailed: false,
      smsSent: false,
      emailError: null,
      smsError: null,
      entryId: pending?.id || null,
      cycleId: pending?.cycle_id || null,
    };
  }

  let entryId: string;
  let cycleId: string;
  let reused = false;

  if (pending) {
    entryId = pending.id;
    cycleId = pending.cycle_id;
    reused = true;
  } else {
    const { data: cycle, error: cycleErr } = await (supabase.from as any)("pulse_check_cycles")
      .insert({
        started_at: now.toISOString(),
        interval_days: settings.interval_days,
        followup_days: settings.followup_days,
        token_ttl_days: settings.token_ttl_days,
        settings_snapshot: { ...settings, source: "admin-one", cleaner_id: cleanerId },
        counts_toward_interval: false,
        source: "admin-one",
        started_by: actorId,
        qualifying_count: 1,
      })
      .select("id")
      .single();
    if (cycleErr || !cycle) {
      return { ok: false, error: cycleErr?.message || "Could not open a one-off pulse check.", status: 400 };
    }
    const { data: entry, error: entryErr } = await (supabase.from as any)("pulse_check_entries")
      .insert({
        cycle_id: cycle.id,
        cleaner_id: cleanerId,
        outcome: "pending",
      })
      .select("id")
      .single();
    if (entryErr || !entry) {
      return { ok: false, error: entryErr?.message || "Could not create the pulse-check entry.", status: 400 };
    }
    entryId = entry.id;
    cycleId = cycle.id;
  }

  const { data: token, error: mintErr } = await (supabase.rpc as any)("mint_cleaner_pulse_token", {
    p_entry_id: entryId,
    p_ttl_days: settings.token_ttl_days,
  });
  if (mintErr || !token) {
    return { ok: false, error: mintErr?.message || "Could not mint a pulse-check link.", status: 400 };
  }

  const link = pulseCheckLink(String(token));
  const sent = await sendPulseChannels(supabase, cleaner as CleanerContact, link, "initial", {
    terminateDays: settings.no_response_terminate_days,
  });
  const reached = sent.emailed || sent.smsSent;

  await (supabase.from as any)("pulse_check_entries")
    .update({
      sent_at: now.toISOString(),
      emailed: sent.emailed,
      sms_sent: sent.smsSent,
      updated_at: now.toISOString(),
    })
    .eq("id", entryId);

  if (!reused) {
    await (supabase.from as any)("pulse_check_cycles")
      .update({
        sent_count: reached ? 1 : 0,
        completed_at: new Date().toISOString(),
      })
      .eq("id", cycleId);
  }

  const name = `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim() || "contractor";
  await supabase
    .from("events")
    .insert({
      event_type: "cleaner.pulse_sent",
      cleaner_id: cleaner.id,
      source: "admin-pulse-check",
      summary:
        `Pulse check sent to ${name}` +
        ` (email: ${sent.emailed ? "sent" : "not sent"}, SMS: ${sent.smsSent ? "sent" : "not sent"})`,
      data: {
        entry_id: entryId,
        cycle_id: cycleId,
        emailed: sent.emailed,
        sms_sent: sent.smsSent,
        reused,
        actor_id: actorId,
        source: "admin-one",
      },
    })
    .then(() => undefined, () => undefined);

  await supabase
    .from("events")
    .insert({
      event_type: "cleaner.pulse_manual_sent",
      cleaner_id: cleaner.id,
      source: "admin-pulse-check",
      summary: `Admin sent a pulse check to ${name}` + (reused ? " (resent existing link)" : ""),
      data: {
        entry_id: entryId,
        cycle_id: cycleId,
        emailed: sent.emailed,
        sms_sent: sent.smsSent,
        reused,
        actor_id: actorId,
      },
    })
    .then(() => undefined, () => undefined);

  return {
    ok: true,
    reused,
    emailed: sent.emailed,
    smsSent: sent.smsSent,
    emailError: sent.emailError,
    smsError: sent.smsError,
    entryId,
    cycleId,
  };
}

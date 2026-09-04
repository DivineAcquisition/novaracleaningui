import type { PulseDraft, PulseRosterAction, PulseTimeAway } from "@/lib/pulse-check/answers";
import { rosterActionFromDraft, timeAwayDays } from "@/lib/pulse-check/answers";

export const PULSE_REAPPLY_DAYS = 90;

export function addDaysIso(from: Date, days: number): string {
  return new Date(from.getTime() + days * 86_400_000).toISOString();
}

export function inactiveUntilFromDraft(draft: PulseDraft, now = new Date()): string | null {
  if (rosterActionFromDraft(draft) !== "inactive") return null;
  const days = timeAwayDays(draft.timeAway as PulseTimeAway);
  if (!days) return null;
  return addDaysIso(now, days);
}

export function reapplyEligibleAt(from = new Date()): string {
  return addDaysIso(from, PULSE_REAPPLY_DAYS);
}

export function isReapplyBlocked(
  cleaner: {
    status?: string | null;
    reapply_eligible_at?: string | null;
    terminated_at?: string | null;
  },
  now = new Date(),
): { blocked: boolean; until: string | null } {
  const stamped = cleaner.reapply_eligible_at ? new Date(cleaner.reapply_eligible_at) : null;
  if (stamped && !Number.isNaN(stamped.getTime()) && stamped.getTime() > now.getTime()) {
    return { blocked: true, until: stamped.toISOString() };
  }
  if (String(cleaner.status || "").toLowerCase() === "terminated" && cleaner.terminated_at) {
    const eligible = new Date(new Date(cleaner.terminated_at).getTime() + PULSE_REAPPLY_DAYS * 86_400_000);
    if (eligible.getTime() > now.getTime()) return { blocked: true, until: eligible.toISOString() };
  }
  return { blocked: false, until: null };
}

export function formatRosterDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function rosterChangeSummary(action: PulseRosterAction, draft: PulseDraft): string {
  if (action === "inactive") {
    const label = draft.timeAway === "1_week" ? "1 week" : "2 weeks";
    return `Set inactive for ${label} (personal pause from pulse check)`;
  }
  if (action === "terminate") {
    if (draft.status === "leave") {
      return "Terminated — contractor chose to leave (3-month reapply lockout)";
    }
    return "Terminated — requested a month away (3-month reapply lockout)";
  }
  return "";
}

/** Cleaner row patch for silence / no-response termination. Runner mirrors this. */
export function pulseNoResponseTerminationPatch(now: Date, silentDays = 3) {
  const iso = now.toISOString();
  const eligible = reapplyEligibleAt(now);
  const reasonLabel =
    `Terminated — no pulse-check response in ${silentDays} day${silentDays === 1 ? "" : "s"} ` +
    "(3-month reapply lockout)";
  return {
    eligible,
    reasonLabel,
    patch: {
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
    } as Record<string, unknown>,
  };
}

type Admin = {
  from: (table: string) => any;
  functions: { invoke: (name: string, args: { body: unknown }) => Promise<unknown> };
};

async function releaseFutureAssignments(admin: Admin, cleanerId: string, reason: string) {
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

export async function applyPulseRosterChange(args: {
  supabase: Admin;
  cleanerId: string;
  cleanerName: string;
  draft: PulseDraft;
  now?: Date;
}): Promise<{
  action: PulseRosterAction;
  inactiveUntil: string | null;
  reapplyEligibleAt: string | null;
  reassignedJobs: number;
}> {
  const now = args.now || new Date();
  const action = rosterActionFromDraft(args.draft);
  if (action === "none") {
    return { action, inactiveUntil: null, reapplyEligibleAt: null, reassignedJobs: 0 };
  }

  const iso = now.toISOString();
  let inactiveUntil: string | null = null;
  let eligible: string | null = null;
  let patch: Record<string, unknown>;
  let eventType: string;
  let reasonLabel: string;

  if (action === "inactive") {
    inactiveUntil = inactiveUntilFromDraft(args.draft, now);
    patch = {
      status: "inactive",
      available_for_bookings: false,
      deactivated_at: iso,
      deactivation_reason: "personal_request",
      inactive_until: inactiveUntil,
      reapply_eligible_at: null,
      updated_at: iso,
    };
    eventType = "cleaner.deactivated";
    reasonLabel = rosterChangeSummary(action, args.draft);
  } else {
    eligible = reapplyEligibleAt(now);
    const leave = args.draft.status === "leave";
    patch = {
      status: "terminated",
      available_for_bookings: false,
      approved: false,
      terminated_at: iso,
      termination_reason: leave ? "abandoned_role" : "other",
      deactivated_at: iso,
      deactivation_reason: "personal_request",
      rehire_status: "no_rehire",
      rehire_notes: `Pulse check. May reapply after ${formatRosterDate(eligible)}.`,
      reapply_eligible_at: eligible,
      inactive_until: null,
      termination_effective_date: iso.slice(0, 10),
      updated_at: iso,
    };
    eventType = "cleaner.terminated";
    reasonLabel = rosterChangeSummary(action, args.draft);
  }

  const { error } = await args.supabase.from("cleaners").update(patch).eq("id", args.cleanerId);
  if (error) throw new Error(error.message);

  const reassignedJobs = await releaseFutureAssignments(args.supabase, args.cleanerId, `pulse_check:${action}`);

  if (action === "terminate") {
    await args.supabase
      .from("cleaner_terminations")
      .insert({
        cleaner_id: args.cleanerId,
        reason: args.draft.status === "leave" ? "voluntary_resignation" : "other",
        reason_label: reasonLabel,
        rehire_status: "no_rehire",
        notes: `Self-serve pulse check. Reapply after ${formatRosterDate(eligible)}.`,
        effective_date: iso.slice(0, 10),
        letter_sent: false,
      })
      .then(() => undefined, () => undefined);
  }

  await args.supabase
    .from("events")
    .insert({
      event_type: eventType,
      cleaner_id: args.cleanerId,
      source: "pulse-check",
      summary: `${args.cleanerName || "Contractor"}: ${reasonLabel}`,
      data: {
        source: "pulse-check",
        roster_action: action,
        time_away: args.draft.timeAway || null,
        inactive_until: inactiveUntil,
        reapply_eligible_at: eligible,
        reassigned_jobs: reassignedJobs,
      },
    })
    .then(() => undefined, () => undefined);

  args.supabase.functions
    .invoke("sync-cleaner-to-ghl", { body: { cleanerId: args.cleanerId } })
    .then(() => undefined, () => undefined);

  return { action, inactiveUntil, reapplyEligibleAt: eligible, reassignedJobs };
}

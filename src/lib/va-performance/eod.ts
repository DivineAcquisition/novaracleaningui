// ─── EOD submission service (server only) ─────────────────────────────────────
//
// One submission per VA per day. Opening the same day again edits the existing
// submission until it locks. Identity always comes from the verified session —
// a VA never types who they are.
//
// The division of responsibility is the whole point of the design:
//   * va_verified_metrics holds what the system observed. The VA cannot write
//     to it, and nothing in this file ever does.
//   * va_eod_submissions holds what the VA supplied — Tier 2 numbers and
//     Tier 3 text, and nothing else.
// Comparison happens at submit time and produces flags. The two records are
// never merged.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  CORE_TEXT_KEYS,
  sanitizeSelfReported,
  sanitizeTaskNotes,
  TASK_IDS,
  validateSubmission,
  type ValidationIssue,
} from "./catalog";
import { runDiscrepancyCheck, type PersistedFlag } from "./discrepancy";
import type { MetricValues } from "./metrics";
import {
  allowedWorkDates,
  cutoffMinutes,
  getEodSettings,
  localDate,
  localMinutes,
  type EodSettings,
} from "./settings";
import { dayWindow } from "./time";
import {
  collectDay,
  emptyVerifiedDay,
  readVerifiedDay,
  writeVerifiedDays,
  type StoredVerifiedDay,
} from "./verify";
import type { VaRecord } from "./vas";

/** How stale a verified row may be before the form refreshes it on open. */
const REFRESH_AFTER_MINUTES = 20;

export interface EodSubmission {
  id: string;
  vaId: string;
  workDate: string;
  status: "draft" | "submitted" | "reviewed" | "flagged";
  tasksSelected: string[];
  selfReported: Record<string, number>;
  taskNotes: Record<string, string | string[]>;
  blockers: string | null;
  priorities: string | null;
  wins: string | null;
  escalations: string | null;
  submittedAt: string | null;
  submittedLate: boolean;
  lockedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  updatedAt: string;
}

export function mapSubmission(row: Record<string, unknown>): EodSubmission {
  return {
    id: String(row.id),
    vaId: String(row.va_id),
    workDate: String(row.work_date),
    status: String(row.status || "draft") as EodSubmission["status"],
    tasksSelected: Array.isArray(row.tasks_selected) ? (row.tasks_selected as string[]) : [],
    selfReported: (row.self_reported as Record<string, number>) || {},
    taskNotes: (row.task_notes as Record<string, string | string[]>) || {},
    blockers: (row.blockers as string) ?? null,
    priorities: (row.priorities as string) ?? null,
    wins: (row.wins as string) ?? null,
    escalations: (row.escalations as string) ?? null,
    submittedAt: (row.submitted_at as string) ?? null,
    submittedLate: Boolean(row.submitted_late),
    lockedAt: (row.locked_at as string) ?? null,
    reviewedAt: (row.reviewed_at as string) ?? null,
    reviewNote: (row.review_note as string) ?? null,
    updatedAt: String(row.updated_at || row.created_at || new Date().toISOString()),
  };
}

export class EodError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "EodError";
  }
}

/** A date is openable when it's inside the admin-configured backdate window. */
export function assertDateAllowed(date: string, settings: EodSettings, now = new Date()): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new EodError("Invalid date.");
  const allowed = allowedWorkDates(settings, now);
  if (!allowed.includes(date)) {
    const window =
      settings.backdateDays === 0
        ? "today"
        : settings.backdateDays === 1
          ? "today or yesterday"
          : `the last ${settings.backdateDays + 1} days`;
    throw new EodError(`You can only submit an EOD for ${window}.`, 403);
  }
}

/** A day locks to the VA some hours after it ends. Admins can still review it. */
export function isLocked(
  submission: EodSubmission | null,
  workDate: string,
  settings: EodSettings,
  now = new Date(),
): boolean {
  if (submission?.lockedAt) return true;
  const { end } = dayWindow(workDate, settings.timezone);
  return now.getTime() > end.getTime() + settings.lockAfterHours * 3600000;
}

export function wasSubmittedLate(settings: EodSettings, workDate: string, at = new Date()): boolean {
  const submittedOn = localDate(at, settings.timezone);
  if (submittedOn > workDate) return true;
  if (submittedOn < workDate) return false;
  return localMinutes(at, settings.timezone) > cutoffMinutes(settings);
}

// ─── Draft lifecycle ──────────────────────────────────────────────────────────

async function findSubmission(vaId: string, workDate: string): Promise<EodSubmission | null> {
  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("va_eod_submissions")
    .select("*")
    .eq("va_id", vaId)
    .eq("work_date", workDate)
    .maybeSingle();
  if (error) throw new EodError(`Could not load your EOD: ${error.message}`, 500);
  return data ? mapSubmission(data as Record<string, unknown>) : null;
}

async function createDraft(vaId: string, workDate: string): Promise<EodSubmission> {
  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("va_eod_submissions")
    .insert({ va_id: vaId, work_date: workDate, status: "draft" })
    .select("*")
    .single();
  if (error) {
    // A concurrent tab may have created it first — the unique constraint is
    // the guarantee of one-per-day, so just read theirs.
    const existing = await findSubmission(vaId, workDate);
    if (existing) return existing;
    throw new EodError(`Could not start your EOD: ${error.message}`, 500);
  }
  return mapSubmission(data as Record<string, unknown>);
}

/**
 * Verified metrics for the day, refreshed if stale. A refresh failure is never
 * fatal: the VA still gets the form, with the affected fields marked
 * unverified rather than blank or zero.
 */
async function verifiedForForm(va: VaRecord, workDate: string): Promise<StoredVerifiedDay> {
  const existing = await readVerifiedDay(va.id, workDate);
  const staleAt = Date.now() - REFRESH_AFTER_MINUTES * 60000;
  const isStale =
    !existing || !existing.lastSyncedAt || Date.parse(existing.lastSyncedAt) < staleAt;

  if (isStale) {
    try {
      const { rows } = await collectDay(workDate, [va]);
      if (rows.length) {
        await writeVerifiedDays(rows);
        const refreshed = await readVerifiedDay(va.id, workDate);
        if (refreshed) return refreshed;
      }
    } catch {
      /* fall back to whatever we already had */
    }
  }

  return existing ?? emptyVerifiedDay(va.id, workDate);
}

export interface BootstrapResult {
  va: { id: string; name: string; email: string; functionsAssigned: string[] };
  workDate: string;
  allowedDates: string[];
  settings: EodSettings;
  submission: EodSubmission;
  verified: StoredVerifiedDay;
  locked: boolean;
  flags: FlagSummary[];
}

export interface FlagSummary {
  id: string;
  metricKey: string;
  metricLabel: string | null;
  selfReported: number | null;
  verified: number | null;
  variance: number | null;
  variancePct: number | null;
  severity: string;
  status: string;
  vaExplanation: string | null;
  reviewNote: string | null;
  workDate: string;
  createdAt: string;
}

function mapFlag(row: Record<string, unknown>): FlagSummary {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: String(row.id),
    metricKey: String(row.metric_key),
    metricLabel: (row.metric_label as string) ?? null,
    selfReported: num(row.self_reported),
    verified: num(row.verified),
    variance: num(row.variance),
    variancePct: num(row.variance_pct),
    severity: String(row.severity || "low"),
    status: String(row.status || "open"),
    vaExplanation: (row.va_explanation as string) ?? null,
    reviewNote: (row.review_note as string) ?? null,
    workDate: String(row.work_date),
    createdAt: String(row.created_at),
  };
}

async function flagsForVa(vaId: string, limit = 20): Promise<FlagSummary[]> {
  const supabase = getAdminSupabase();
  const { data } = await supabase
    .from("va_discrepancy_flags")
    .select("*")
    .eq("va_id", vaId)
    .order("work_date", { ascending: false })
    .limit(limit);
  return ((data || []) as Record<string, unknown>[]).map(mapFlag);
}

/** Open (or resume) the form for a date. */
export async function bootstrapEod(va: VaRecord, requestedDate?: string): Promise<BootstrapResult> {
  const settings = await getEodSettings();
  const now = new Date();
  const workDate = requestedDate || localDate(now, settings.timezone);
  assertDateAllowed(workDate, settings, now);

  const submission = (await findSubmission(va.id, workDate)) ?? (await createDraft(va.id, workDate));
  const verified = await verifiedForForm(va, workDate);

  return {
    va: { id: va.id, name: va.name, email: va.email, functionsAssigned: va.functionsAssigned },
    workDate,
    allowedDates: allowedWorkDates(settings, now),
    settings,
    submission,
    verified,
    locked: isLocked(submission, workDate, settings, now),
    flags: await flagsForVa(va.id),
  };
}

export interface SavePatch {
  tasksSelected?: string[];
  selfReported?: Record<string, unknown>;
  taskNotes?: Record<string, unknown>;
  blockers?: string;
  priorities?: string;
  wins?: string;
  escalations?: string;
}

function buildPatch(patch: SavePatch, tasks: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.tasksSelected) out.tasks_selected = tasks;
  if (patch.selfReported) out.self_reported = sanitizeSelfReported(tasks, patch.selfReported);
  if (patch.taskNotes) out.task_notes = sanitizeTaskNotes(tasks, patch.taskNotes);
  for (const key of CORE_TEXT_KEYS) {
    const value = patch[key];
    if (value !== undefined) out[key] = String(value ?? "").slice(0, 4000) || null;
  }
  return out;
}

/** Auto-save. Draft only — a submitted day is edited by re-submitting. */
export async function saveDraft(va: VaRecord, workDate: string, patch: SavePatch): Promise<EodSubmission> {
  const settings = await getEodSettings();
  assertDateAllowed(workDate, settings);

  const submission = await findSubmission(va.id, workDate);
  if (!submission) throw new EodError("No EOD open for that date.", 404);
  if (isLocked(submission, workDate, settings)) {
    throw new EodError("This day is locked. Ask an admin if it needs to change.", 403);
  }

  const tasks = (patch.tasksSelected ?? submission.tasksSelected).filter((t) => TASK_IDS.includes(t));
  const update = buildPatch(patch, tasks);
  if (Object.keys(update).length === 0) return submission;

  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("va_eod_submissions")
    .update(update)
    .eq("id", submission.id)
    .select("*")
    .single();
  if (error) throw new EodError(`Couldn't save: ${error.message}`, 500);
  return mapSubmission(data as Record<string, unknown>);
}

export interface SubmitResult {
  submission: EodSubmission;
  flags: PersistedFlag[];
  issues: ValidationIssue[];
  verified: StoredVerifiedDay;
}

/**
 * Submit the day: persist the VA's answers, snapshot the verified numbers they
 * reviewed, then compare Tier 2 against its corroborating signal.
 *
 * The submission always completes. A source being down produces unverified
 * fields and fewer comparisons — never a blocked submit.
 */
export async function submitEod(
  va: VaRecord,
  workDate: string,
  patch: SavePatch,
): Promise<SubmitResult> {
  const settings = await getEodSettings();
  const now = new Date();
  assertDateAllowed(workDate, settings, now);

  const existing = await findSubmission(va.id, workDate);
  if (!existing) throw new EodError("No EOD open for that date.", 404);
  if (isLocked(existing, workDate, settings, now)) {
    throw new EodError("This day is locked. Ask an admin if it needs to change.", 403);
  }

  const tasks = (patch.tasksSelected ?? existing.tasksSelected).filter((t) => TASK_IDS.includes(t));
  const selfReported = sanitizeSelfReported(tasks, patch.selfReported ?? existing.selfReported);
  const taskNotes = sanitizeTaskNotes(tasks, patch.taskNotes ?? existing.taskNotes);

  const issues = validateSubmission({ tasksSelected: tasks, selfReported, taskNotes });
  if (issues.length) return { submission: existing, flags: [], issues, verified: await verifiedForForm(va, workDate) };

  // Refresh once more so the comparison uses the freshest signal available.
  const verified = await verifiedForForm(va, workDate);

  const supabase = getAdminSupabase();
  const update: Record<string, unknown> = {
    ...buildPatch({ ...patch, tasksSelected: tasks, selfReported, taskNotes }, tasks),
    tasks_selected: tasks,
    self_reported: selfReported,
    task_notes: taskNotes,
    status: "submitted",
    submitted_at: now.toISOString(),
    submitted_late: wasSubmittedLate(settings, workDate, now),
    verified_snapshot: {
      values: verified.values,
      provenance: verified.provenance,
      sourceStatus: verified.sourceStatus,
      capturedAt: now.toISOString(),
    },
  };

  const { data, error } = await supabase
    .from("va_eod_submissions")
    .update(update)
    .eq("id", existing.id)
    .select("*")
    .single();
  if (error) throw new EodError(`Couldn't submit: ${error.message}`, 500);
  let submission = mapSubmission(data as Record<string, unknown>);

  const flags = await runDiscrepancyCheck({
    submissionId: submission.id,
    vaId: va.id,
    workDate,
    tasksSelected: tasks,
    selfReported,
    verified: verified.values as MetricValues,
  });

  if (flags.length) {
    const { data: flagged } = await supabase
      .from("va_eod_submissions")
      .update({ status: "flagged" })
      .eq("id", submission.id)
      .select("*")
      .single();
    if (flagged) submission = mapSubmission(flagged as Record<string, unknown>);
  }

  await announceSubmission(va, submission, flags);

  return { submission, flags, issues: [], verified };
}

/** The VA answers the flag before anyone concludes anything from it. */
export async function explainFlag(
  va: VaRecord,
  flagId: string,
  explanation: string,
): Promise<FlagSummary> {
  const text = explanation.trim();
  if (!text) throw new EodError("Add a short explanation.");

  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("va_discrepancy_flags")
    .update({
      va_explanation: text.slice(0, 4000),
      va_explained_at: new Date().toISOString(),
      // Status moves to "explained" — an admin still decides the outcome.
      status: "explained",
    })
    .eq("id", flagId)
    .eq("va_id", va.id)
    .in("status", ["open", "explained"])
    .select("*")
    .maybeSingle();
  if (error) throw new EodError(`Couldn't save your explanation: ${error.message}`, 500);
  if (!data) throw new EodError("That flag has already been reviewed.", 409);
  return mapFlag(data as Record<string, unknown>);
}

// ─── Notification ─────────────────────────────────────────────────────────────
//
// Rides the existing events → discord_routes fan-out. Admin is notified of
// every submission, and separately of Medium/High discrepancies.

async function announceSubmission(
  va: VaRecord,
  submission: EodSubmission,
  flags: PersistedFlag[],
): Promise<void> {
  const supabase = getAdminSupabase();
  const notable = flags.filter((f) => f.severity === "medium" || f.severity === "high");

  try {
    await supabase.from("events").insert({
      event_type: "va.eod.submitted",
      source: "eod-form",
      summary:
        `EOD — ${va.name} for ${submission.workDate}` +
        `${submission.submittedLate ? " (late)" : ""}` +
        `${flags.length ? ` · ${flags.length} discrepancy flag${flags.length === 1 ? "" : "s"}` : ""}`,
      data: {
        va_id: va.id,
        va_name: va.name,
        work_date: submission.workDate,
        tasks: submission.tasksSelected,
        late: submission.submittedLate,
        flags: flags.length,
      },
    });
  } catch {
    /* a notification failure must never fail a submission */
  }

  if (!notable.length) return;
  try {
    await supabase.from("events").insert({
      event_type: "va.discrepancy.flagged",
      source: "eod-form",
      summary:
        `Discrepancy review — ${va.name}, ${submission.workDate}: ` +
        notable
          .map((f) => `${f.metricLabel} reported ${f.selfReported} vs ${f.verified} observed (${f.severity})`)
          .join("; ") +
        " — asks for an explanation, decide after.",
      data: {
        va_id: va.id,
        va_name: va.name,
        work_date: submission.workDate,
        flags: notable.map((f) => ({
          metric: f.metricKey,
          severity: f.severity,
          self_reported: f.selfReported,
          verified: f.verified,
          variance_pct: f.variancePct,
        })),
      },
    });
  } catch {
    /* same — never block on notification */
  }
}

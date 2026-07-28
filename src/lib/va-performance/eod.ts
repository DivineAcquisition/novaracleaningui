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
  FREE_TEXT_KEYS,
  isUrgent,
  sanitizeMetrics,
  sanitizeSelects,
  sanitizeText,
  validateSubmission,
  type ValidationIssue,
} from "./catalog";
import { runDiscrepancyCheck, type PersistedFlag } from "./discrepancy";
import { generateEodReport } from "./eod-report";
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
  /** The ten entered metrics, keyed by metric field key. Money is in cents. */
  metrics: Record<string, number>;
  /** The four single-select answers, keyed by select field key. */
  selects: Record<string, string>;
  blockers: string | null;
  escalations: string | null;
  cleanerIssueNotes: string | null;
  priorities: string | null;
  wins: string | null;
  submittedAt: string | null;
  submittedLate: boolean;
  lockedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  pdfStatus: string;
  pdfPath: string | null;
  driveUrl: string | null;
  updatedAt: string;
}

export function mapSubmission(row: Record<string, unknown>): EodSubmission {
  return {
    id: String(row.id),
    vaId: String(row.va_id),
    workDate: String(row.work_date),
    status: String(row.status || "draft") as EodSubmission["status"],
    metrics: (row.self_reported as Record<string, number>) || {},
    selects: {
      primary_focus: (row.primary_focus as string) || "",
      blockers_level: (row.blockers_level as string) || "",
      management_attention: (row.management_attention as string) || "",
      cleaner_issues: (row.cleaner_issues as string) || "",
    },
    blockers: (row.blockers as string) ?? null,
    escalations: (row.escalations as string) ?? null,
    cleanerIssueNotes: (row.cleaner_issue_notes as string) ?? null,
    priorities: (row.priorities as string) ?? null,
    wins: (row.wins as string) ?? null,
    submittedAt: (row.submitted_at as string) ?? null,
    submittedLate: Boolean(row.submitted_late),
    lockedAt: (row.locked_at as string) ?? null,
    reviewedAt: (row.reviewed_at as string) ?? null,
    reviewNote: (row.review_note as string) ?? null,
    pdfStatus: String(row.pdf_status || "none"),
    pdfPath: (row.pdf_path as string) ?? null,
    driveUrl: (row.drive_url as string) ?? null,
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

/**
 * Which day this caller is allowed to touch.
 *
 * A VA never chooses. Their link is bound to one date, so `allowedDate` is
 * simply that date; a workspace-session VA gets today and nothing else. Only an
 * admin may act on another day, which is what makes "admins send EODs for other
 * days" an enforced rule rather than a convention.
 */
export interface DateGrant {
  allowedDate: string;
  /** An admin acting on any date, e.g. reviewing or backfilling. */
  isAdmin: boolean;
}

export function assertDateAllowed(date: string, grant: DateGrant): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new EodError("Invalid date.");
  if (grant.isAdmin) return;
  if (date !== grant.allowedDate) {
    throw new EodError(
      "This link is only for " +
        grant.allowedDate +
        ". Ask an admin if you need to file a different day.",
      403,
    );
  }
}

/** How far back an ADMIN may issue a link. VAs are unaffected by this. */
export function assertAdminIssuableDate(date: string, settings: EodSettings, now = new Date()): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new EodError("Invalid date.");
  const today = localDate(now, settings.timezone);
  if (date > today) throw new EodError("Can't issue an EOD link for a future day.", 400);
  const earliest = allowedWorkDates(settings, now).slice(-1)[0];
  if (date < earliest) {
    throw new EodError(
      `The backdate window is ${settings.backdateDays + 1} day(s) — ${date} is outside it.`,
      400,
    );
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
export async function bootstrapEod(
  va: VaRecord,
  grant: DateGrant,
  requestedDate?: string,
): Promise<BootstrapResult> {
  const settings = await getEodSettings();
  const now = new Date();
  const workDate = requestedDate || grant.allowedDate;
  assertDateAllowed(workDate, grant);

  const submission = (await findSubmission(va.id, workDate)) ?? (await createDraft(va.id, workDate));
  const verified = await verifiedForForm(va, workDate);

  return {
    va: { id: va.id, name: va.name, email: va.email, functionsAssigned: va.functionsAssigned },
    workDate,
    // A link holder gets exactly their day. Admins may move between days.
    allowedDates: grant.isAdmin ? allowedWorkDates(settings, now) : [workDate],
    settings,
    submission,
    verified,
    locked: isLocked(submission, workDate, settings, now),
    flags: await flagsForVa(va.id),
  };
}

export interface SavePatch {
  metrics?: Record<string, unknown>;
  selects?: Record<string, unknown>;
  text?: Record<string, unknown>;
}

/** Merge a patch onto what's already stored, so a partial autosave never wipes. */
function mergedState(submission: EodSubmission, patch: SavePatch) {
  const metrics = { ...submission.metrics, ...sanitizeMetrics(patch.metrics || {}) };
  const selects = { ...submission.selects, ...sanitizeSelects(patch.selects || {}) };
  const text: Record<string, string> = {
    blockers: submission.blockers ?? "",
    escalations: submission.escalations ?? "",
    cleaner_issue_notes: submission.cleanerIssueNotes ?? "",
    priorities: submission.priorities ?? "",
    wins: submission.wins ?? "",
    ...sanitizeText(patch.text || {}),
  };
  return { metrics, selects, text };
}

function toRow(state: ReturnType<typeof mergedState>): Record<string, unknown> {
  return {
    self_reported: state.metrics,
    primary_focus: state.selects.primary_focus || null,
    blockers_level: state.selects.blockers_level || null,
    management_attention: state.selects.management_attention || null,
    cleaner_issues: state.selects.cleaner_issues || null,
    ...Object.fromEntries(FREE_TEXT_KEYS.map((k) => [k, state.text[k]?.trim() ? state.text[k] : null])),
  };
}

/** Auto-save. Draft only — a submitted day is edited by re-submitting. */
export async function saveDraft(
  va: VaRecord,
  workDate: string,
  patch: SavePatch,
  grant: DateGrant,
): Promise<EodSubmission> {
  const settings = await getEodSettings();
  assertDateAllowed(workDate, grant);

  const submission = await findSubmission(va.id, workDate);
  if (!submission) throw new EodError("No EOD open for that date.", 404);
  if (isLocked(submission, workDate, settings)) {
    throw new EodError("This day is locked. Ask an admin if it needs to change.", 403);
  }

  const update = toRow(mergedState(submission, patch));

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
  grant: DateGrant,
): Promise<SubmitResult> {
  const settings = await getEodSettings();
  const now = new Date();
  assertDateAllowed(workDate, grant);

  const existing = await findSubmission(va.id, workDate);
  if (!existing) throw new EodError("No EOD open for that date.", 404);
  if (isLocked(existing, workDate, settings, now)) {
    throw new EodError("This day is locked. Ask an admin if it needs to change.", 403);
  }

  const state = mergedState(existing, patch);
  const issues = validateSubmission({
    metrics: state.metrics,
    selects: state.selects,
    text: state.text,
  });
  if (issues.length) {
    return { submission: existing, flags: [], issues, verified: await verifiedForForm(va, workDate) };
  }

  // Refresh once more so the comparison uses the freshest signal available.
  const verified = await verifiedForForm(va, workDate);

  const supabase = getAdminSupabase();
  const update: Record<string, unknown> = {
    ...toRow(state),
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
    selfReported: state.metrics,
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

  // The submission is saved and flagged by this point. The PDF renders FROM
  // the saved row, so a generation or Drive failure is flagged for retry and
  // never costs the VA their work.
  const report = await generateEodReport(submission, va);
  if (report.ok || report.error) {
    const { data: stamped } = await getAdminSupabase()
      .from("va_eod_submissions")
      .select("*")
      .eq("id", submission.id)
      .maybeSingle();
    if (stamped) submission = mapSubmission(stamped as Record<string, unknown>);
  }

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

  // "Urgent" for management, or "Serious" on cleaner issues, goes out the
  // moment it's submitted. Those shouldn't wait for someone to open a
  // dashboard, so they get their own event rather than riding the daily digest.
  const urgent = isUrgent(submission.selects);
  if (urgent.length) {
    const detail = urgent
      .map((f) => {
        const answer = submission.selects[f.key];
        const note =
          f.followUp?.key === "escalations"
            ? submission.escalations
            : f.followUp?.key === "cleaner_issue_notes"
              ? submission.cleanerIssueNotes
              : null;
        return `${f.label}: ${answer}${note ? ` — ${note}` : ""}`;
      })
      .join("; ");
    try {
      await supabase.from("events").insert({
        event_type: "va.eod.urgent",
        source: "eod-form",
        summary: `Needs attention now — ${va.name}, ${submission.workDate}: ${detail}`,
        data: {
          va_id: va.id,
          va_name: va.name,
          work_date: submission.workDate,
          management_attention: submission.selects.management_attention,
          cleaner_issues: submission.selects.cleaner_issues,
          escalations: submission.escalations,
          cleaner_issue_notes: submission.cleanerIssueNotes,
        },
      });
    } catch {
      /* never block a submission on a notification */
    }
  }

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
        focus: submission.selects.primary_focus,
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

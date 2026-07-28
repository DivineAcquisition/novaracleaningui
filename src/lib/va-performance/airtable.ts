// ─── Airtable mirror: "Novara — Team Performance" ─────────────────────────────
//
// Provisions the base (idempotently) and pushes the seven tables from Supabase.
//
// Direction is strictly one-way: Supabase → Airtable. The base is a reporting
// and reference surface, not a management one. Nothing is ever read back, so a
// human typing into the Verified Metrics table cannot corrupt the source of
// truth — the next sync simply restores it.
//
// Every write is an upsert merged on the record's natural key, so re-running a
// sync updates in place and never duplicates.

import {
  getBaseId,
  createField,
  createLinkField,
  createTable,
  createBase,
  listBases,
  listBaseTables,
  listTableFields,
  upsertRecords,
  type Fields,
} from "@/lib/airtable/client";
import { primeAirtablePat } from "@/lib/airtable/sources/prime-pat";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { TASKS_BY_ID } from "./catalog";
import { METRICS, type MetricKey } from "./metrics";
import { primePerformanceSecrets, saveSecret } from "./settings";
import { listAllVas, type VaRecord } from "./vas";
import {
  TEAM_PERF_BASE_NAME,
  TEAM_PERF_TABLES,
  type TeamPerfTableKey,
} from "./airtable-schema";

export interface BaseHandle {
  baseId: string;
  /** tableKey → { tableId, fieldId: { fieldName → fieldId } } */
  tables: Record<TeamPerfTableKey, { tableId: string; fieldId: Record<string, string> }>;
  created: boolean;
}

export class TeamPerfAirtableError extends Error {}

async function resolveBaseId(): Promise<string | null> {
  await primePerformanceSecrets();
  const fromEnv = (process.env.AIRTABLE_TEAM_PERF_BASE_ID || "").trim();
  if (fromEnv) return fromEnv;

  // A separate base may already exist from a previous run whose secret write
  // failed. Only reachable if the PAT has workspace scope.
  try {
    const bases = await listBases();
    const match = bases.find((b) => b.name === TEAM_PERF_BASE_NAME);
    if (match) {
      await saveSecret("AIRTABLE_TEAM_PERF_BASE_ID", match.id);
      return match.id;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Create the base and every table/field/link that isn't already there.
 * Safe to run repeatedly: existing tables and fields are left alone.
 */
export async function ensureTeamPerformanceBase(): Promise<BaseHandle> {
  await primeAirtablePat();
  await primePerformanceSecrets();

  let baseId = await resolveBaseId();
  let created = false;

  if (!baseId) {
    const workspaceId = (process.env.AIRTABLE_WORKSPACE_ID || "").trim();
    if (workspaceId) {
      // A workspace id was supplied, so give Team Performance its own base.
      const first = TEAM_PERF_TABLES[0];
      const base = await createBase(workspaceId, TEAM_PERF_BASE_NAME, {
        name: first.name,
        description: first.description,
        fields: first.fields,
      });
      baseId = base.id;
      created = true;
    } else {
      // Default: build the tables inside the Client & Revenue Ops base, the
      // same way every other Airtable integration here does (Contractors, QC
      // Issues, VAs are all created in-place via the Meta API). Airtable's
      // create-base endpoint needs a workspace id that a base-scoped PAT can't
      // enumerate, and there is no reason to block on that — the tables and
      // their links work identically in the existing base.
      baseId = getBaseId();
    }
    await saveSecret("AIRTABLE_TEAM_PERF_BASE_ID", baseId);
  }

  // ── Tables ──────────────────────────────────────────────────────────────
  let existing = await listBaseTables(baseId);
  const byName = new Map(existing.map((t) => [t.name, t]));

  for (const spec of TEAM_PERF_TABLES) {
    if (byName.has(spec.name)) continue;
    const table = await createTable(spec.name, spec.fields, spec.description, baseId);
    byName.set(spec.name, table);
  }

  // ── Missing fields on pre-existing tables ───────────────────────────────
  for (const spec of TEAM_PERF_TABLES) {
    const table = byName.get(spec.name);
    if (!table) continue;
    const have = new Set((await listTableFields(table.id, baseId)).map((f) => f.name));
    for (const field of spec.fields) {
      if (!have.has(field.name)) await createField(table.id, field, baseId);
    }
  }

  // ── Links (every table must exist first) ────────────────────────────────
  existing = await listBaseTables(baseId);
  const refreshed = new Map(existing.map((t) => [t.name, t]));
  const idFor = (key: TeamPerfTableKey) =>
    refreshed.get(TEAM_PERF_TABLES.find((t) => t.key === key)!.name)?.id;

  for (const spec of TEAM_PERF_TABLES) {
    const table = refreshed.get(spec.name);
    if (!table || !spec.links) continue;
    const have = new Set(table.fields.map((f) => f.name));
    for (const link of spec.links) {
      if (have.has(link.name)) continue;
      const target = idFor(link.to);
      if (!target) continue;
      await createLinkField(table.id, link.name, target, baseId);
    }
  }

  // ── Final field-id map ──────────────────────────────────────────────────
  const finalTables = await listBaseTables(baseId);
  const tables = {} as BaseHandle["tables"];
  for (const spec of TEAM_PERF_TABLES) {
    const table = finalTables.find((t) => t.name === spec.name);
    if (!table) {
      throw new TeamPerfAirtableError(`Table "${spec.name}" is missing after provisioning.`);
    }
    tables[spec.key] = {
      tableId: table.id,
      fieldId: Object.fromEntries(table.fields.map((f) => [f.name, f.id])),
    };
  }

  return { baseId, tables, created };
}

// ─── Value helpers ────────────────────────────────────────────────────────────

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const titleCase = (s: string) =>
  s
    .split(/[_\s]+/)
    .filter(Boolean)
    .map(cap)
    .join(" ");

const money = (cents: unknown) =>
  cents === null || cents === undefined ? undefined : Number(cents) / 100;

const numeric = (v: unknown) => (v === null || v === undefined ? undefined : Number(v));

const iso = (v: unknown) => (v ? String(v) : undefined);

const dateOnly = (v: unknown) => (v ? String(v).slice(0, 10) : undefined);

/** Pretty-print a jsonb blob for a long-text mirror column. */
function pretty(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return undefined;
  return entries.map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join("\n");
}

export interface TeamPerfSyncResult {
  baseId: string;
  baseCreated: boolean;
  counts: Record<string, number>;
  warnings: string[];
}

export interface SyncWindow {
  startDate: string;
  endDate: string;
}

/**
 * Push Supabase → Airtable for the window. Records are written parents-first
 * (VAs, then metrics, then submissions, then flags) so link fields always have
 * something to point at.
 */
export async function syncTeamPerformanceBase(window: SyncWindow): Promise<TeamPerfSyncResult> {
  const handle = await ensureTeamPerformanceBase();
  const supabase = getAdminSupabase();
  const warnings: string[] = [];
  const counts: Record<string, number> = {};
  const now = new Date().toISOString();

  // ── 1. VAs ──────────────────────────────────────────────────────────────
  const vas = await listAllVas();
  const vaTable = handle.tables.vas;
  const F = vaTable.fieldId;

  // Only fields this layer owns — see the note on the VAs spec. Phone, Status,
  // Pay Type and Notes belong to the onboarding sync and are left alone.
  const vaRecords: Fields[] = vas
    .filter((v) => v.email)
    .map((va) => ({
      [F["Email"]]: va.email,
      [F["Name"]]: va.name,
      [F["Performance Status"]]: titleCase(va.performanceStatus),
      [F["Rate"]]: money(va.rateCents),
      [F["Start Date"]]: dateOnly(va.startDate),
      [F["Functions Assigned"]]: va.functionsAssigned.length
        ? va.functionsAssigned.map(titleCase)
        : undefined,
      [F["Apploye Member ID"]]: va.apployeMemberId ?? undefined,
      [F["Workspace User ID"]]: va.workspaceUserId ?? undefined,
      [F["Perf Last Synced"]]: now,
    }));

  const vaUpsert = await upsertRecords(vaTable.tableId, [F["Email"]], vaRecords, {
    baseId: handle.baseId,
  });
  counts.vas = vaUpsert.records.length;

  // Airtable link fields are written by the linked record's PRIMARY value —
  // Email for VAs — with typecast resolving it to the record.
  const vaEmailById = new Map(vas.map((v) => [v.id, v.email]));
  const vaNameById = new Map(vas.map((v) => [v.id, v.name]));
  const linkToVa = (vaId: string) => {
    const email = vaEmailById.get(vaId);
    return email ? [email] : undefined;
  };

  // Store the Airtable record id back so the workspace can deep-link.
  for (const record of vaUpsert.records) {
    const email = String(record.fields?.[F["Email"]] || "").toLowerCase();
    const va = vas.find((v) => v.email.toLowerCase() === email);
    if (va && va.perfAirtableRecordId !== record.id) {
      await supabase
        .from("va_onboarding")
        .update({ perf_airtable_record_id: record.id })
        .eq("id", va.id);
    }
  }

  // ── 2. Verified Metrics ─────────────────────────────────────────────────
  const { data: metricRows, error: metricErr } = await supabase
    .from("va_verified_metrics")
    .select("*")
    .gte("work_date", window.startDate)
    .lte("work_date", window.endDate);
  if (metricErr) warnings.push(`Verified metrics: ${metricErr.message}`);

  const VM = handle.tables.verifiedMetrics.fieldId;
  const metricRef = (vaId: string, date: string) =>
    `VM-${(vaNameById.get(vaId) || vaId).replace(/\s+/g, "").slice(0, 12)}-${date}`;

  // Only link a submission to a metrics row that actually exists — writing the
  // ref with typecast on would otherwise CREATE an empty Verified Metrics
  // record, and an empty row in the source-of-truth table reads like a zero.
  const metricRefsWritten = new Set<string>();

  const metricRecords: Fields[] = ((metricRows || []) as Record<string, unknown>[]).map((row) => ({
    [VM["Metric ID"]]: metricRef(String(row.va_id), String(row.work_date)),
    [VM["VA"]]: linkToVa(String(row.va_id)),
    [VM["Date"]]: String(row.work_date),
    [VM["Hours Tracked"]]: numeric(row.hours_tracked),
    [VM["Calls Placed"]]: numeric(row.calls_placed),
    [VM["Conversations Connected"]]: numeric(row.conversations_connected),
    [VM["SMS Sent"]]: numeric(row.sms_sent),
    [VM["Inbound Leads"]]: numeric(row.inbound_leads),
    [VM["Leads Responded"]]: numeric(row.leads_responded),
    [VM["Median Response Time (s)"]]: numeric(row.median_response_seconds),
    [VM["Leads Converted"]]: numeric(row.leads_converted),
    [VM["Bookings Created"]]: numeric(row.bookings_created),
    [VM["Revenue Booked"]]: money(row.revenue_booked_cents),
    [VM["Revenue Collected"]]: money(row.revenue_collected_cents),
    [VM["Quotes Sent"]]: numeric(row.quotes_sent),
    [VM["Applications Reviewed"]]: numeric(row.applications_reviewed),
    [VM["Phone Screens Completed"]]: numeric(row.phone_screens_completed),
    [VM["Onboarding Launched"]]: numeric(row.onboarding_launched),
    [VM["Cleaners Activated"]]: numeric(row.cleaners_activated),
    [VM["Commercial Accounts Touched"]]: numeric(row.commercial_accounts_touched),
    [VM["Walkthroughs Booked"]]: numeric(row.walkthroughs_booked),
    [VM["Source Sync Status"]]: describeSourceStatus(row.source_status),
    [VM["Last Synced"]]: iso(row.last_synced_at) || now,
  }));

  if (metricRecords.length) {
    const res = await upsertRecords(
      handle.tables.verifiedMetrics.tableId,
      [VM["Metric ID"]],
      metricRecords,
      { baseId: handle.baseId },
    );
    counts.verifiedMetrics = res.records.length;
    for (const row of (metricRows || []) as Record<string, unknown>[]) {
      metricRefsWritten.add(metricRef(String(row.va_id), String(row.work_date)));
    }
  }

  // ── 3. EOD Submissions ──────────────────────────────────────────────────
  const { data: subRows, error: subErr } = await supabase
    .from("va_eod_submissions")
    .select("*")
    .gte("work_date", window.startDate)
    .lte("work_date", window.endDate)
    .neq("status", "draft");
  if (subErr) warnings.push(`EOD submissions: ${subErr.message}`);

  const ES = handle.tables.eodSubmissions.fieldId;
  const subRefById = new Map<string, string>();
  const subRecords: Fields[] = ((subRows || []) as Record<string, unknown>[]).map((row) => {
    const ref = `EOD-${(vaNameById.get(String(row.va_id)) || "VA").replace(/\s+/g, "").slice(0, 12)}-${row.work_date}`;
    subRefById.set(String(row.id), ref);
    const tasks = Array.isArray(row.tasks_selected) ? (row.tasks_selected as string[]) : [];
    const metricLink = metricRef(String(row.va_id), String(row.work_date));
    return {
      [ES["Submission ID"]]: ref,
      [ES["VA"]]: linkToVa(String(row.va_id)),
      [ES["Date"]]: String(row.work_date),
      [ES["Submitted At"]]: iso(row.submitted_at),
      [ES["Tasks Selected"]]: tasks.length
        ? tasks.map((t) => TASKS_BY_ID[t]?.label || titleCase(t))
        : undefined,
      [ES["Self-Reported Values"]]: describeSelfReported(row.self_reported),
      [ES["Blockers"]]: (row.blockers as string) ?? undefined,
      [ES["Tomorrow's Priorities"]]: (row.priorities as string) ?? undefined,
      [ES["Wins"]]: (row.wins as string) ?? undefined,
      [ES["Escalations"]]: (row.escalations as string) ?? undefined,
      [ES["Task Notes"]]: pretty(row.task_notes),
      [ES["Status"]]: titleCase(String(row.status || "submitted")),
      [ES["Submitted Late"]]: Boolean(row.submitted_late),
      [ES["Verified Metrics"]]: metricRefsWritten.has(metricLink) ? [metricLink] : undefined,
      [ES["Last Synced"]]: now,
    };
  });

  if (subRecords.length) {
    const res = await upsertRecords(
      handle.tables.eodSubmissions.tableId,
      [ES["Submission ID"]],
      subRecords,
      { baseId: handle.baseId },
    );
    counts.eodSubmissions = res.records.length;
  }

  // ── 4. Discrepancy Flags ────────────────────────────────────────────────
  const { data: flagRows, error: flagErr } = await supabase
    .from("va_discrepancy_flags")
    .select("*")
    .gte("work_date", window.startDate)
    .lte("work_date", window.endDate);
  if (flagErr) warnings.push(`Discrepancy flags: ${flagErr.message}`);

  const DF = handle.tables.discrepancyFlags.fieldId;
  const flagRecords: Fields[] = ((flagRows || []) as Record<string, unknown>[]).map((row) => ({
    [DF["Flag ID"]]: `FLAG-${String(row.flag_number ?? row.id).slice(0, 12)}`,
    [DF["VA"]]: linkToVa(String(row.va_id)),
    [DF["Date"]]: String(row.work_date),
    [DF["EOD Submission"]]: subRefById.has(String(row.submission_id))
      ? [subRefById.get(String(row.submission_id)) as string]
      : undefined,
    [DF["Metric"]]: (row.metric_label as string) || String(row.metric_key),
    [DF["Self-Reported Value"]]: numeric(row.self_reported),
    [DF["Verified Value"]]: numeric(row.verified),
    [DF["Variance"]]: numeric(row.variance),
    [DF["Variance %"]]: numeric(row.variance_pct),
    [DF["Severity"]]: titleCase(String(row.severity || "low")),
    [DF["Status"]]: titleCase(String(row.status || "open")),
    [DF["VA Explanation"]]: (row.va_explanation as string) ?? undefined,
    [DF["Review Note"]]: (row.review_note as string) ?? undefined,
    [DF["Reviewed By"]]: (row.reviewed_by_name as string) ?? undefined,
    [DF["Reviewed At"]]: iso(row.reviewed_at),
    [DF["Last Synced"]]: now,
  }));

  if (flagRecords.length) {
    const res = await upsertRecords(
      handle.tables.discrepancyFlags.tableId,
      [DF["Flag ID"]],
      flagRecords,
      { baseId: handle.baseId },
    );
    counts.discrepancyFlags = res.records.length;
  }

  // ── 5. KPI Targets ──────────────────────────────────────────────────────
  const { data: targetRows } = await supabase.from("va_kpi_targets").select("*");
  const KT = handle.tables.kpiTargets.fieldId;
  const targetRecords: Fields[] = ((targetRows || []) as Record<string, unknown>[]).map((row) => ({
    [KT["Target ID"]]: `KPI-${String(row.target_number ?? row.id).slice(0, 12)}`,
    [KT["Function"]]: titleCase(String(row.function || "all")),
    [KT["Metric"]]: (row.label as string) || String(row.metric_key),
    [KT["Target Value"]]: numeric(row.target_value),
    [KT["Comparator"]]: String(row.comparator) === "lte" ? "At or below" : "At or above",
    [KT["Unit"]]: (row.unit as string) ?? undefined,
    [KT["Period"]]: titleCase(String(row.period || "daily")),
    [KT["Active"]]: row.active !== false,
    [KT["Effective Date"]]: dateOnly(row.effective_date),
    [KT["Applies To"]]: row.va_id ? linkToVa(String(row.va_id)) : undefined,
    [KT["Last Synced"]]: now,
  }));
  if (targetRecords.length) {
    const res = await upsertRecords(
      handle.tables.kpiTargets.tableId,
      [KT["Target ID"]],
      targetRecords,
      { baseId: handle.baseId },
    );
    counts.kpiTargets = res.records.length;
  }

  // ── 6. Performance Periods ──────────────────────────────────────────────
  const { data: periodRows } = await supabase
    .from("va_performance_periods")
    .select("*")
    .gte("end_date", window.startDate);
  const PP = handle.tables.performancePeriods.fieldId;
  const periodRefById = new Map<string, string>();
  const periodRecords: Fields[] = ((periodRows || []) as Record<string, unknown>[]).map((row) => {
    const ref = `PER-${String(row.period_number ?? row.id).slice(0, 12)}`;
    periodRefById.set(String(row.id), ref);
    return {
      [PP["Period ID"]]: ref,
      [PP["VA"]]: linkToVa(String(row.va_id)),
      [PP["Period Type"]]: titleCase(String(row.period_type || "weekly")),
      [PP["Start"]]: dateOnly(row.start_date),
      [PP["End"]]: dateOnly(row.end_date),
      [PP["Total Hours"]]: numeric(row.total_hours),
      [PP["Metric Rollups"]]: describeRollups(row.rollups),
      [PP["Target Attainment %"]]: numeric(row.target_attainment_pct),
      [PP["Revenue Attributed"]]: money(row.revenue_attributed_cents),
      [PP["Revenue per VA Hour"]]: money(row.revenue_per_hour_cents),
      [PP["EOD Compliance %"]]: numeric(row.eod_compliance_pct),
      [PP["Discrepancy Count"]]: numeric(row.discrepancy_count),
      [PP["Overall Rating"]]: row.overall_rating ? titleCase(String(row.overall_rating)) : undefined,
      [PP["Reviewed By"]]: (row.reviewed_by_name as string) ?? undefined,
      [PP["Review Notes"]]: (row.review_notes as string) ?? undefined,
      [PP["Status"]]: titleCase(String(row.status || "draft")),
      [PP["Last Synced"]]: now,
    };
  });
  if (periodRecords.length) {
    const res = await upsertRecords(
      handle.tables.performancePeriods.tableId,
      [PP["Period ID"]],
      periodRecords,
      { baseId: handle.baseId },
    );
    counts.performancePeriods = res.records.length;
  }

  // ── 7. Coaching Log ─────────────────────────────────────────────────────
  const { data: coachingRows } = await supabase
    .from("va_coaching_log")
    .select("*")
    .gte("entry_date", window.startDate);
  const CL = handle.tables.coachingLog.fieldId;
  const coachingRecords: Fields[] = ((coachingRows || []) as Record<string, unknown>[]).map((row) => ({
    [CL["Entry ID"]]: `COACH-${String(row.entry_number ?? row.id).slice(0, 12)}`,
    [CL["VA"]]: linkToVa(String(row.va_id)),
    [CL["Date"]]: dateOnly(row.entry_date),
    [CL["Type"]]: titleCase(String(row.entry_type || "coaching_note")),
    [CL["Trigger"]]: row.trigger_flag_id
      ? "Discrepancy flag"
      : row.trigger_period_id
        ? "Performance period"
        : undefined,
    [CL["Trigger Period"]]: row.trigger_period_id && periodRefById.has(String(row.trigger_period_id))
      ? [periodRefById.get(String(row.trigger_period_id)) as string]
      : undefined,
    [CL["Summary"]]: (row.summary as string) ?? undefined,
    [CL["Action Agreed"]]: (row.action_agreed as string) ?? undefined,
    [CL["Follow-up Date"]]: dateOnly(row.follow_up_date),
    [CL["Logged By"]]: (row.logged_by_name as string) ?? undefined,
    [CL["Outcome"]]: (row.outcome as string) ?? undefined,
    [CL["Last Synced"]]: now,
  }));
  if (coachingRecords.length) {
    const res = await upsertRecords(
      handle.tables.coachingLog.tableId,
      [CL["Entry ID"]],
      coachingRecords,
      { baseId: handle.baseId },
    );
    counts.coachingLog = res.records.length;
  }

  return { baseId: handle.baseId, baseCreated: handle.created, counts, warnings };
}

/**
 * Human-readable provenance for the mirror. Reading "apploye: unavailable"
 * in Airtable is what stops someone treating a blank Hours cell as a zero.
 */
function describeSourceStatus(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const lines: string[] = [];
  for (const [source, value] of Object.entries(raw as Record<string, unknown>)) {
    const v = (value || {}) as { status?: string; syncedAt?: string; error?: string };
    lines.push(
      `${source}: ${v.status || "unknown"}${v.syncedAt ? ` @ ${v.syncedAt}` : ""}${v.error ? ` — ${v.error}` : ""}`,
    );
  }
  lines.push("Blank metric = unverified (source unreachable or VA unlinked), NOT zero.");
  return lines.join("\n");
}

function describeSelfReported(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (!entries.length) return undefined;
  return entries.map(([k, v]) => `${titleCase(k)}: ${String(v)}`).join("\n");
}

function describeRollups(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const entries = Object.entries(raw as Record<string, unknown>);
  const lines = entries
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => {
      const def = METRICS[k as MetricKey];
      const label = def?.label || titleCase(k);
      const value = def?.format === "currency" ? `$${(Number(v) / 100).toFixed(2)}` : String(v);
      return `${label}: ${value}`;
    });
  return lines.length ? lines.join("\n") : undefined;
}

/** Which VAs are missing a verification link — surfaced in the admin tab. */
export function unlinkedSources(va: VaRecord): string[] {
  const missing: string[] = [];
  if (!va.apployeMemberId) missing.push("Apploye");
  if (!va.ghlUserId) missing.push("GHL");
  if (!va.workspaceUserId) missing.push("Workspace");
  return missing;
}

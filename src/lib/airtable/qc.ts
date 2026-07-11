// ─── Airtable "QC Issues" table — live QC backlog + data mapping ──────────────
//
// One row per qc_issues record in the Client & Revenue Ops base, kept live by
// a DB trigger on qc_issues (INSERT/UPDATE → /api/airtable/sync
// { type: "qc_issue", id }). Each row carries the issue lifecycle AND the
// linked job's documentation evidence (Drive folder, dispute packet,
// documented flag) so the Airtable backlog is dispute-ready on its own.
//
// The table is created lazily via the Meta API on first sync (no manual
// Airtable setup); a link to the Jobs table ties every issue to its job.

import { createField, createLinkField, createTable, findRecordIdByField, listBaseTables, upsertOne } from "./client";
import { TABLES } from "./schema";
import { getAdminSupabase } from "./sources/admin-client";

const QC_TABLE_NAME = "QC Issues";

// Field names (written by name — the table is ours, created below).
const F = {
  issueId: "Issue ID", // primary + merge key (uuid)
  issueNumber: "Issue #",
  bookingRef: "Booking Ref",
  client: "Client Name",
  clientEmail: "Client Email",
  cleaner: "Cleaner",
  type: "Type",
  severity: "Severity",
  status: "Status",
  title: "Title",
  description: "Description",
  reportedVia: "Reported Via",
  reportedBy: "Reported By",
  resolution: "Resolution",
  resolvedAt: "Resolved At",
  createdAt: "Created At",
  documented: "Documented",
  driveFolder: "Drive Folder",
  disputePacket: "Dispute Packet (PDF)",
  serviceDate: "Service Date",
  job: "Job", // link → Jobs
} as const;

const SELECT_OPTIONS: Record<string, string[]> = {
  [F.type]: ["complaint", "reclean", "damage", "no_show", "late", "quality_flag", "payment", "other"],
  [F.severity]: ["low", "medium", "high", "critical"],
  [F.status]: ["open", "investigating", "awaiting_customer", "resolved", "escalated"],
  [F.reportedVia]: ["va", "admin", "cleaner_field", "system"],
};

let qcTableId: string | null | undefined;

/** Find-or-create the QC Issues table (cached per lambda). */
export async function ensureQcTable(): Promise<string | null> {
  if (qcTableId !== undefined) return qcTableId;
  try {
    const tables = await listBaseTables();
    const existing = tables.find((t) => t.name === QC_TABLE_NAME);
    if (existing) {
      qcTableId = existing.id;
      return qcTableId;
    }
    const created = await createTable(
      QC_TABLE_NAME,
      [
        { name: F.issueId, type: "singleLineText", description: "qc_issues.id (merge key)" },
        { name: F.issueNumber, type: "number", options: { precision: 0 } },
        { name: F.bookingRef, type: "singleLineText" },
        { name: F.client, type: "singleLineText" },
        { name: F.clientEmail, type: "email" },
        { name: F.cleaner, type: "singleLineText" },
        { name: F.type, type: "singleSelect", options: { choices: SELECT_OPTIONS[F.type].map((n) => ({ name: n })) } },
        { name: F.severity, type: "singleSelect", options: { choices: SELECT_OPTIONS[F.severity].map((n) => ({ name: n })) } },
        { name: F.status, type: "singleSelect", options: { choices: SELECT_OPTIONS[F.status].map((n) => ({ name: n })) } },
        { name: F.title, type: "singleLineText" },
        { name: F.description, type: "multilineText" },
        { name: F.reportedVia, type: "singleSelect", options: { choices: SELECT_OPTIONS[F.reportedVia].map((n) => ({ name: n })) } },
        { name: F.reportedBy, type: "singleLineText" },
        { name: F.resolution, type: "multilineText" },
        { name: F.resolvedAt, type: "dateTime", options: { timeZone: "America/New_York", dateFormat: { name: "us" }, timeFormat: { name: "12hour" } } },
        { name: F.createdAt, type: "dateTime", options: { timeZone: "America/New_York", dateFormat: { name: "us" }, timeFormat: { name: "12hour" } } },
        { name: F.serviceDate, type: "date", options: { dateFormat: { name: "us" } } },
        { name: F.documented, type: "checkbox", options: { icon: "check", color: "greenBright" } },
        { name: F.driveFolder, type: "url" },
        { name: F.disputePacket, type: "url" },
      ],
      "QC issue backlog — every row links to its job with the documentation evidence (photos archive + dispute packet) mapped in.",
    );
    qcTableId = created.id;
    // Link each issue to its Job record (best-effort — table works without it).
    await createLinkField(created.id, F.job, TABLES.jobs).catch(() => null);
    return qcTableId;
  } catch {
    qcTableId = null;
    return null;
  }
}

/** Upsert one QC issue (by qc_issues.id) into the Airtable backlog. */
export async function syncQcIssueById(issueId: string): Promise<string | null> {
  const tableId = await ensureQcTable();
  if (!tableId) throw new Error("QC Issues table unavailable (Meta API create failed).");

  const supabase = getAdminSupabase();
  const { data: issue, error } = await supabase
    .from("qc_issues")
    .select("*")
    .eq("id", issueId)
    .maybeSingle();
  if (error) throw error;
  if (!issue) return null;

  // Documentation evidence for the linked booking.
  const { data: doc } = await supabase
    .from("job_documentation")
    .select("documented, drive_folder_url, drive_pdf_url, service_date")
    .eq("booking_id", issue.booking_id)
    .maybeSingle();

  // Link to the Jobs row (Job ID field holds the booking uuid).
  const jobRecordId = await findRecordIdByField(TABLES.jobs, "Job ID", String(issue.booking_id)).catch(() => null);

  return upsertOne(
    tableId,
    [F.issueId],
    {
      [F.issueId]: String(issue.id),
      [F.issueNumber]: Number(issue.issue_number) || undefined,
      [F.bookingRef]: issue.booking_ref || undefined,
      [F.client]: issue.client_name || undefined,
      [F.clientEmail]: issue.client_email || undefined,
      [F.cleaner]: issue.cleaner_name || undefined,
      [F.type]: issue.issue_type,
      [F.severity]: issue.severity,
      [F.status]: issue.status,
      [F.title]: issue.title,
      [F.description]: issue.description || undefined,
      [F.reportedVia]: issue.reported_via,
      [F.reportedBy]: issue.reported_by_name || undefined,
      [F.resolution]: issue.resolution_note || undefined,
      [F.resolvedAt]: issue.resolved_at || undefined,
      [F.createdAt]: issue.created_at,
      [F.serviceDate]: doc?.service_date || undefined,
      [F.documented]: Boolean(doc?.documented),
      [F.driveFolder]: doc?.drive_folder_url || undefined,
      [F.disputePacket]: doc?.drive_pdf_url || undefined,
      ...(jobRecordId ? { [F.job]: [jobRecordId] } : {}),
    },
  );
}

/** Backfill every QC issue (used once after table creation / for reconciles). */
export async function syncAllQcIssues(limit = 500): Promise<number> {
  await ensureQcTable(); // provision the table even before the first issue
  const supabase = getAdminSupabase();
  const { data: issues } = await supabase
    .from("qc_issues")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(limit);
  let synced = 0;
  for (const i of issues || []) {
    try {
      await syncQcIssueById(String(i.id));
      synced++;
    } catch {
      /* keep going — nightly reconcile will catch stragglers */
    }
  }
  return synced;
}

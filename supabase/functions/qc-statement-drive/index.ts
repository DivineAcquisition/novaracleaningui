// qc-statement-drive
//
// Mirrors contractor-statement uploads and the branded PDF into
//   <QC root>/QC Cases/{issue_number}/Contractor Statement/
// and case photos/videos into
//   <QC root>/QC Cases/{issue_number}/Case Evidence/
// Best-effort. Statement rows and qc_issues.evidence_files in Postgres are the source of truth.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  driveConfigured,
  ensureFolder,
  fileUrl,
  folderUrl,
  getDriveToken,
  listChildNames,
  shareReadableByLink,
  updateFile,
  uploadFile,
} from "../_shared/google-drive.ts";
import {
  QC_STATEMENT_STORAGE_BUCKET,
  formatServiceDate,
  generalLocation,
  type QcStatementPdfInput,
} from "../_shared/qc-statement.ts";
import { buildQcStatementPdf } from "../_shared/qc-statement-pdf.ts";
import { loadStatementJobContext } from "../_shared/qc-statement-ops.ts";

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
  console.log(`[qc-statement-drive] ${m}${d === undefined ? "" : " " + JSON.stringify(d)}`);

// deno-lint-ignore no-explicit-any
type SB = any;

async function resolveSecret(supabase: SB, key: string): Promise<string | null> {
  const env = Deno.env.get(key);
  if (env) return env;
  const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
  return data?.value ? String(data.value) : null;
}

function mimeFor(name: string, fallback?: string): string {
  if (fallback && fallback !== "application/octet-stream") return fallback;
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "heic" || ext === "heif") return "image/heic";
  if (ext === "mp4") return "video/mp4";
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  if (ext === "m4v") return "video/x-m4v";
  return "image/jpeg";
}

async function downloadStorage(admin: SB, path: string): Promise<Uint8Array | null> {
  const { data, error } = await admin.storage.from(QC_STATEMENT_STORAGE_BUCKET).download(path);
  if (error || !data) return null;
  const buf = await data.arrayBuffer();
  return new Uint8Array(buf);
}

async function ensureCaseFolder(admin: SB, issue: Record<string, unknown>): Promise<{
  folderId: string | null;
  folderUrl: string | null;
  skipped?: string;
}> {
  if (!driveConfigured()) return { folderId: null, folderUrl: null, skipped: "drive_not_configured" };
  const rootId = await resolveSecret(admin, "GDRIVE_QC_ROOT_FOLDER_ID");
  if (!rootId) return { folderId: null, folderUrl: null, skipped: "no_root_folder" };
  const impersonate = await resolveSecret(admin, "GOOGLE_DRIVE_IMPERSONATE_EMAIL");
  const token = await getDriveToken(impersonate || undefined);
  if (!token) return { folderId: null, folderUrl: null, skipped: "no_drive_token" };

  const casesRoot = await ensureFolder(token, rootId, "QC Cases");
  const caseFolder = await ensureFolder(token, casesRoot, String(issue.issue_number || issue.id).slice(0, 40));
  const statementFolder = await ensureFolder(token, caseFolder, "Contractor Statement");
  await shareReadableByLink(token, statementFolder);
  const url = folderUrl(statementFolder);

  await admin.from("qc_issues").update({
    statement_drive_folder_id: statementFolder,
    statement_drive_folder_url: url,
    updated_at: new Date().toISOString(),
  }).eq("id", issue.id);
  await admin.from("qc_statement_requests")
    .update({ drive_folder_id: statementFolder, drive_folder_url: url, updated_at: new Date().toISOString() })
    .eq("issue_id", issue.id);

  return { folderId: statementFolder, folderUrl: url };
}

async function ensureEvidenceFolder(admin: SB, issue: Record<string, unknown>): Promise<{
  folderId: string | null;
  folderUrl: string | null;
  skipped?: string;
}> {
  if (!driveConfigured()) return { folderId: null, folderUrl: null, skipped: "drive_not_configured" };
  const rootId = await resolveSecret(admin, "GDRIVE_QC_ROOT_FOLDER_ID");
  if (!rootId) return { folderId: null, folderUrl: null, skipped: "no_root_folder" };
  const impersonate = await resolveSecret(admin, "GOOGLE_DRIVE_IMPERSONATE_EMAIL");
  const token = await getDriveToken(impersonate || undefined);
  if (!token) return { folderId: null, folderUrl: null, skipped: "no_drive_token" };

  const casesRoot = await ensureFolder(token, rootId, "QC Cases");
  const caseFolder = await ensureFolder(token, casesRoot, String(issue.issue_number || issue.id).slice(0, 40));
  const evidenceFolder = await ensureFolder(token, caseFolder, "Case Evidence");
  await shareReadableByLink(token, evidenceFolder);
  return { folderId: evidenceFolder, folderUrl: folderUrl(evidenceFolder) };
}

async function uploadNamed(
  token: string,
  folderId: string,
  filename: string,
  bytes: Uint8Array,
  mime: string,
  existingId?: string | null,
): Promise<string> {
  if (existingId) {
    await updateFile(token, existingId, bytes, mime);
    return existingId;
  }
  const names = await listChildNames(token, folderId);
  if (names.has(filename)) {
    // Duplicate name — prefix with a short unique token so retries don't collide.
    const stamped = filename.replace(/(\.[^.]+)?$/, (m) => `-${Date.now().toString(36)}${m}`);
    return await uploadFile(token, folderId, stamped, bytes, mime);
  }
  return await uploadFile(token, folderId, filename, bytes, mime);
}

async function pdfInputFromSubmission(admin: SB, sub: Record<string, unknown>, issue: Record<string, unknown>): Promise<QcStatementPdfInput> {
  const job = await loadStatementJobContext(admin, String(issue.booking_id || "") || null);
  const attachments = Array.isArray(sub.attachments) ? sub.attachments as Array<{ filename?: string }> : [];
  const { data: cleaner } = await admin
    .from("cleaners")
    .select("first_name, last_name")
    .eq("id", sub.cleaner_id)
    .maybeSingle();
  const contractorName = cleaner
    ? `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim()
    : String(issue.cleaner_name || "Contractor");
  return {
    issueNumber: Number(issue.issue_number) || String(issue.id).slice(0, 8),
    bookingRef: String(issue.booking_ref || job.bookingRef || ""),
    serviceDate: formatServiceDate(job.serviceDate),
    generalLocation: generalLocation(job.city, job.state),
    serviceType: job.serviceType || "—",
    contractorName,
    kind: String(sub.kind || "original"),
    sequence: Number(sub.sequence) || 1,
    reportSummary: String(issue.statement_report_summary || ""),
    account: String(sub.account_text || ""),
    arrived: String(sub.timeline_arrived || ""),
    started: String(sub.timeline_started || ""),
    left: String(sub.timeline_left || ""),
    timelineNotes: String(sub.timeline_notes || ""),
    reportResponse: String(sub.report_response || ""),
    othersPresent: String(sub.others_present || ""),
    attestationName: String(sub.attestation_name || ""),
    attestedAt: String(sub.attested_at || sub.submitted_at || ""),
    attachmentNames: attachments.map((a) => String(a.filename || "file")),
    driveFolderUrl: String(sub.drive_folder_url || issue.statement_drive_folder_url || "") || null,
    submittedAt: String(sub.submitted_at || ""),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const admin: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "finalize").toLowerCase();

    if (action === "ensure_folder") {
      const issueId = String(body.issueId || "");
      if (!issueId) return json({ error: "issueId required" }, 400);
      const { data: issue } = await admin.from("qc_issues").select("id, issue_number").eq("id", issueId).maybeSingle();
      if (!issue) return json({ error: "Issue not found" }, 404);
      const folder = await ensureCaseFolder(admin, issue);
      return json({ ok: true, ...folder });
    }

    if (action === "upload_case_evidence") {
      const issueId = String(body.issueId || "");
      const storagePath = String(body.storagePath || "");
      const filename = String(body.filename || storagePath.split("/").pop() || "file");
      if (!issueId || !storagePath) return json({ error: "issueId and storagePath required" }, 400);
      const { data: issue } = await admin.from("qc_issues").select("*").eq("id", issueId).maybeSingle();
      if (!issue) return json({ error: "Issue not found" }, 404);
      const folder = await ensureEvidenceFolder(admin, issue);
      if (!folder.folderId) return json({ ok: false, skipped: folder.skipped || "no_folder" });
      const bytes = await downloadStorage(admin, storagePath);
      if (!bytes) return json({ ok: false, error: "storage object missing" }, 400);
      const impersonate = await resolveSecret(admin, "GOOGLE_DRIVE_IMPERSONATE_EMAIL");
      const token = await getDriveToken(impersonate || undefined);
      if (!token) return json({ ok: false, skipped: "no_drive_token" });
      const id = await uploadNamed(
        token,
        folder.folderId,
        filename,
        bytes,
        mimeFor(filename, body.contentType),
        body.driveFileId ? String(body.driveFileId) : null,
      );
      return json({ ok: true, driveFileId: id, driveFileUrl: fileUrl(id), folderUrl: folder.folderUrl });
    }

    if (action === "upload_one") {
      const requestId = String(body.requestId || "");
      const storagePath = String(body.storagePath || "");
      const filename = String(body.filename || storagePath.split("/").pop() || "file");
      if (!requestId || !storagePath) return json({ error: "requestId and storagePath required" }, 400);
      const { data: request } = await admin.from("qc_statement_requests").select("*").eq("id", requestId).maybeSingle();
      if (!request) return json({ error: "Request not found" }, 404);
      const { data: issue } = await admin.from("qc_issues").select("*").eq("id", request.issue_id).maybeSingle();
      if (!issue) return json({ error: "Issue not found" }, 404);
      const folder = await ensureCaseFolder(admin, issue);
      if (!folder.folderId) return json({ ok: false, skipped: folder.skipped || "no_folder" });
      const bytes = await downloadStorage(admin, storagePath);
      if (!bytes) return json({ ok: false, error: "storage object missing" }, 400);
      const impersonate = await resolveSecret(admin, "GOOGLE_DRIVE_IMPERSONATE_EMAIL");
      const token = await getDriveToken(impersonate || undefined);
      if (!token) return json({ ok: false, skipped: "no_drive_token" });
      const id = await uploadNamed(token, folder.folderId, filename, bytes, mimeFor(filename, body.contentType), null);
      return json({ ok: true, driveFileId: id, driveFileUrl: fileUrl(id), folderUrl: folder.folderUrl });
    }

    const submissionId = String(body.submissionId || "");
    if (!submissionId) return json({ error: "submissionId required" }, 400);
    const { data: sub } = await admin.from("qc_statement_submissions").select("*").eq("id", submissionId).maybeSingle();
    if (!sub) return json({ error: "Submission not found" }, 404);
    const { data: issue } = await admin.from("qc_issues").select("*").eq("id", sub.issue_id).maybeSingle();
    if (!issue) return json({ error: "Issue not found" }, 404);

    const folder = await ensureCaseFolder(admin, issue);
    const impersonate = await resolveSecret(admin, "GOOGLE_DRIVE_IMPERSONATE_EMAIL");
    const token = driveConfigured() ? await getDriveToken(impersonate || undefined) : null;

    let pdfPath = String(sub.pdf_path || "");
    let pdfError: string | null = null;
    const failPdf = Deno.env.get("QC_STATEMENT_FAIL_PDF") === "1" || body.failPdf === true;

    try {
      if (failPdf) throw new Error("simulated PDF generation failure");
      if (!pdfPath) {
        const input = await pdfInputFromSubmission(admin, sub, issue);
        input.driveFolderUrl = folder.folderUrl;
        const bytes = await buildQcStatementPdf(input);
        pdfPath = `statements/${issue.id}/${sub.id}.pdf`;
        const { error: upErr } = await admin.storage.from(QC_STATEMENT_STORAGE_BUCKET).upload(pdfPath, bytes, {
          contentType: "application/pdf",
          upsert: true,
        });
        if (upErr) throw upErr;
      }
      let pdfDriveId = sub.pdf_drive_file_id || null;
      if (token && folder.folderId) {
        const bytes = await downloadStorage(admin, pdfPath);
        if (bytes) {
          const name = `QC-${issue.issue_number}-statement-${sub.sequence}.pdf`;
          pdfDriveId = await uploadNamed(token, folder.folderId, name, bytes, "application/pdf", pdfDriveId);
        }
      }
      await admin.from("qc_statement_submissions").update({
        pdf_path: pdfPath,
        pdf_status: "generated",
        pdf_attempts: (sub.pdf_attempts || 0) + 1,
        pdf_last_error: null,
        pdf_drive_file_id: pdfDriveId,
        drive_folder_id: folder.folderId,
        drive_folder_url: folder.folderUrl,
      }).eq("id", submissionId);
    } catch (e) {
      pdfError = e instanceof Error ? e.message : String(e);
      log("pdf failed", { submissionId, pdfError });
      await admin.from("qc_statement_submissions").update({
        pdf_status: "failed",
        pdf_attempts: (sub.pdf_attempts || 0) + 1,
        pdf_last_error: pdfError.slice(0, 500),
        drive_folder_id: folder.folderId,
        drive_folder_url: folder.folderUrl,
      }).eq("id", submissionId);
      await admin.from("events").insert({
        event_type: "qc.statement.pdf_failed",
        booking_id: issue.booking_id,
        job_id: issue.job_id,
        cleaner_id: issue.cleaner_id,
        source: "qc-statement-drive",
        summary: `Statement PDF failed on QC #${issue.issue_number} — statement itself is saved. Retry flagged.`,
        data: { issue_id: issue.id, submission_id: submissionId, error: pdfError },
      }).then(() => undefined, () => undefined);
    }

    if (token && folder.folderId) {
      const attachments = Array.isArray(sub.attachments) ? sub.attachments : [];
      const nextAtt: unknown[] = [];
      for (const raw of attachments) {
        const a = raw as Record<string, unknown>;
        const path = String(a.storagePath || a.storage_path || "");
        const filename = String(a.filename || path.split("/").pop() || "file");
        if (!path) {
          nextAtt.push(a);
          continue;
        }
        try {
          const bytes = await downloadStorage(admin, path);
          if (!bytes) {
            nextAtt.push(a);
            continue;
          }
          const id = await uploadNamed(
            token,
            folder.folderId,
            filename,
            bytes,
            mimeFor(filename, String(a.contentType || "")),
            a.driveFileId ? String(a.driveFileId) : null,
          );
          nextAtt.push({ ...a, driveFileId: id, driveFileUrl: fileUrl(id) });
        } catch (e) {
          log("attachment mirror failed", { filename, err: e instanceof Error ? e.message : e });
          nextAtt.push(a);
        }
      }
      await admin.from("qc_statement_submissions").update({ attachments: nextAtt }).eq("id", submissionId);
    }

    return json({
      ok: !pdfError,
      pdfFailed: Boolean(pdfError),
      pdfError,
      folderUrl: folder.folderUrl,
      statementIntact: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    return json({ error: msg }, 500);
  }
});

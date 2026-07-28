// ─── Generating and storing the EOD record ────────────────────────────────────
//
// Order matters and is the whole safety property: THE SUBMISSION IS SAVED
// FIRST, and the PDF is rendered from the saved row. Nothing in this file can
// lose or block a submission — every failure path marks the record for retry
// and returns.
//
// Two destinations, for different reasons:
//   Supabase Storage — the durable copy we control, and the URL Airtable
//                      fetches from (it re-hosts immediately, so a short-lived
//                      signed link is enough and nothing stays public).
//   Google Drive     — the human-browsable archive, in a dated folder tree.
//
// Exactly one current PDF per VA per day: the storage path is keyed on
// (va, date) and overwritten, and the Drive file is updated in place when it
// already exists rather than piling up copies.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  buildEodPdf,
  EOD_BUCKET,
  reportFilename,
  reportPath,
  signedReportUrl,
} from "./eod-pdf";
import { mapSubmission, type EodSubmission } from "./eod";
import type { MetricKey, MetricValues } from "./metrics";
import { readVerifiedDay } from "./verify";
import { getVaById, type VaRecord } from "./vas";

export interface ReportResult {
  ok: boolean;
  path?: string;
  driveUrl?: string | null;
  error?: string;
}

/**
 * Render the PDF for a saved submission, store it, mirror it to Drive and
 * stamp the record. Never throws — a failure is flagged for retry instead.
 */
export async function generateEodReport(
  submission: EodSubmission,
  va?: VaRecord | null,
): Promise<ReportResult> {
  const supabase = getAdminSupabase();
  const attempts = await currentAttempts(submission.id);

  try {
    const record = va ?? (await getVaById(submission.vaId));
    if (!record) throw new Error("VA not found for this submission.");

    const verifiedRow = await readVerifiedDay(submission.vaId, submission.workDate);
    const values: MetricValues = verifiedRow?.values ?? {};
    const verifiedStatus: Partial<Record<MetricKey, string>> = {};
    for (const [key, meta] of Object.entries(verifiedRow?.provenance ?? {})) {
      verifiedStatus[key as MetricKey] = (meta as { status?: string })?.status ?? "unavailable";
    }

    const bytes = await buildEodPdf({ submission, va: record, verified: values, verifiedStatus });
    const path = reportPath(submission.vaId, submission.workDate);

    const { error: upErr } = await supabase.storage
      .from(EOD_BUCKET)
      // upsert: an edit before cutoff replaces the file, so there is exactly
      // one current version rather than a pile of near-identical PDFs.
      .upload(path, Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

    // Drive is a mirror, not the system of record. If it's down the PDF still
    // exists and is attached in Airtable; we record the reason and retry.
    const drive = await mirrorToDrive(record, submission, bytes);

    await supabase
      .from("va_eod_submissions")
      .update({
        pdf_path: path,
        pdf_status: drive.ok ? "generated" : "drive_pending",
        pdf_generated_at: new Date().toISOString(),
        pdf_attempts: attempts + 1,
        pdf_last_error: drive.ok ? null : drive.error?.slice(0, 500) ?? null,
        ...(drive.fileId ? { drive_file_id: drive.fileId } : {}),
        ...(drive.url ? { drive_url: drive.url } : {}),
      })
      .eq("id", submission.id);

    return { ok: true, path, driveUrl: drive.url ?? null, error: drive.ok ? undefined : drive.error };
  } catch (err) {
    const message = (err as Error).message || "PDF generation failed";
    // The submission is already saved. Flag for retry, never discard.
    await supabase
      .from("va_eod_submissions")
      .update({
        pdf_status: "failed",
        pdf_attempts: attempts + 1,
        pdf_last_error: message.slice(0, 500),
      })
      .eq("id", submission.id)
      .then(
        () => undefined,
        () => undefined,
      );
    return { ok: false, error: message };
  }
}

async function currentAttempts(submissionId: string): Promise<number> {
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase
      .from("va_eod_submissions")
      .select("pdf_attempts")
      .eq("id", submissionId)
      .maybeSingle();
    return Number((data as { pdf_attempts?: number } | null)?.pdf_attempts ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Push to Drive through the edge function that owns the Google credentials.
 * The service-account key is a Supabase function secret, so Drive is not
 * reachable from the Next.js runtime — this is the same split the QC mirror
 * uses. Never throws.
 */
async function mirrorToDrive(
  va: VaRecord,
  submission: EodSubmission,
  bytes: Uint8Array,
): Promise<{ ok: boolean; fileId?: string; url?: string; error?: string }> {
  try {
    const supabase = getAdminSupabase();
    const { data, error } = await supabase.functions.invoke("va-eod-drive-mirror", {
      body: {
        vaName: va.name,
        workDate: submission.workDate,
        filename: reportFilename(va, submission.workDate),
        existingFileId: null,
        submissionId: submission.id,
        pdfBase64: Buffer.from(bytes).toString("base64"),
      },
    });
    if (error) return { ok: false, error: error.message };
    const result = data as { ok?: boolean; fileId?: string; url?: string; error?: string; skipped?: string };
    if (result?.skipped) return { ok: false, error: `Drive not configured (${result.skipped})` };
    if (!result?.ok) return { ok: false, error: result?.error || "Drive mirror failed" };
    return { ok: true, fileId: result.fileId, url: result.url };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Regenerate for a submission id — used by the retry sweep and admin retry. */
export async function regenerateEodReport(submissionId: string): Promise<ReportResult> {
  const supabase = getAdminSupabase();
  const { data } = await supabase
    .from("va_eod_submissions")
    .select("*")
    .eq("id", submissionId)
    .maybeSingle();
  if (!data) return { ok: false, error: "Submission not found." };
  return generateEodReport(mapSubmission(data as Record<string, unknown>));
}

/**
 * Retry every record whose PDF didn't land. Runs on the metrics-sync schedule
 * so a Drive outage heals itself instead of needing someone to notice.
 * Locked days are skipped: after cutoff the PDF is final, whatever state it's
 * in, and silently rewriting a locked record would defeat the lock.
 */
export async function retryPendingReports(limit = 20): Promise<{ retried: number; healed: number }> {
  const supabase = getAdminSupabase();
  const { data } = await supabase
    .from("va_eod_submissions")
    .select("*")
    .in("pdf_status", ["failed", "drive_pending"])
    .is("locked_at", null)
    .lt("pdf_attempts", 10)
    .order("updated_at", { ascending: true })
    .limit(limit);

  let healed = 0;
  const rows = (data || []) as Record<string, unknown>[];
  for (const row of rows) {
    const result = await generateEodReport(mapSubmission(row));
    if (result.ok && !result.error) healed += 1;
  }
  return { retried: rows.length, healed };
}

/** Signed link for the admin surface. */
export async function reportUrl(submission: EodSubmission): Promise<string | null> {
  if (!submission.pdfPath) return null;
  return signedReportUrl(submission.pdfPath);
}

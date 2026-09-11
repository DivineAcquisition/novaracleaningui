// Public tokenized contractor statement — no login.
// GET form + job context · PATCH autosave · POST submit (immutable).

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  EMPTY_QC_STATEMENT_DRAFT,
  QC_STATEMENT_STORAGE_BUCKET,
  formatDueBy,
  formatServiceDate,
  generalLocation,
  normalizeQcStatementDraft,
  qcStatementDraftComplete,
  type QcStatementDraft,
} from "@/lib/qc-statement";
import { buildQcStatementPdf, saveThenGeneratePdf } from "@/lib/qc-statement-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

async function resolveToken(token: string) {
  const supabase = getAdminSupabase();
  if (!token || token.length < 16) {
    return { supabase, request: null as Record<string, unknown> | null, error: "This link isn't valid.", status: 404 };
  }
  const { data: request, error } = await (supabase.from as any)("qc_statement_requests")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  if (error) return { supabase, request: null, error: error.message, status: 500 };
  if (!request) {
    return { supabase, request: null, error: "This link isn't valid — ask Novara for a fresh one.", status: 404 };
  }
  const expired =
    request.token_expires_at && new Date(String(request.token_expires_at)).getTime() < Date.now();
  if (expired && !request.submitted_at) {
    return {
      supabase,
      request: request as Record<string, unknown>,
      error: "This statement link has expired. The office has been notified.",
      status: 410,
    };
  }
  return { supabase, request: request as Record<string, unknown>, error: null as string | null, status: 200 };
}

async function loadIssue(supabase: ReturnType<typeof getAdminSupabase>, issueId: string) {
  const { data } = await (supabase.from as any)("qc_issues").select("*").eq("id", issueId).maybeSingle();
  return data as Record<string, unknown> | null;
}

async function loadJob(supabase: ReturnType<typeof getAdminSupabase>, bookingId: string | null) {
  if (!bookingId) return null;
  const { data } = await supabase
    .from("bookings")
    .select("id, service_date, city, state, service_type, time_slot, booking_number")
    .eq("id", bookingId)
    .maybeSingle();
  return data;
}

async function markOpened(supabase: ReturnType<typeof getAdminSupabase>, request: Record<string, unknown>) {
  if (request.opened_at) return;
  await (supabase.from as any)("qc_statement_requests")
    .update({ opened_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", request.id)
    .is("opened_at", null);
}

function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = fwd.split(",")[0]?.trim();
  return ip || req.headers.get("x-real-ip") || null;
}

export async function GET(_req: Request, ctx: Ctx): Promise<NextResponse> {
  const token = String((await ctx.params).token || "").trim();
  const { supabase, request, error, status } = await resolveToken(token);
  if (!request || error) {
    return NextResponse.json({ error: error || "Not found", reason: status === 410 ? "expired" : "invalid" }, { status });
  }

  const issue = await loadIssue(supabase, String(request.issue_id));
  if (!issue) return NextResponse.json({ error: "This link isn't valid.", reason: "invalid" }, { status: 404 });

  const { data: cleaner } = await (supabase.from as any)("cleaners")
    .select("id, first_name, last_name")
    .eq("id", request.cleaner_id)
    .maybeSingle();
  if (!cleaner) return NextResponse.json({ error: "This link isn't valid.", reason: "invalid" }, { status: 404 });

  await markOpened(supabase, request);

  const job = await loadJob(supabase, String(issue.booking_id || "") || null);
  const draft = normalizeQcStatementDraft(request.draft, {
    ...EMPTY_QC_STATEMENT_DRAFT,
    attestationName: `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim(),
  });

  const { data: prior } = await (supabase.from as any)("qc_statement_submissions")
    .select("id, sequence, kind, submitted_at, attested_at, attestation_name, pdf_status")
    .eq("issue_id", issue.id)
    .order("sequence", { ascending: true });

  const alreadySubmitted = Boolean(request.submitted_at);
  let submittedDraft: QcStatementDraft | null = null;
  if (alreadySubmitted) {
    const { data: mine } = await (supabase.from as any)("qc_statement_submissions")
      .select("answers")
      .eq("request_id", request.id)
      .maybeSingle();
    submittedDraft = normalizeQcStatementDraft(mine?.answers || request.draft);
  }

  return NextResponse.json({
    ok: true,
    submitted: alreadySubmitted,
    kind: request.kind || "original",
    expiresAt: request.token_expires_at,
    dueAt: request.due_at,
    dueLabel: request.due_at ? formatDueBy(String(request.due_at)) : null,
    cleaner: {
      firstName: cleaner.first_name || "",
      name: `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim(),
    },
    job: {
      bookingRef: issue.booking_ref || (job?.booking_number ? `NVC-${String(job.booking_number).padStart(4, "0")}` : ""),
      serviceDate: formatServiceDate(job?.service_date || null),
      generalLocation: generalLocation(job?.city, job?.state),
      serviceType: String(job?.service_type || "").replace(/_/g, " ") || "cleaning",
      timeSlot: job?.time_slot || null,
    },
    reportSummary: String(issue.statement_report_summary || request.report_summary || ""),
    draft: submittedDraft || draft,
    priorStatements: prior || [],
  });
}

export async function PATCH(req: Request, ctx: Ctx): Promise<NextResponse> {
  const { supabase, request, error, status } = await resolveToken(String((await ctx.params).token || "").trim());
  if (!request || error) {
    return NextResponse.json({ error: error || "Not found" }, { status });
  }
  if (request.submitted_at) {
    return NextResponse.json({ ok: true, savedAt: request.submitted_at, submitted: true });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const draft = normalizeQcStatementDraft(body.draft ?? body, normalizeQcStatementDraft(request.draft));
  const now = new Date().toISOString();
  const { error: upErr } = await (supabase.from as any)("qc_statement_requests")
    .update({
      draft,
      opened_at: request.opened_at || now,
      last_saved_at: now,
      updated_at: now,
    })
    .eq("id", request.id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });
  return NextResponse.json({ ok: true, savedAt: now, submitted: false, draft });
}

export async function POST(req: Request, ctx: Ctx): Promise<NextResponse> {
  const token = String((await ctx.params).token || "").trim();
  const { supabase, request, error, status } = await resolveToken(token);
  if (!request || error) {
    return NextResponse.json({ error: error || "Not found" }, { status });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  if (request.submitted_at) {
    return NextResponse.json({ ok: true, submitted: true, alreadySubmitted: true });
  }

  const draft = normalizeQcStatementDraft(body.draft ?? body, normalizeQcStatementDraft(request.draft));
  if (!qcStatementDraftComplete(draft)) {
    return NextResponse.json(
      { error: "Please complete your account, timeline, response to the report, who was present, and the attestation." },
      { status: 400 },
    );
  }

  const issue = await loadIssue(supabase, String(request.issue_id));
  if (!issue) return NextResponse.json({ error: "This link isn't valid." }, { status: 404 });

  const { data: seqRows } = await (supabase.from as any)("qc_statement_submissions")
    .select("sequence")
    .eq("issue_id", issue.id)
    .order("sequence", { ascending: false })
    .limit(1);
  const sequence = Number(seqRows?.[0]?.sequence || 0) + 1;
  const now = new Date().toISOString();
  const attestedAt = now;
  const failPdf = body.failPdf === true || process.env.QC_STATEMENT_FAIL_PDF === "1";

  const result = await saveThenGeneratePdf({
    save: async () => {
      const { data: inserted, error: insErr } = await (supabase.from as any)("qc_statement_submissions")
        .insert({
          request_id: request.id,
          issue_id: issue.id,
          cleaner_id: request.cleaner_id,
          sequence,
          kind: request.kind || (sequence > 1 ? "supplemental" : "original"),
          account_text: draft.account,
          timeline_arrived: draft.arrived || null,
          timeline_started: draft.started || null,
          timeline_left: draft.left || null,
          timeline_notes: draft.timelineNotes || null,
          report_response: draft.reportResponse,
          others_present: draft.othersPresent || null,
          attestation_name: draft.attestationName,
          attested_at: attestedAt,
          answers: draft,
          attachments: draft.attachments,
          pdf_status: "none",
          submitted_at: now,
          submitted_ip: clientIp(req),
          drive_folder_id: issue.statement_drive_folder_id || request.drive_folder_id || null,
          drive_folder_url: issue.statement_drive_folder_url || request.drive_folder_url || null,
        })
        .select("id")
        .single();
      if (insErr || !inserted) throw new Error(insErr?.message || "Could not save the statement.");

      await (supabase.from as any)("qc_statement_requests").update({
        draft,
        status: "submitted",
        submitted_at: now,
        last_saved_at: now,
        updated_at: now,
      }).eq("id", request.id);

      await (supabase.from as any)("qc_issues").update({
        statement_required: true,
        statement_status: "submitted",
        statement_submitted_at: now,
        updated_at: now,
      }).eq("id", issue.id);

      await (supabase.from as any)("qc_issue_events").insert({
        issue_id: issue.id,
        action: "statement_submitted",
        note: `Contractor statement ${sequence > 1 ? `(supplemental #${sequence}) ` : ""}submitted and attested by ${draft.attestationName}.`,
        actor_name: draft.attestationName,
        data: { request_id: request.id, submission_id: inserted.id, sequence, kind: request.kind },
      });

      await supabase.from("events").insert({
        event_type: "qc.statement.submitted",
        booking_id: issue.booking_id || null,
        job_id: issue.job_id || null,
        cleaner_id: request.cleaner_id,
        source: "qc-statement",
        summary:
          `Contractor statement received on QC #${issue.issue_number || ""} (${issue.booking_ref || ""}). ` +
          `Attested by ${draft.attestationName}. Parallel to the reported account — no conclusion implied.`,
        data: { issue_id: issue.id, request_id: request.id, submission_id: inserted.id, sequence },
      }).then(() => undefined, () => undefined);

      return { id: String(inserted.id), sequence };
    },
    generate: async (saved) => {
      if (failPdf) throw new Error("simulated PDF generation failure");
      const job = await loadJob(supabase, String(issue.booking_id || "") || null);
      const { data: cleaner } = await (supabase.from as any)("cleaners")
        .select("first_name, last_name")
        .eq("id", request.cleaner_id)
        .maybeSingle();
      const bytes = await buildQcStatementPdf({
        issueNumber: Number(issue.issue_number) || String(issue.id).slice(0, 8),
        bookingRef: String(issue.booking_ref || ""),
        serviceDate: formatServiceDate(job?.service_date || null),
        generalLocation: generalLocation(job?.city, job?.state),
        serviceType: String(job?.service_type || "").replace(/_/g, " "),
        contractorName: cleaner
          ? `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim()
          : String(issue.cleaner_name || ""),
        kind: String(request.kind || "original"),
        sequence: saved.sequence,
        reportSummary: String(issue.statement_report_summary || request.report_summary || ""),
        account: draft.account,
        arrived: draft.arrived,
        started: draft.started,
        left: draft.left,
        timelineNotes: draft.timelineNotes,
        reportResponse: draft.reportResponse,
        othersPresent: draft.othersPresent,
        attestationName: draft.attestationName,
        attestedAt,
        attachmentNames: draft.attachments.map((a) => a.filename),
        driveFolderUrl: String(issue.statement_drive_folder_url || request.drive_folder_url || "") || null,
        submittedAt: now,
      });
      const pdfPath = `statements/${issue.id}/${saved.id}.pdf`;
      const { error: upErr } = await supabase.storage.from(QC_STATEMENT_STORAGE_BUCKET).upload(pdfPath, bytes, {
        contentType: "application/pdf",
        upsert: true,
      });
      if (upErr) throw upErr;
      await (supabase.from as any)("qc_statement_submissions").update({
        pdf_path: pdfPath,
        pdf_status: "generated",
        pdf_attempts: 1,
        pdf_last_error: null,
      }).eq("id", saved.id);
    },
    onPdfFailure: async (saved, err) => {
      await (supabase.from as any)("qc_statement_submissions").update({
        pdf_status: "failed",
        pdf_attempts: 1,
        pdf_last_error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      }).eq("id", saved.id);
      await supabase.from("events").insert({
        event_type: "qc.statement.pdf_failed",
        booking_id: issue.booking_id || null,
        job_id: issue.job_id || null,
        cleaner_id: request.cleaner_id,
        source: "qc-statement",
        summary: `Statement PDF failed on QC #${issue.issue_number || ""} — the statement itself is saved and will be retried.`,
        data: { issue_id: issue.id, submission_id: saved.id },
      }).then(() => undefined, () => undefined);
    },
  });

  try {
    await supabase.functions.invoke("qc-statement-drive", {
      body: { action: "finalize", submissionId: result.saved.id, failPdf: failPdf || undefined },
    });
  } catch {
    /* Drive is best-effort; statement already saved */
  }

  return NextResponse.json({
    ok: true,
    submitted: true,
    pdfOk: result.pdfOk,
    pdfFailed: !result.pdfOk,
    statementIntact: true,
    sequence: result.saved.sequence,
  });
}

void QC_STATEMENT_STORAGE_BUCKET;

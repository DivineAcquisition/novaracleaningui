"use client";

import { useEffect, useState } from "react";
import { RiExternalLinkLine, RiLoader4Line } from "@remixicon/react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { QC_STATEMENT_STORAGE_BUCKET } from "@/lib/qc-statement";

export interface StatementIssue {
  id: string;
  issue_number?: number;
  cleaner_id?: string | null;
  description?: string | null;
  title?: string;
  client_name?: string | null;
  manager_account?: string | null;
  contractor_statement?: string | null;
  client_written_communication?: string | null;
  client_followup_documents?: Array<Record<string, unknown>> | null;
  statement_required?: boolean | null;
  statement_status?: string | null;
  statement_due_at?: string | null;
  statement_requested_at?: string | null;
  statement_submitted_at?: string | null;
  statement_not_provided_at?: string | null;
  statement_drive_folder_url?: string | null;
  statement_report_summary?: string | null;
}

interface Submission {
  id: string;
  sequence: number;
  kind: string;
  account_text: string;
  timeline_arrived: string | null;
  timeline_started: string | null;
  timeline_left: string | null;
  timeline_notes: string | null;
  report_response: string;
  others_present: string | null;
  attestation_name: string;
  attested_at: string;
  submitted_at: string;
  pdf_path: string | null;
  pdf_status: string;
  pdf_last_error: string | null;
  attachments: Array<{ filename?: string; storagePath?: string }>;
  drive_folder_url: string | null;
}

interface RequestRow {
  id: string;
  status: string;
  kind: string;
  due_at: string;
  sent_at: string | null;
  emailed: boolean;
  sms_sent: boolean;
  reminder_sent_at: string | null;
  submitted_at: string | null;
  not_provided_at: string | null;
}

const fmtDT = (iso?: string | null) => (iso ? format(new Date(iso), "MMM d, yyyy h:mm a") : "—");

const STATUS_STYLE: Record<string, string> = {
  none: "bg-slate-100 text-slate-600",
  requested: "bg-amber-100 text-amber-800",
  submitted: "bg-emerald-100 text-emerald-800",
  not_provided: "bg-slate-200 text-slate-700",
};

export function statementStatusLabel(status?: string | null, dates?: { requested?: string | null; submitted?: string | null; notProvided?: string | null }) {
  if (status === "submitted") return `Submitted${dates?.submitted ? ` ${fmtDT(dates.submitted)}` : ""}`;
  if (status === "not_provided") return `Not provided${dates?.notProvided ? ` ${fmtDT(dates.notProvided)}` : ""}`;
  if (status === "requested") return `Requested${dates?.requested ? ` ${fmtDT(dates.requested)}` : ""}`;
  return "Not requested";
}

export default function QcStatementPanel({
  issue,
  reportedAccount,
  reload,
}: {
  issue: StatementIssue;
  reportedAccount: string;
  reload: () => Promise<void>;
}) {
  const [subs, setSubs] = useState<Submission[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [reportSummary, setReportSummary] = useState(issue.statement_report_summary || "");
  const [pdfUrls, setPdfUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    setReportSummary(issue.statement_report_summary || "");
  }, [issue.id, issue.statement_report_summary]);

  useEffect(() => {
    void (async () => {
      const [s, r] = await Promise.all([
        (supabase.from as any)("qc_statement_submissions")
          .select("id, sequence, kind, account_text, timeline_arrived, timeline_started, timeline_left, timeline_notes, report_response, others_present, attestation_name, attested_at, submitted_at, pdf_path, pdf_status, pdf_last_error, attachments, drive_folder_url")
          .eq("issue_id", issue.id)
          .order("sequence", { ascending: true }),
        (supabase.from as any)("qc_statement_requests")
          .select("id, status, kind, due_at, sent_at, emailed, sms_sent, reminder_sent_at, submitted_at, not_provided_at")
          .eq("issue_id", issue.id)
          .order("created_at", { ascending: true }),
      ]);
      const rows = (s.data || []) as Submission[];
      setSubs(rows);
      setRequests((r.data || []) as RequestRow[]);
      const urls: Record<string, string> = {};
      for (const row of rows) {
        if (row.pdf_path && row.pdf_status === "generated") {
          const { data } = await supabase.storage.from(QC_STATEMENT_STORAGE_BUCKET).createSignedUrl(row.pdf_path, 3600);
          if (data?.signedUrl) urls[row.id] = data.signedUrl;
        }
      }
      setPdfUrls(urls);
    })();
  }, [issue.id, issue.statement_submitted_at, issue.statement_status]);

  const invoke = async (body: Record<string, unknown>, key: string, success: string) => {
    setBusy(key);
    try {
      const { data, error } = await supabase.functions.invoke("qc-issues", {
        body: { issueId: issue.id, ...body },
      });
      if (error) throw error;
      if ((data as { ok?: boolean; error?: string })?.ok === false) {
        throw new Error((data as { error?: string }).error || "Failed");
      }
      const d = data as { emailed?: boolean; smsSent?: boolean; emailError?: string; smsError?: string };
      const reach = d.emailed || d.smsSent
        ? ` Email ${d.emailed ? "sent" : "not sent"}; SMS ${d.smsSent ? "sent" : "not sent"}.`
        : "";
      toast.success(success + reach);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const retryPdf = async (submissionId: string) => {
    setBusy(`pdf-${submissionId}`);
    try {
      const { data, error } = await supabase.functions.invoke("qc-statement-drive", {
        body: { action: "finalize", submissionId },
      });
      if (error) throw error;
      if ((data as { pdfFailed?: boolean })?.pdfFailed) throw new Error((data as { pdfError?: string }).pdfError || "PDF still failed");
      toast.success("PDF generated.");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF retry failed — statement is still on file.");
    } finally {
      setBusy(null);
    }
  };

  const status = issue.statement_status || "none";
  const openRequest = requests.filter((r) => r.status === "requested").at(-1);

  return (
    <div className="rounded-xl border border-slate-200 p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold text-slate-800">Contractor statement</p>
        <Badge className={cn("border-0", STATUS_STYLE[status] || STATUS_STYLE.none)}>
          {statementStatusLabel(status, {
            requested: issue.statement_requested_at,
            submitted: issue.statement_submitted_at,
            notProvided: issue.statement_not_provided_at,
          })}
        </Badge>
        {issue.statement_due_at && status === "requested" && (
          <span className="text-[11px] text-slate-500">Due {fmtDT(issue.statement_due_at)}</span>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Reported account and contractor statement are kept as parallel records. Submitting a statement never edits a prior one.
        Non-response is recorded factually and never changes Score, accountability, or case status on its own.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Reported account</p>
          <p className="text-xs text-slate-800 whitespace-pre-wrap">{reportedAccount || "No reported account on file."}</p>
        </div>
        <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-800">Contractor statement</p>
          {subs.length === 0 && (
            <p className="text-xs text-slate-600">
              {status === "not_provided"
                ? `Not provided as of ${fmtDT(issue.statement_not_provided_at)}. No inference of guilt.`
                : status === "requested"
                  ? "Requested — awaiting the contractor's written account."
                  : "No contractor-submitted statement yet."}
            </p>
          )}
          {subs.map((s) => (
            <div key={s.id} className="space-y-1 border-t border-violet-100 pt-2 first:border-0 first:pt-0">
              <p className="text-[11px] font-semibold text-violet-900">
                #{s.sequence} {s.kind} · {fmtDT(s.submitted_at)} · attested by {s.attestation_name} at {fmtDT(s.attested_at)}
              </p>
              <p className="text-xs text-slate-800 whitespace-pre-wrap">{s.account_text}</p>
              <p className="text-[11px] text-slate-600">
                Timeline: arrived {s.timeline_arrived || "—"} · started {s.timeline_started || "—"} · left {s.timeline_left || "—"}
              </p>
              {s.timeline_notes && <p className="text-[11px] text-slate-600 whitespace-pre-wrap">{s.timeline_notes}</p>}
              <p className="text-[11px] font-semibold text-slate-700 mt-1">Response to the report</p>
              <p className="text-xs text-slate-800 whitespace-pre-wrap">{s.report_response}</p>
              <p className="text-[11px] text-slate-600">Others present: {s.others_present || "—"}</p>
              {(s.attachments || []).length > 0 && (
                <p className="text-[11px] text-slate-600">
                  Uploads: {(s.attachments || []).map((a) => a.filename).filter(Boolean).join(", ")}
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                {pdfUrls[s.id] && (
                  <a href={pdfUrls[s.id]} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-violet-700 hover:underline">
                    Open PDF
                  </a>
                )}
                {s.pdf_status === "failed" && (
                  <Button size="sm" variant="outline" disabled={busy === `pdf-${s.id}`} onClick={() => void retryPdf(s.id)}>
                    {busy === `pdf-${s.id}` ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                    Retry PDF
                  </Button>
                )}
                {s.pdf_status === "failed" && (
                  <span className="text-[11px] text-amber-800">PDF flagged for retry — statement is intact.</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {(issue.statement_drive_folder_url || subs[0]?.drive_folder_url) && (
        <a
          href={String(issue.statement_drive_folder_url || subs[0]?.drive_folder_url)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:underline"
        >
          <RiExternalLinkLine className="w-3.5 h-3.5" /> Contractor statement Drive folder
        </a>
      )}

      <Separator />
      <Label className="text-xs text-slate-700">What is shown on the form as the factual report (not sent in SMS/email)</Label>
      <Textarea rows={4} value={reportSummary} onChange={(e) => setReportSummary(e.target.value)} />

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!!busy || !issue.cleaner_id}
          onClick={() => void invoke({
            action: subs.length ? "request_statement_supplemental" : "request_statement",
            statementReportSummary: reportSummary,
          }, "send", subs.length ? "Supplemental statement requested." : "Statement requested.")}
        >
          {busy === "send" ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
          {subs.length ? "Request supplemental statement" : openRequest ? "Resend statement link" : "Request statement"}
        </Button>
        {issue.statement_required ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy}
            onClick={() => void invoke({ action: "set_statement_required", statementRequired: false }, "clear", "Statement required cleared.")}
          >
            Clear required
          </Button>
        ) : (
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <Checkbox
              checked={false}
              disabled={!!busy || !issue.cleaner_id}
              onCheckedChange={(v) => {
                if (v === true) {
                  void invoke({
                    action: "set_statement_required",
                    statementRequired: true,
                    statementReportSummary: reportSummary,
                  }, "send", "Statement marked required and sent.");
                }
              }}
            />
            Mark statement required and send
          </label>
        )}
      </div>
      {!issue.cleaner_id && (
        <p className="text-[11px] text-amber-800">Attach a contractor before sending the statement link.</p>
      )}
      {openRequest && (
        <p className="text-[11px] text-slate-500">
          Open request: {openRequest.kind} · due {fmtDT(openRequest.due_at)} · email {openRequest.emailed ? "sent" : "no"} · SMS {openRequest.sms_sent ? "sent" : "no"}
          {openRequest.reminder_sent_at ? ` · reminded ${fmtDT(openRequest.reminder_sent_at)}` : ""}
        </p>
      )}
    </div>
  );
}

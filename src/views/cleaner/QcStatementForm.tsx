"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { RiCheckLine, RiLoader4Line, RiUpload2Line } from "@remixicon/react";

import { TokenPageShell, TokenPanel } from "@/components/token/TokenPageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  EMPTY_QC_STATEMENT_DRAFT,
  qcStatementDraftComplete,
  type QcStatementDraft,
} from "@/lib/qc-statement";

type Payload = {
  ok: true;
  submitted: boolean;
  kind: string;
  dueAt: string | null;
  dueLabel: string | null;
  cleaner: { firstName: string; name: string };
  job: {
    bookingRef: string;
    serviceDate: string;
    generalLocation: string;
    serviceType: string;
    timeSlot: string | null;
  };
  reportSummary: string;
  draft: QcStatementDraft;
  priorStatements: Array<{ id: string; sequence: number; kind: string; submitted_at: string }>;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: Payload }
  | { kind: "blocked"; message: string };

export default function QcStatementForm() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [draft, setDraft] = useState<QcStatementDraft>(EMPTY_QC_STATEMENT_DRAFT);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setState({ kind: "blocked", message: "This link isn't valid." });
      return;
    }
    try {
      const res = await fetch(`/api/cleaner/statement/${encodeURIComponent(token)}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || "This link isn't valid.");
      }
      const data = json as Payload;
      setState({ kind: "ready", data });
      setDraft(data.draft);
      setSubmitted(data.submitted);
    } catch (e) {
      setState({ kind: "blocked", message: e instanceof Error ? e.message : "This link isn't valid." });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback(
    async (next: QcStatementDraft) => {
      if (!token || submitted) return;
      setSaveState("saving");
      try {
        const res = await fetch(`/api/cleaner/statement/${encodeURIComponent(token)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft: next }),
        });
        if (!res.ok) throw new Error("save failed");
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 1200);
      } catch {
        setSaveState("error");
      }
    },
    [token, submitted],
  );

  const updateDraft = (patch: Partial<QcStatementDraft>) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void persist(next), 400);
      return next;
    });
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length || !token || submitted) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`/api/cleaner/statement/${encodeURIComponent(token)}/upload`, {
          method: "POST",
          body: form,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Upload failed");
        if (json.draft) setDraft(json.draft);
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!qcStatementDraftComplete(draft) || submitting || submitted) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/cleaner/statement/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", draft }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) throw new Error(json?.error || "Could not submit.");
      setSubmitted(true);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not submit.");
    } finally {
      setSubmitting(false);
    }
  };

  if (state.kind === "loading") {
    return (
      <TokenPageShell title="Contractor statement">
        <TokenPanel>
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <RiLoader4Line className="h-4 w-4 animate-spin" /> Opening your form…
          </p>
        </TokenPanel>
      </TokenPageShell>
    );
  }

  if (state.kind === "blocked") {
    return (
      <TokenPageShell title="This link isn't available" subtitle={state.message}>
        <TokenPanel>
          <p className="text-sm text-slate-600">Ask the office to send a fresh statement link if you still need to respond.</p>
        </TokenPanel>
      </TokenPageShell>
    );
  }

  const { data } = state;
  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Couldn't save — keep typing" : "";

  if (submitted) {
    return (
      <TokenPageShell
        eyebrow="On the record"
        title="Your statement is in"
        subtitle="Thank you. Your written account is part of the case record. If you need to add or correct something, the office will send a new form — this one is not edited."
      >
        <TokenPanel>
          <p className="text-sm text-slate-700">
            Submitted for the job at {data.job.generalLocation} on {data.job.serviceDate}. No conclusion has been reached from this form.
          </p>
        </TokenPanel>
      </TokenPageShell>
    );
  }

  return (
    <TokenPageShell
      eyebrow="Written statement"
      title="Your account of what happened"
      subtitle="This is your opportunity to give your side in writing. It becomes part of the case record. No conclusion has been reached."
      topBar={saveLabel ? <span className={cn(saveState === "error" ? "text-rose-600" : "text-slate-500")}>{saveLabel}</span> : null}
    >
      <TokenPanel>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Job in question</p>
        <p className="mt-1 text-sm font-semibold text-slate-900">
          {data.job.serviceType} · {data.job.serviceDate}
        </p>
        <p className="text-sm text-slate-600">{data.job.generalLocation}{data.job.timeSlot ? ` · ${data.job.timeSlot}` : ""}</p>
        {data.dueLabel && (
          <p className="mt-2 text-xs text-slate-500">Please submit by {data.dueLabel}.</p>
        )}
      </TokenPanel>

      <TokenPanel>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">What has been reported</p>
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{data.reportSummary || "A report was received about this visit. Details are on file with the office."}</p>
        <p className="mt-3 text-xs text-slate-500">
          Stated factually so you can respond to something specific. This is not a finding.
        </p>
      </TokenPanel>

      {data.priorStatements.length > 0 && (
        <TokenPanel>
          <p className="text-sm font-semibold text-slate-800">Earlier statements on this case</p>
          <p className="mt-1 text-xs text-slate-500">Those submissions stay on the record. This form is an addition, not a replacement.</p>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {data.priorStatements.map((s) => (
              <li key={s.id}>
                #{s.sequence} · {s.kind} · {new Date(s.submitted_at).toLocaleString()}
              </li>
            ))}
          </ul>
        </TokenPanel>
      )}

      <TokenPanel>
        <Label className="text-sm font-semibold text-slate-800">Your account of what happened</Label>
        <Textarea
          className="mt-2"
          rows={8}
          value={draft.account}
          onChange={(e) => updateDraft({ account: e.target.value })}
          placeholder="Describe what happened in your own words."
        />
      </TokenPanel>

      <TokenPanel>
        <p className="text-sm font-semibold text-slate-800">Timeline</p>
        <p className="mb-3 text-xs text-slate-500">Arrival, start, and departure — and anything notable in between.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label className="text-xs">Arrived</Label>
            <Input className="mt-1" value={draft.arrived} onChange={(e) => updateDraft({ arrived: e.target.value })} placeholder="e.g. 12:10 PM" />
          </div>
          <div>
            <Label className="text-xs">Started</Label>
            <Input className="mt-1" value={draft.started} onChange={(e) => updateDraft({ started: e.target.value })} placeholder="e.g. 12:20 PM" />
          </div>
          <div>
            <Label className="text-xs">Left</Label>
            <Input className="mt-1" value={draft.left} onChange={(e) => updateDraft({ left: e.target.value })} placeholder="e.g. 3:40 PM" />
          </div>
        </div>
        <Label className="mt-3 block text-xs">Anything notable in between</Label>
        <Textarea
          className="mt-1"
          rows={3}
          value={draft.timelineNotes}
          onChange={(e) => updateDraft({ timelineNotes: e.target.value })}
        />
      </TokenPanel>

      <TokenPanel>
        <Label className="text-sm font-semibold text-slate-800">Direct response to the report</Label>
        <p className="mb-2 text-xs text-slate-500">Address the reported issue itself, not only a general narrative.</p>
        <Textarea
          rows={6}
          value={draft.reportResponse}
          onChange={(e) => updateDraft({ reportResponse: e.target.value })}
        />
      </TokenPanel>

      <TokenPanel>
        <Label className="text-sm font-semibold text-slate-800">Was anyone else present?</Label>
        <p className="mb-2 text-xs text-slate-500">Client, other contractors, or anyone who could corroborate — or say if you were alone.</p>
        <Textarea
          rows={3}
          value={draft.othersPresent}
          onChange={(e) => updateDraft({ othersPresent: e.target.value })}
        />
      </TokenPanel>

      <TokenPanel>
        <p className="text-sm font-semibold text-slate-800">Supporting documentation</p>
        <p className="mb-2 text-xs text-slate-500">Photos, message screenshots, receipts — uploaded as you select them.</p>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          <RiUpload2Line className="h-4 w-4" />
          {uploading ? "Uploading…" : "Add files"}
          <input
            type="file"
            className="hidden"
            multiple
            accept="image/*,.pdf,.txt"
            disabled={uploading}
            onChange={(e) => {
              void uploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <ul className="mt-3 space-y-1 text-xs text-slate-600">
          {draft.attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-1">
              <RiCheckLine className="h-3.5 w-3.5 text-emerald-600" />
              {a.filename}
              {a.driveFileId ? " · saved" : " · uploaded"}
            </li>
          ))}
        </ul>
      </TokenPanel>

      <TokenPanel>
        <p className="text-sm font-semibold text-slate-800">Attestation</p>
        <p className="mb-3 text-xs text-slate-500">
          I confirm this statement is true and accurate to the best of my knowledge. My name and the submission time are recorded.
        </p>
        <Label className="text-xs">Your name</Label>
        <Input
          className="mt-1"
          value={draft.attestationName}
          onChange={(e) => updateDraft({ attestationName: e.target.value })}
        />
        <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
          <Checkbox
            checked={draft.attested}
            onCheckedChange={(v) => updateDraft({ attested: v === true })}
          />
          I attest that this statement is true and accurate to the best of my knowledge.
        </label>
      </TokenPanel>

      {notice && <p className="text-sm text-rose-600">{notice}</p>}

      <Button
        className="w-full"
        disabled={!qcStatementDraftComplete(draft) || submitting}
        onClick={() => void submit()}
      >
        {submitting ? <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" /> : <RiCheckLine className="mr-1.5 h-4 w-4" />}
        Submit statement
      </Button>
    </TokenPageShell>
  );
}

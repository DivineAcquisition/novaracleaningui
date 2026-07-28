"use client";

// ─── The EOD form ─────────────────────────────────────────────────────────────
//
// A flat form: hours (read-only, from Apploye), ten metrics, four selects with
// conditional follow-ups, then priorities and notes.
//
// Each metric shows the system's own count beside the input — "GHL shows 22" —
// or "not tracked" where no source exists yet. The VA still enters their own
// number; the two are compared on submit. Showing the count up front means the
// comparison is never a gotcha: if they disagree with it, they can say so in
// the same breath.
//
// Autosaves continuously. Editable until the daily cutoff, read-only after.

import {
  RiAlertLine,
  RiCheckLine,
  RiCheckboxCircleFill,
  RiErrorWarningLine,
  RiFilePdfLine,
  RiLoader4Line,
  RiLockLine,
  RiSendPlaneFill,
} from "@remixicon/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CLOSING_FIELDS,
  CORE_HOURS_METRIC,
  METRIC_FIELDS,
  SELECT_FIELDS,
  followUpRequired,
  formatMetricEntry,
  validateSubmission,
  type MetricField,
  type SelectField,
} from "@/lib/va-performance/catalog";
import type { MetricKey } from "@/lib/va-performance/metrics";

import { VerifiedField } from "./VerifiedField";
import type { BootstrapPayload, FlagSummary } from "./types";

type SaveState = "idle" | "saving" | "saved" | "error";

interface FormState {
  metrics: Record<string, string>;
  selects: Record<string, string>;
  text: Record<string, string>;
}

function initialState(boot: BootstrapPayload): FormState {
  const s = boot.submission;
  const metrics: Record<string, string> = {};
  for (const field of METRIC_FIELDS) {
    const stored = s.metrics?.[field.key];
    if (stored === undefined || stored === null) continue;
    metrics[field.key] = String(field.currency ? stored / 100 : stored);
  }
  return {
    metrics,
    selects: { ...(s.selects || {}) },
    text: {
      blockers: s.blockers || "",
      escalations: s.escalations || "",
      cleaner_issue_notes: s.cleanerIssueNotes || "",
      priorities: s.priorities || "",
      wins: s.wins || "",
    },
  };
}

/** The system's own count for a metric, or null when there's no signal. */
function signalFor(field: MetricField, boot: BootstrapPayload): number | null {
  if (!field.corroborate) return null;
  let total: number | null = null;
  for (const key of field.corroborate.metrics as MetricKey[]) {
    const value = boot.verified.values[key];
    if (value === null || value === undefined) continue;
    total = (total ?? 0) + value;
  }
  return total;
}

export default function EodForm({
  boot,
  onReload,
  api,
}: {
  boot: BootstrapPayload;
  onReload: (workDate?: string) => Promise<void>;
  api: (body: Record<string, unknown>) => Promise<{ ok: boolean; data: Record<string, unknown> }>;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(boot));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [flags, setFlags] = useState<FlagSummary[]>(
    boot.flags.filter((f) => f.workDate === boot.workDate),
  );

  const submitted = boot.submission.status !== "draft";
  const readOnly = boot.locked;

  const skipNextSave = useRef(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setForm(initialState(boot));
    setFlags(boot.flags.filter((f) => f.workDate === boot.workDate));
    skipNextSave.current = true;
    setSaveState("idle");
  }, [boot]);

  const payload = useMemo(
    () => ({ metrics: form.metrics, selects: form.selects, text: form.text }),
    [form],
  );

  const flush = useCallback(async () => {
    if (readOnly) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setSaveState("saving");
    const res = await api({ action: "save", workDate: boot.workDate, patch: payload });
    setSaveState(res.ok ? "saved" : "error");
  }, [api, boot.workDate, payload, readOnly]);

  useEffect(() => {
    if (readOnly) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), 900);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [payload, flush, readOnly]);

  const issues = useMemo(
    () => validateSubmission({ metrics: form.metrics, selects: form.selects, text: form.text }),
    [form],
  );
  const issueByField = useMemo(
    () => new Map(issues.map((i) => [i.field, i.message])),
    [issues],
  );

  const setMetric = (key: string, value: string) =>
    setForm((f) => ({ ...f, metrics: { ...f.metrics, [key]: value } }));
  const setSelect = (key: string, value: string) =>
    setForm((f) => ({ ...f, selects: { ...f.selects, [key]: value } }));
  const setText = (key: string, value: string) =>
    setForm((f) => ({ ...f, text: { ...f.text, [key]: value } }));

  const submit = async () => {
    setShowErrors(true);
    if (issues.length) {
      toast.error(`${issues.length} field${issues.length === 1 ? "" : "s"} still needs an answer.`);
      document.getElementById(`f-${issues[0].field}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSubmitting(true);
    try {
      await flush();
      const res = await api({ action: "submit", workDate: boot.workDate, patch: payload });
      if (!res.ok) {
        const list = (res.data.issues as { message: string }[]) || [];
        toast.error(list[0]?.message || String(res.data.error || "Couldn't submit."));
        return;
      }
      const newFlags = (res.data.flags as FlagSummary[]) || [];
      if (newFlags.length) {
        toast.warning(
          `Submitted. ${newFlags.length} number${newFlags.length === 1 ? "" : "s"} didn't line up with what we recorded — add a quick note below.`,
        );
      } else {
        toast.success("EOD submitted. Have a good evening.");
      }
      await onReload(boot.workDate);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5 pb-28">
      <StatusStrip boot={boot} submitted={submitted} readOnly={readOnly} saveState={saveState} />

      {/* ── Hours ─────────────────────────────────────────────────────── */}
      <Card className="border-slate-200 p-5">
        <SectionHeading
          title="Hours"
          subtitle="From Apploye. Read-only — if it looks wrong, say so in your notes."
        />
        <div className="mt-3">
          <VerifiedField
            metric={CORE_HOURS_METRIC}
            values={boot.verified.values}
            provenance={boot.verified.provenance}
            emphasis
          />
        </div>
      </Card>

      {/* ── Metrics ───────────────────────────────────────────────────── */}
      <Card className="border-slate-200 p-5">
        <SectionHeading
          title="Today's numbers"
          subtitle="Every field needs an answer. Enter 0 if there were none — a blank tells us nothing."
        />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {METRIC_FIELDS.map((field) => (
            <MetricInput
              key={field.key}
              field={field}
              value={form.metrics[field.key] ?? ""}
              onChange={(v) => setMetric(field.key, v)}
              signal={signalFor(field, boot)}
              error={showErrors ? issueByField.get(field.key) : undefined}
              disabled={readOnly}
            />
          ))}
        </div>
      </Card>

      {/* ── Selects ───────────────────────────────────────────────────── */}
      <Card className="border-slate-200 p-5">
        <SectionHeading title="How the day went" subtitle="None of this is scored." />
        <div className="mt-4 space-y-5">
          {SELECT_FIELDS.map((field) => (
            <SelectRow
              key={field.key}
              field={field}
              answer={form.selects[field.key] ?? ""}
              followUpValue={field.followUp ? (form.text[field.followUp.key] ?? "") : ""}
              onAnswer={(v) => setSelect(field.key, v)}
              onFollowUp={(v) => field.followUp && setText(field.followUp.key, v)}
              error={showErrors ? issueByField.get(field.key) : undefined}
              followUpError={
                showErrors && field.followUp ? issueByField.get(field.followUp.key) : undefined
              }
              disabled={readOnly}
            />
          ))}
        </div>
      </Card>

      {/* ── Closing ───────────────────────────────────────────────────── */}
      <Card className="border-slate-200 p-5">
        <SectionHeading title="Looking ahead" />
        <div className="mt-4 space-y-4">
          {CLOSING_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`f-${field.key}`} className="text-sm text-slate-700">
                {field.label}
                {!field.required && <span className="ml-1 text-xs font-normal text-slate-400">optional</span>}
              </Label>
              <Textarea
                id={`f-${field.key}`}
                rows={field.key === "priorities" ? 4 : 3}
                value={form.text[field.key] ?? ""}
                onChange={(e) => setText(field.key, e.target.value)}
                placeholder={field.placeholder}
                disabled={readOnly}
                className={cn(
                  "resize-y bg-white text-sm",
                  showErrors && issueByField.get(field.key) && "border-rose-300",
                )}
              />
              <FieldError message={showErrors ? issueByField.get(field.key) : undefined} />
            </div>
          ))}
        </div>
      </Card>

      {submitted && <SubmittedCard boot={boot} />}

      {flags.length > 0 && (
        <FlagPanel
          flags={flags}
          api={api}
          onUpdated={(flag) => setFlags((list) => list.map((f) => (f.id === flag.id ? flag : f)))}
        />
      )}

      {readOnly ? (
        <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <RiLockLine className="h-3.5 w-3.5" />
          This day is locked and can no longer be edited.
        </p>
      ) : (
        <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <div className="min-w-0 flex-1 text-xs text-slate-500">
              {showErrors && issues.length ? (
                <span className="flex items-center gap-1.5 text-rose-600">
                  <RiErrorWarningLine className="h-3.5 w-3.5 shrink-0" />
                  {issues.length} field{issues.length === 1 ? "" : "s"} to finish
                </span>
              ) : (
                <span>
                  Saves as you type. You can edit until the cutoff, then the day locks.
                </span>
              )}
            </div>
            <Button
              onClick={submit}
              disabled={submitting}
              className="h-10 shrink-0 font-semibold text-white shadow-lg shadow-[#5C0FFE]/25"
              style={{ background: "linear-gradient(135deg,#5C0FFE 0%,#8F7BFD 100%)" }}
            >
              {submitting ? (
                <>
                  <RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                <>
                  <RiSendPlaneFill className="mr-2 h-4 w-4" />
                  {submitted ? "Update EOD" : "Submit EOD"}
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="font-jakarta text-base font-bold tracking-tight text-slate-900">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-[11px] leading-snug text-rose-600">{message}</p>;
}

function StatusStrip({
  boot,
  submitted,
  readOnly,
  saveState,
}: {
  boot: BootstrapPayload;
  submitted: boolean;
  readOnly: boolean;
  saveState: SaveState;
}) {
  const saveLabel: Record<SaveState, string> = {
    idle: "Auto-saving",
    saving: "Saving…",
    saved: "Saved",
    error: "Couldn't save — retrying on your next change",
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {submitted ? (
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
          <RiCheckLine className="mr-1 h-3.5 w-3.5" />
          Submitted{boot.submission.submittedLate ? " (late)" : ""}
        </Badge>
      ) : (
        <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
          Draft
        </Badge>
      )}
      {readOnly && (
        <Badge variant="outline" className="border-slate-200 bg-slate-100 text-slate-600">
          <RiLockLine className="mr-1 h-3 w-3" />
          Locked
        </Badge>
      )}
      {!readOnly && (
        <span
          className={cn(
            "text-xs",
            saveState === "saved"
              ? "text-emerald-600"
              : saveState === "error"
                ? "text-amber-700"
                : "text-slate-400",
          )}
        >
          {saveLabel[saveState]}
        </span>
      )}
      <span className="ml-auto text-xs text-slate-500">On time before {boot.settings.cutoffLocalTime}</span>
    </div>
  );
}

function MetricInput({
  field,
  value,
  onChange,
  signal,
  error,
  disabled,
}: {
  field: MetricField;
  value: string;
  onChange: (v: string) => void;
  signal: number | null;
  error?: string;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`f-${field.key}`} className="text-sm text-slate-700">
        {field.label}
        {field.unit && <span className="ml-1 text-xs font-normal text-slate-400">({field.unit})</span>}
      </Label>
      <div className="relative">
        {field.currency && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
            $
          </span>
        )}
        <Input
          id={`f-${field.key}`}
          type="number"
          min={0}
          step={field.currency ? "0.01" : "1"}
          inputMode={field.currency ? "decimal" : "numeric"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          // Deliberately not "0": blank and zero mean different things here,
          // and a zero-looking placeholder invites people to skip the field
          // believing it's already answered.
          placeholder="—"
          className={cn("h-10 bg-white", field.currency && "pl-7", error && "border-rose-300")}
        />
      </div>
      <p className="text-[11px] leading-snug text-slate-500">{field.definition}</p>

      {/* The system's own count, or an honest admission that we can't see it. */}
      {!field.corroborate ? (
        <p className="text-[11px] leading-snug text-slate-400">
          <span className="font-medium text-slate-500">not tracked</span>
          {field.notTrackedReason ? ` — ${field.notTrackedReason}` : ""}
        </p>
      ) : signal === null ? (
        <p className="text-[11px] leading-snug text-amber-700">
          {field.corroborate.sourceLabel} is unreachable right now — nothing to compare against.
        </p>
      ) : (
        <p className="text-[11px] leading-snug text-slate-500">
          {field.corroborate.sourceLabel} shows{" "}
          <span className="font-mono font-semibold text-slate-700">
            {formatMetricEntry(field, signal)}
          </span>
        </p>
      )}
      <FieldError message={error} />
    </div>
  );
}

function SelectRow({
  field,
  answer,
  followUpValue,
  onAnswer,
  onFollowUp,
  error,
  followUpError,
  disabled,
}: {
  field: SelectField;
  answer: string;
  followUpValue: string;
  onAnswer: (v: string) => void;
  onFollowUp: (v: string) => void;
  error?: string;
  followUpError?: string;
  disabled: boolean;
}) {
  const showFollowUp = followUpRequired(field, answer);
  const urgent = field.urgentOn?.includes(answer);

  return (
    <div className="space-y-2" id={`f-${field.key}`}>
      <Label className="text-sm text-slate-700">{field.label}</Label>
      <div className="flex flex-wrap gap-2">
        {field.options.map((option) => {
          const active = answer === option;
          const isUrgentOption = field.urgentOn?.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => onAnswer(option)}
              disabled={disabled}
              aria-pressed={active}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                active
                  ? isUrgentOption
                    ? "border-rose-400 bg-rose-50 font-semibold text-rose-700"
                    : "border-[#5C0FFE] bg-[#5C0FFE]/[0.07] font-semibold text-[#5C0FFE]"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
              )}
            >
              {option}
            </button>
          );
        })}
      </div>
      <FieldError message={error} />

      {showFollowUp && field.followUp && (
        <div className="space-y-1.5 pt-1">
          <Label htmlFor={`f-${field.followUp.key}`} className="text-sm text-slate-700">
            {field.followUp.label}
          </Label>
          <Textarea
            id={`f-${field.followUp.key}`}
            rows={3}
            value={followUpValue}
            onChange={(e) => onFollowUp(e.target.value)}
            placeholder={field.followUp.placeholder}
            disabled={disabled}
            className={cn("resize-y bg-white text-sm", followUpError && "border-rose-300")}
          />
          <FieldError message={followUpError} />
          {urgent && (
            <p className="flex items-start gap-1.5 text-[11px] leading-snug text-rose-600">
              <RiAlertLine className="mt-px h-3.5 w-3.5 shrink-0" />
              This goes to Malik as soon as you submit — you don&apos;t need to chase it separately.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SubmittedCard({ boot }: { boot: BootstrapPayload }) {
  const s = boot.submission;
  const time = s.submittedAt
    ? new Date(s.submittedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : null;

  const pdf: Record<string, { label: string; tone: string }> = {
    generated: { label: "Report saved", tone: "text-emerald-600" },
    drive_pending: { label: "Report saved — filing to Drive shortly", tone: "text-slate-500" },
    failed: { label: "Report will be regenerated automatically", tone: "text-amber-700" },
    none: { label: "Report generating…", tone: "text-slate-500" },
  };
  const pdfState = pdf[s.pdfStatus] ?? pdf.none;

  return (
    <Card className="border-emerald-200 bg-emerald-50/40 p-5">
      <div className="flex items-start gap-2.5">
        <RiCheckboxCircleFill className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        <div>
          <h2 className="font-jakarta text-base font-bold tracking-tight text-slate-900">
            Submitted{time ? ` at ${time}` : ""}
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
            You can keep editing until the cutoff — changes re-save and the report is rebuilt. After
            that the day locks.
          </p>
          <p className={cn("mt-2 flex items-center gap-1.5 text-xs", pdfState.tone)}>
            <RiFilePdfLine className="h-3.5 w-3.5" />
            {pdfState.label}
          </p>
        </div>
      </div>
    </Card>
  );
}

// ─── Discrepancy flags ────────────────────────────────────────────────────────
//
// Written as a question, not a verdict. There are plenty of legitimate reasons
// a number won't match, and the VA gets to say so before anyone concludes
// anything.

function FlagPanel({
  flags,
  api,
  onUpdated,
}: {
  flags: FlagSummary[];
  api: (body: Record<string, unknown>) => Promise<{ ok: boolean; data: Record<string, unknown> }>;
  onUpdated: (flag: FlagSummary) => void;
}) {
  return (
    <Card className="border-amber-200 bg-amber-50/40 p-5">
      <div className="flex items-start gap-2">
        <RiAlertLine className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div>
          <h2 className="font-jakarta text-base font-bold tracking-tight text-slate-900">
            A couple of numbers didn&apos;t line up
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
            Not an accusation — work happens outside the systems we can see all the time. Add a line
            of context and someone will read it. Nothing happens automatically.
          </p>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {flags.map((flag) => (
          <FlagRow key={flag.id} flag={flag} api={api} onUpdated={onUpdated} />
        ))}
      </div>
    </Card>
  );
}

function FlagRow({
  flag,
  api,
  onUpdated,
}: {
  flag: FlagSummary;
  api: (body: Record<string, unknown>) => Promise<{ ok: boolean; data: Record<string, unknown> }>;
  onUpdated: (flag: FlagSummary) => void;
}) {
  const [text, setText] = useState(flag.vaExplanation || "");
  const [busy, setBusy] = useState(false);
  const settled = flag.status === "confirmed_issue" || flag.status === "dismissed";

  const save = async () => {
    if (!text.trim()) {
      toast.error("Add a short explanation.");
      return;
    }
    setBusy(true);
    const res = await api({ action: "explain", flagId: flag.id, explanation: text });
    setBusy(false);
    if (!res.ok) {
      toast.error(String(res.data.error || "Couldn't save that."));
      return;
    }
    toast.success("Thanks — that's on the record.");
    onUpdated(res.data.flag as FlagSummary);
  };

  return (
    <div className="rounded-xl border border-amber-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-sm font-semibold text-slate-900">{flag.metricLabel || flag.metricKey}</p>
        <p className="font-mono text-xs tabular-nums text-slate-500">
          you entered {flag.selfReported} · we recorded {flag.verified}
        </p>
        <Badge
          variant="outline"
          className={cn(
            "ml-auto text-[10px]",
            flag.severity === "high"
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : flag.severity === "medium"
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-slate-200 bg-slate-50 text-slate-600",
          )}
        >
          {flag.severity}
        </Badge>
      </div>

      {settled ? (
        <p className="mt-2 text-xs text-slate-600">
          Reviewed — marked <span className="font-semibold">{flag.status.replace("_", " ")}</span>.
          {flag.reviewNote ? ` "${flag.reviewNote}"` : ""}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <Textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What accounts for the difference?"
            className="resize-y bg-white text-sm"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={save} disabled={busy}>
              {busy ? <RiLoader4Line className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {flag.vaExplanation ? "Update explanation" : "Add explanation"}
            </Button>
            {flag.vaExplanation && (
              <span className="text-[11px] text-slate-500">Saved — waiting on review.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

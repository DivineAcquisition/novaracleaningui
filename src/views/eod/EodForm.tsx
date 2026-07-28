"use client";

// ─── The adaptive EOD form ────────────────────────────────────────────────────
//
// Select the tasks you actually worked on; only those question blocks appear.
// Everything the system already observed is pre-filled and read-only, so the
// form is short: the VA supplies what no source can see.
//
// Autosaves as a draft while you type. One submission per day — re-opening the
// same day edits it until it locks.

import {
  RiAlertLine,
  RiCheckLine,
  RiCloudOffLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiSendPlaneFill,
  RiShieldCheckLine,
  RiTimeLine,
} from "@remixicon/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CORE_FIELDS,
  CORE_HOURS_METRIC,
  isChoice,
  isTier1,
  isTier2,
  TASK_CATEGORIES,
  TASKS,
  tasksFor,
  validateSubmission,
  type ChoiceField,
  type TaskDef,
  type Tier2Field,
  type Tier3Field,
} from "@/lib/va-performance/catalog";
import type { MetricKey } from "@/lib/va-performance/metrics";

import { AutoFilledNote, VerifiedField } from "./VerifiedField";
import type { BootstrapPayload, FlagSummary } from "./types";

type SaveState = "idle" | "saving" | "saved" | "error";

interface FormState {
  tasks: string[];
  numbers: Record<string, string>;
  notes: Record<string, string | string[]>;
  core: Record<string, string>;
}

function initialState(boot: BootstrapPayload): FormState {
  const s = boot.submission;
  return {
    tasks: s.tasksSelected || [],
    numbers: Object.fromEntries(
      Object.entries(s.selfReported || {}).map(([k, v]) => [k, String(v)]),
    ),
    notes: { ...(s.taskNotes || {}) },
    core: {
      blockers: s.blockers || "",
      priorities: s.priorities || "",
      wins: s.wins || "",
      escalations: s.escalations || "",
    },
  };
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
    () => ({
      tasksSelected: form.tasks,
      selfReported: form.numbers,
      taskNotes: form.notes,
      ...form.core,
    }),
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

  // Debounced autosave. Never fires on the initial hydrate.
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

  const selectedTasks = useMemo(() => tasksFor(form.tasks), [form.tasks]);

  const issues = useMemo(
    () =>
      validateSubmission({
        tasksSelected: form.tasks,
        selfReported: form.numbers,
        taskNotes: form.notes,
      }),
    [form],
  );

  const toggleTask = (id: string) => {
    if (readOnly) return;
    setForm((f) => ({
      ...f,
      tasks: f.tasks.includes(id) ? f.tasks.filter((t) => t !== id) : [...f.tasks, id],
    }));
  };

  const setNumber = (key: string, value: string) =>
    setForm((f) => ({ ...f, numbers: { ...f.numbers, [key]: value } }));

  const setNote = (key: string, value: string | string[]) =>
    setForm((f) => ({ ...f, notes: { ...f.notes, [key]: value } }));

  const setCore = (key: string, value: string) =>
    setForm((f) => ({ ...f, core: { ...f.core, [key]: value } }));

  const submit = async () => {
    if (issues.length) {
      toast.error(issues[0].message);
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
          `Submitted. ${newFlags.length} number${newFlags.length === 1 ? "" : "s"} didn't line up with what we recorded — add a quick explanation below.`,
        );
      } else {
        toast.success("EOD submitted. Have a good evening.");
      }
      await onReload(boot.workDate);
    } finally {
      setSubmitting(false);
    }
  };

  const hoursVerified =
    boot.verified.values[CORE_HOURS_METRIC] !== null &&
    boot.verified.values[CORE_HOURS_METRIC] !== undefined;

  return (
    <div className="space-y-6 pb-24">
      {/* ── Status strip ─────────────────────────────────────────────── */}
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
            Locked — ask an admin if this needs to change
          </Badge>
        )}
        <SaveIndicator state={saveState} readOnly={readOnly} />
        <span className="ml-auto flex items-center gap-1 text-xs text-slate-500">
          <RiTimeLine className="h-3.5 w-3.5" />
          On time before {boot.settings.cutoffLocalTime}
        </span>
      </div>

      {/* ── Core block ───────────────────────────────────────────────── */}
      <Card className="border-slate-200 p-5">
        <SectionHeading
          title="Today at a glance"
          subtitle="Hours come from Apploye. Everything below is yours — it's never scored."
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <VerifiedField
            metric={CORE_HOURS_METRIC}
            values={boot.verified.values}
            provenance={boot.verified.provenance}
            emphasis
          />
        </div>
        {!hoursVerified && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-amber-700">
            <RiCloudOffLine className="mt-px h-3.5 w-3.5 shrink-0" />
            We couldn&apos;t reach Apploye for this date. Submit anyway — it&apos;ll fill in on the next sync.
          </p>
        )}

        <div className="mt-5 space-y-4">
          {CORE_FIELDS.map((field) => (
            <QualitativeInput
              key={field.key}
              field={field}
              value={String(form.core[field.key] ?? "")}
              onChange={(v) => setCore(field.key, v)}
              disabled={readOnly}
            />
          ))}
        </div>
      </Card>

      {/* ── Task picker ──────────────────────────────────────────────── */}
      <Card className="border-slate-200 p-5">
        <SectionHeading
          title="What did you work on today?"
          subtitle="Pick everything that applies — only those questions will appear."
        />
        <div className="mt-4 space-y-5">
          {TASK_CATEGORIES.map((category) => {
            const tasks = TASKS.filter((t) => t.category === category.id);
            return (
              <div key={category.id}>
                <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
                  {category.label}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {tasks.map((task) => {
                    const active = form.tasks.includes(task.id);
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => toggleTask(task.id)}
                        disabled={readOnly}
                        aria-pressed={active}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                          active
                            ? "border-[#5C0FFE] bg-[#5C0FFE]/[0.07] font-semibold text-[#5C0FFE]"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
                        )}
                      >
                        {task.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* ── Task blocks ──────────────────────────────────────────────── */}
      {selectedTasks.map((task) => (
        <TaskBlock
          key={task.id}
          task={task}
          boot={boot}
          numbers={form.numbers}
          notes={form.notes}
          onNumber={setNumber}
          onNote={setNote}
          disabled={readOnly}
        />
      ))}

      {/* ── Flags raised on this day ─────────────────────────────────── */}
      {flags.length > 0 && (
        <FlagPanel
          flags={flags}
          api={api}
          onUpdated={(flag) => setFlags((list) => list.map((f) => (f.id === flag.id ? flag : f)))}
        />
      )}

      {/* ── Submit ───────────────────────────────────────────────────── */}
      {!readOnly && (
        <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <div className="min-w-0 flex-1 text-xs text-slate-500">
              {issues.length ? (
                <span className="flex items-center gap-1.5 text-amber-700">
                  <RiErrorWarningLine className="h-3.5 w-3.5 shrink-0" />
                  {issues[0].message}
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <RiShieldCheckLine className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  Your draft saves as you go. Submitting compares your numbers to what we recorded.
                </span>
              )}
            </div>
            <Button
              onClick={submit}
              disabled={submitting || issues.length > 0}
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

function SaveIndicator({ state, readOnly }: { state: SaveState; readOnly: boolean }) {
  if (readOnly) return null;
  const map: Record<SaveState, { label: string; cls: string }> = {
    idle: { label: "Auto-saving", cls: "text-slate-400" },
    saving: { label: "Saving…", cls: "text-slate-500" },
    saved: { label: "Draft saved", cls: "text-emerald-600" },
    error: { label: "Couldn't save — retrying on your next change", cls: "text-amber-700" },
  };
  const { label, cls } = map[state];
  return <span className={cn("text-xs", cls)}>{label}</span>;
}

function TaskBlock({
  task,
  boot,
  numbers,
  notes,
  onNumber,
  onNote,
  disabled,
}: {
  task: TaskDef;
  boot: BootstrapPayload;
  numbers: Record<string, string>;
  notes: Record<string, string | string[]>;
  onNumber: (key: string, value: string) => void;
  onNote: (key: string, value: string | string[]) => void;
  disabled: boolean;
}) {
  const tier1 = task.fields.filter(isTier1);
  const tier2 = task.fields.filter(isTier2);
  const qualitative = task.fields.filter((f) => f.tier === 3);

  return (
    <Card className="border-slate-200 p-5">
      <SectionHeading title={task.label} subtitle={task.hint} />

      {tier1.length > 0 && (
        <div className="mt-4 space-y-2">
          <AutoFilledNote />
          <div className="grid gap-3 sm:grid-cols-2">
            {tier1.map((f) => (
              <VerifiedField
                key={f.metric}
                metric={f.metric}
                label={f.label}
                values={boot.verified.values}
                provenance={boot.verified.provenance}
              />
            ))}
          </div>
        </div>
      )}

      {tier2.length > 0 && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {tier2.map((f) => (
            <CorroboratedInput
              key={f.key}
              field={f}
              value={numbers[f.key] ?? ""}
              onChange={(v) => onNumber(f.key, v)}
              boot={boot}
              disabled={disabled}
            />
          ))}
        </div>
      )}

      {qualitative.length > 0 && (
        <div className="mt-5 space-y-4">
          {qualitative.map((f) =>
            isChoice(f) ? (
              <ChoiceInput
                key={f.key}
                field={f}
                value={notes[f.key]}
                onChange={(v) => onNote(f.key, v)}
                disabled={disabled}
              />
            ) : (
              <QualitativeInput
                key={f.key}
                field={f as Tier3Field}
                value={String(notes[f.key] ?? "")}
                onChange={(v) => onNote(f.key, v)}
                disabled={disabled}
              />
            ),
          )}
        </div>
      )}
    </Card>
  );
}

function CorroboratedInput({
  field,
  value,
  onChange,
  boot,
  disabled,
}: {
  field: Tier2Field;
  value: string;
  onChange: (v: string) => void;
  boot: BootstrapPayload;
  disabled: boolean;
}) {
  // Show what this will be compared against, so the check is never a surprise.
  let signal: number | null = null;
  if (field.corroborate) {
    for (const metric of field.corroborate.metrics as MetricKey[]) {
      const v = boot.verified.values[metric];
      if (v === null || v === undefined) continue;
      signal = (signal ?? 0) + v;
    }
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`f-${field.key}`} className="text-sm text-slate-700">
        {field.label}
        {field.unit && <span className="ml-1 text-xs font-normal text-slate-400">({field.unit})</span>}
      </Label>
      <Input
        id={`f-${field.key}`}
        type="number"
        min={0}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-10 bg-white"
        placeholder="—"
      />
      {field.help && <p className="text-[11px] text-slate-500">{field.help}</p>}
      {field.corroborate ? (
        <p className="text-[11px] leading-snug text-slate-500">
          {signal === null ? (
            <>Checked against {field.corroborate.describe} — currently unverified, so nothing to compare.</>
          ) : (
            <>
              We recorded <span className="font-mono font-semibold text-slate-700">{signal}</span> from{" "}
              {field.corroborate.describe}.
            </>
          )}
        </p>
      ) : (
        <p className="text-[11px] leading-snug text-slate-500">
          Nothing corroborates this one, so it&apos;s recorded as you report it.
        </p>
      )}
    </div>
  );
}

function QualitativeInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: Tier3Field;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`q-${field.key}`} className="text-sm text-slate-700">
        {field.label}
      </Label>
      <Textarea
        id={`q-${field.key}`}
        rows={field.rows ?? 3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={field.placeholder}
        className="resize-y bg-white text-sm"
      />
    </div>
  );
}

function ChoiceInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: ChoiceField;
  value: string | string[] | undefined;
  onChange: (v: string[]) => void;
  disabled: boolean;
}) {
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const toggle = (choice: string) => {
    if (!field.multiple) {
      onChange(selected.includes(choice) ? [] : [choice]);
      return;
    }
    onChange(selected.includes(choice) ? selected.filter((c) => c !== choice) : [...selected, choice]);
  };
  return (
    <div className="space-y-1.5">
      <Label className="text-sm text-slate-700">{field.label}</Label>
      <div className="flex flex-wrap gap-2">
        {field.choices.map((choice) => (
          <button
            key={choice}
            type="button"
            onClick={() => toggle(choice)}
            disabled={disabled}
            aria-pressed={selected.includes(choice)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-60",
              selected.includes(choice)
                ? "border-[#5C0FFE] bg-[#5C0FFE]/[0.07] font-semibold text-[#5C0FFE]"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
            )}
          >
            {choice}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Discrepancy flags ────────────────────────────────────────────────────────
//
// Deliberately written as a question, not a verdict. There are plenty of
// legitimate reasons a number won't match, and the VA gets to say so before
// anyone concludes anything.

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
            This isn&apos;t an accusation — work happens outside the systems we can see all the time. Add
            a line of context and someone will read it. Nothing happens automatically.
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
          you reported {flag.selfReported} · we recorded {flag.verified}
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

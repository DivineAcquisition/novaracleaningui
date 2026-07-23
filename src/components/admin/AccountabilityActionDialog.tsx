"use client";

// ─── Accountability action dialog ────────────────────────────────────────
//
// One dialog for the whole escalation ladder — coaching note / strike /
// suspension / removal — launched from a cleaner's profile OR from a QC
// issue (pre-linked to that case). Enforces the documentation rules in the
// UI and lets the server (cleaner-accountability) be the final authority:
//   * every action needs a linked QC case or a documented reason + note
//   * direct-to-suspend/remove requires an explicit severe-cause confirm
//   * the formal email is auto-filled from the record and editable before
//     send; whatever is sent is archived on the action.

import { useCallback, useEffect, useState } from "react";
import { RiAlertLine, RiLoader4Line, RiMailSendLine } from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface LinkedQcIssue {
  id: string;
  issue_number: number;
  booking_ref: string | null;
  title: string;
  issue_type: string;
  severity: string;
  created_at: string;
  job_id?: string | null;
}

interface CrewMember {
  id: string;
  name: string;
  role: string | null;
}

const ACTION_OPTIONS = [
  {
    id: "coaching_note",
    label: "Coaching note",
    hint: "Documented conversation record — no formal strike. Email optional.",
  },
  {
    id: "strike",
    label: "Formal warning / strike",
    hint: "Numbered strike on the record. Applies the Novara Score hit and sends the formal Strike notice.",
  },
  {
    id: "suspension",
    label: "Suspension (new assignments)",
    hint: "Blocks NEW job offers for the window — existing jobs kept or reassigned, pay for completed work untouched.",
  },
  {
    id: "removal",
    label: "Removal / deactivation",
    hint: "Ends the engagement. Portal off, removed from dispatch, history retained, verified pay owed still pays out.",
  },
] as const;

type ActionType = (typeof ACTION_OPTIONS)[number]["id"];

const todayStr = () => new Date().toISOString().slice(0, 10);
const plusDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export default function AccountabilityActionDialog({
  open,
  onOpenChange,
  cleanerId,
  cleanerName,
  qcIssue,
  defaultActionType,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  cleanerId: string;
  cleanerName: string;
  /** Pre-linked QC case when launched from the QC hub. */
  qcIssue?: LinkedQcIssue | null;
  defaultActionType?: ActionType;
  onDone: () => void;
}) {
  const [actionType, setActionType] = useState<ActionType>(defaultActionType || "strike");
  const [issueChoices, setIssueChoices] = useState<LinkedQcIssue[]>([]);
  const [qcIssueId, setQcIssueId] = useState<string>(qcIssue?.id || "");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [severeCause, setSevereCause] = useState(false);
  const [needsSevereCause, setNeedsSevereCause] = useState(false);
  const [suspensionStart, setSuspensionStart] = useState(todayStr());
  const [suspensionEnd, setSuspensionEnd] = useState(plusDays(7));
  const [existingJobsHandling, setExistingJobsHandling] = useState<"keep" | "reassign">("keep");
  const [rehireStatus, setRehireStatus] = useState("no_rehire");
  const [sendEmail, setSendEmail] = useState(true);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailEdited, setEmailEdited] = useState(false);
  const [emailContext, setEmailContext] = useState<{ activeStrikes: number; strikeNumber: number; cleanerEmail: string | null } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  // Other cleaners on the same job: selecting them attaches them to the QC
  // case, and (optionally) issues them the same action with their own
  // auto-filled notice.
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [alsoIds, setAlsoIds] = useState<Set<string>>(new Set());
  const [alsoApply, setAlsoApply] = useState(true);

  // Reset when (re)opened, honoring the pre-linked case.
  useEffect(() => {
    if (!open) return;
    setActionType(defaultActionType || "strike");
    setQcIssueId(qcIssue?.id || "");
    setReason("");
    setNote("");
    setSevereCause(false);
    setNeedsSevereCause(false);
    setSuspensionStart(todayStr());
    setSuspensionEnd(plusDays(7));
    setExistingJobsHandling("keep");
    setRehireStatus("no_rehire");
    setSendEmail((defaultActionType || "strike") !== "coaching_note");
    setEmailSubject("");
    setEmailBody("");
    setEmailEdited(false);
    setEmailContext(null);
    setAlsoIds(new Set());
    setAlsoApply(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Recent QC cases for this cleaner — the linkage picker.
  useEffect(() => {
    if (!open || qcIssue) return;
    void (async () => {
      const { data } = await (supabase.from as any)("qc_issues")
        .select("id, issue_number, booking_ref, title, issue_type, severity, created_at, job_id")
        .eq("cleaner_id", cleanerId)
        .order("created_at", { ascending: false })
        .limit(25);
      setIssueChoices((data || []) as LinkedQcIssue[]);
    })();
  }, [open, qcIssue, cleanerId]);

  // The linked case's job — its crew is the pool of "other cleaners".
  const linkedJobId = qcIssue?.job_id ?? issueChoices.find((i) => i.id === qcIssueId)?.job_id ?? null;

  useEffect(() => {
    if (!open || !linkedJobId) { setCrew([]); return; }
    void (async () => {
      const { data } = await (supabase.from as any)("job_assignments")
        .select("cleaner_id, role, status, cleaners(first_name, last_name)")
        .eq("job_id", linkedJobId);
      const seen = new Set<string>();
      const out: CrewMember[] = [];
      for (const a of data || []) {
        if (!a.cleaner_id || seen.has(a.cleaner_id) || a.cleaner_id === cleanerId) continue;
        if (!["confirmed", "accepted", "completed", "in progress"].includes(String(a.status || "").toLowerCase())) continue;
        seen.add(a.cleaner_id);
        const c = Array.isArray(a.cleaners) ? a.cleaners[0] : a.cleaners;
        out.push({
          id: a.cleaner_id,
          name: c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner" : "Cleaner",
          role: a.role || null,
        });
      }
      setCrew(out);
      setAlsoIds(new Set());
    })();
  }, [open, linkedJobId, cleanerId]);

  const toggleAlso = (id: string) => {
    setAlsoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Coaching notes default to "log only"; formal actions default to sending.
  useEffect(() => {
    setSendEmail(actionType !== "coaching_note");
    setSevereCause(false);
    setNeedsSevereCause(false);
  }, [actionType]);

  const loadPreview = useCallback(async (force = false) => {
    if (!open) return;
    if (emailEdited && !force) return; // never clobber admin edits
    setPreviewing(true);
    try {
      const { data, error } = await supabase.functions.invoke("cleaner-accountability", {
        body: {
          action: "preview_email",
          cleanerId,
          actionType,
          qcIssueId: qcIssueId || undefined,
          reason: reason.trim() || undefined,
          suspensionStart,
          suspensionEnd,
          existingJobsHandling,
        },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; error?: string; subject?: string; body?: string; context?: { activeStrikes: number; strikeNumber: number; cleanerEmail: string | null } };
      if (d?.ok === false) throw new Error(d.error || "Preview failed");
      setEmailSubject(d.subject || "");
      setEmailBody(d.body || "");
      setEmailContext(d.context || null);
      setEmailEdited(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't build the email preview");
    } finally {
      setPreviewing(false);
    }
  }, [open, emailEdited, cleanerId, actionType, qcIssueId, reason, suspensionStart, suspensionEnd, existingJobsHandling]);

  // Auto-fill the template whenever the inputs settle (debounced), unless
  // the admin already edited the text.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void loadPreview(), 500);
    return () => clearTimeout(t);
  }, [open, actionType, qcIssueId, reason, suspensionStart, suspensionEnd, existingJobsHandling, loadPreview]);

  const activeStrikes = emailContext?.activeStrikes ?? 0;
  const ladderShort =
    (actionType === "suspension" && activeStrikes < 2) ||
    (actionType === "removal" && activeStrikes < 3);

  const submit = async () => {
    if (!note.trim()) {
      toast.error("An admin note is required — every action is documented.");
      return;
    }
    if (!qcIssueId && !reason.trim()) {
      toast.error("Link a QC case or write a documented reason — no undocumented actions.");
      return;
    }
    if (actionType === "suspension" && (!suspensionEnd || suspensionEnd < suspensionStart)) {
      toast.error("Set a valid suspension window (end on or after start).");
      return;
    }
    if (ladderShort && !severeCause) {
      setNeedsSevereCause(true);
      toast.error("This skips the normal ladder — confirm severe cause with a documented reason.");
      return;
    }
    if (
      actionType === "removal" &&
      !confirm(`Remove ${cleanerName}? Portal access is deactivated and they leave dispatch permanently. History is retained and verified pay owed still pays out on the normal cycle.`)
    ) {
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("cleaner-accountability", {
        body: {
          action: "create",
          cleanerId,
          actionType,
          qcIssueId: qcIssueId || undefined,
          reason: reason.trim() || undefined,
          note: note.trim(),
          severeCause,
          suspensionStart,
          suspensionEnd,
          existingJobsHandling,
          rehireStatus: actionType === "removal" ? rehireStatus : undefined,
          sendEmail,
          emailSubject: emailSubject.trim() || undefined,
          emailBody: emailBody.trim() || undefined,
        },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; error?: string; code?: string; emailSent?: boolean; emailError?: string | null; activeStrikes?: number; reassignedJobs?: number };
      if (d?.ok === false) {
        if (d.code === "LADDER") {
          setNeedsSevereCause(true);
          throw new Error(d.error || "Severe cause confirmation required.");
        }
        throw new Error(d.error || "Action failed");
      }
      const label = ACTION_OPTIONS.find((a) => a.id === actionType)?.label || actionType;
      toast.success(
        `${label} logged for ${cleanerName}${
          sendEmail
            ? d.emailSent
              ? " — formal email sent"
              : ` — email NOT sent (${d.emailError || "no valid email"})`
            : ""
        }${d.reassignedJobs ? ` · ${d.reassignedJobs} job(s) marked for reassignment` : ""}`,
      );

      // Other selected cleaners: attach them to the QC case, and (if chosen)
      // issue them the same action with their own auto-filled notice.
      const extras = crew.filter((c) => alsoIds.has(c.id));
      const extraErrors: string[] = [];
      for (const extra of extras) {
        if (qcIssueId) {
          const { data: ad, error: ae } = await supabase.functions.invoke("qc-issues", {
            body: { action: "attach_cleaner", issueId: qcIssueId, cleanerId: extra.id },
          });
          const add = ad as { ok?: boolean; error?: string } | null;
          if (ae || add?.ok === false) {
            extraErrors.push(`${extra.name}: couldn't attach to the case (${add?.error || ae?.message || "error"})`);
          }
        }
        if (alsoApply) {
          const { data: cd, error: ce } = await supabase.functions.invoke("cleaner-accountability", {
            body: {
              action: "create",
              cleanerId: extra.id,
              actionType,
              qcIssueId: qcIssueId || undefined,
              reason: reason.trim() || undefined,
              note: note.trim(),
              severeCause,
              suspensionStart,
              suspensionEnd,
              existingJobsHandling,
              rehireStatus: actionType === "removal" ? rehireStatus : undefined,
              sendEmail,
              // No subject/body override — each cleaner's notice is
              // auto-filled with their own name and strike number.
            },
          });
          const cdd = cd as { ok?: boolean; error?: string; emailSent?: boolean } | null;
          if (ce || cdd?.ok === false) {
            extraErrors.push(`${extra.name}: ${cdd?.error || ce?.message || "action failed"}`);
          } else {
            toast.success(`${label} logged for ${extra.name}${sendEmail && cdd?.emailSent ? " — formal email sent" : ""}`);
          }
        }
      }
      for (const msg of extraErrors) toast.error(msg, { duration: 9000 });

      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setSaving(false);
    }
  };

  const selectedOption = ACTION_OPTIONS.find((a) => a.id === actionType);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Accountability action — {cleanerName}</DialogTitle>
          <DialogDescription>
            Formal, documented, proportionate. Every action links to a QC case
            or documented reason, is logged (who/when/why), and never touches
            pay for completed work.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Action type */}
          <div>
            <Label>Action</Label>
            <Select value={actionType} onValueChange={(v) => setActionType(v as ActionType)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACTION_OPTIONS.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedOption && (
              <p className="text-[11px] text-slate-500 mt-1">{selectedOption.hint}</p>
            )}
            {emailContext && actionType === "strike" && (
              <p className="text-[11px] font-semibold text-amber-700 mt-1">
                This will be Strike {emailContext.strikeNumber} ({activeStrikes} currently active).
              </p>
            )}
          </div>

          {/* QC case linkage */}
          <div>
            <Label>Linked QC case</Label>
            {qcIssue ? (
              <div className="mt-1 rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2 text-sm">
                <span className="font-mono text-xs text-slate-400">#{qcIssue.issue_number}</span>{" "}
                <span className="font-medium text-slate-800">{qcIssue.title}</span>
                <span className="text-xs text-slate-500"> · {qcIssue.booking_ref || ""} · {qcIssue.severity}</span>
              </div>
            ) : (
              <Select value={qcIssueId || "none"} onValueChange={(v) => setQcIssueId(v === "none" ? "" : v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No case — documented reason below</SelectItem>
                  {issueChoices.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      #{i.issue_number} · {i.issue_type.replace(/_/g, " ")} · {i.title.slice(0, 60)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Other cleaners on the same job */}
          {crew.length > 0 && (
            <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 space-y-2">
              <Label className="text-violet-900">Other cleaners on this job</Label>
              <div className="space-y-1.5">
                {crew.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300"
                      checked={alsoIds.has(c.id)}
                      onChange={() => toggleAlso(c.id)}
                    />
                    <span>{c.name}{c.role ? <span className="text-slate-400"> · {c.role}</span> : null}</span>
                  </label>
                ))}
              </div>
              {alsoIds.size > 0 && (
                <>
                  <label className="flex items-center gap-2 text-xs text-violet-900 cursor-pointer pt-1 border-t border-violet-200/70">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300"
                      checked={alsoApply}
                      onChange={(e) => setAlsoApply(e.target.checked)}
                    />
                    Also issue the same {ACTION_OPTIONS.find((a) => a.id === actionType)?.label.toLowerCase() || "action"} to them
                  </label>
                  <p className="text-[11px] text-violet-800/70">
                    Selected cleaners are attached to the QC case{alsoApply
                      ? " and each gets their own logged action + notice, auto-filled with their name and strike count."
                      : " (linked to it on their record) — no action is taken on them."}
                  </p>
                </>
              )}
            </div>
          )}

          {/* Reason + note */}
          <div>
            <Label>
              Incident summary / reason{qcIssueId ? " (optional — auto-filled from the case)" : " *"}
            </Label>
            <Textarea
              className="mt-1"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={qcIssueId
                ? "Leave blank to use the QC case summary, or write your own…"
                : 'e.g. "a late arrival of approximately 2 hours caused by oversleeping, which resulted in a customer cancellation"'}
            />
          </div>
          <div>
            <Label>Admin note (internal, required) *</Label>
            <Textarea
              className="mt-1"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Context, conversation summary, decision rationale…"
            />
          </div>

          {/* Suspension window */}
          {actionType === "suspension" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Start date</Label>
                  <Input type="date" className="mt-1 bg-white" value={suspensionStart}
                    onChange={(e) => setSuspensionStart(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">End date (last suspended day)</Label>
                  <Input type="date" className="mt-1 bg-white" value={suspensionEnd}
                    onChange={(e) => setSuspensionEnd(e.target.value)} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Existing accepted jobs</Label>
                <Select value={existingJobsHandling} onValueChange={(v) => setExistingJobsHandling(v as "keep" | "reassign")}>
                  <SelectTrigger className="mt-1 bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep">Keep — they complete jobs already accepted</SelectItem>
                    <SelectItem value="reassign">Reassign — release future jobs for redispatch</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-[11px] text-amber-800">
                Dispatch excludes them automatically for the window and eligibility
                auto-restores at the end date. Pay for completed work is never touched.
              </p>
            </div>
          )}

          {/* Removal extras */}
          {actionType === "removal" && (
            <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-3 space-y-2">
              <div>
                <Label className="text-xs">Rehire status</Label>
                <Select value={rehireStatus} onValueChange={setRehireStatus}>
                  <SelectTrigger className="mt-1 bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no_rehire">Not eligible for rehire</SelectItem>
                    <SelectItem value="rehireable">Eligible for rehire</SelectItem>
                    <SelectItem value="under_review">Under review</SelectItem>
                    <SelectItem value="blacklist">Blacklist — do not hire</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-[11px] text-rose-800">
                History is retained forever (never deleted). Final verified pay owed
                still pays out on the normal cycle — removal is never a pay penalty.
              </p>
            </div>
          )}

          {/* Severe-cause gate for skipping the ladder */}
          {(actionType === "suspension" || actionType === "removal") && ladderShort && (
            <label
              className={cn(
                "flex items-start gap-2 rounded-lg border p-3 text-sm cursor-pointer",
                needsSevereCause && !severeCause
                  ? "border-rose-400 bg-rose-50"
                  : "border-slate-200 bg-slate-50",
              )}
            >
              <input
                type="checkbox"
                className="mt-0.5 rounded border-slate-300"
                checked={severeCause}
                onChange={(e) => setSevereCause(e.target.checked)}
              />
              <span className="text-slate-700">
                <span className="font-semibold flex items-center gap-1">
                  <RiAlertLine className="w-4 h-4 text-rose-600" /> Severe cause — skipping the normal ladder
                </span>
                <span className="text-xs text-slate-500 block mt-0.5">
                  {actionType === "suspension" ? "Suspension" : "Removal"} normally follows{" "}
                  {actionType === "suspension" ? "2" : "3"} strikes; this cleaner has {activeStrikes}.
                  Confirm the documented reason above justifies going direct. Recorded on the action.
                </span>
              </span>
            </label>
          )}

          {/* Formal email — review/edit before send, archived as sent */}
          <div className="rounded-lg border border-slate-200 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                <RiMailSendLine className="w-4 h-4 text-violet-600" /> Formal email
                {emailContext?.cleanerEmail
                  ? <span className="text-xs font-normal text-slate-500">→ {emailContext.cleanerEmail}</span>
                  : <Badge className="bg-rose-100 text-rose-700 border-0 text-[10px]">no valid email on file</Badge>}
              </p>
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-slate-300"
                  checked={sendEmail}
                  onChange={(e) => setSendEmail(e.target.checked)}
                />
                Send on save
              </label>
            </div>
            {sendEmail && (
              <>
                <Input
                  value={emailSubject}
                  onChange={(e) => { setEmailSubject(e.target.value); setEmailEdited(true); }}
                  placeholder={previewing ? "Building template…" : "Subject"}
                />
                <Textarea
                  rows={8}
                  className="font-mono text-xs"
                  value={emailBody}
                  onChange={(e) => { setEmailBody(e.target.value); setEmailEdited(true); }}
                  placeholder={previewing ? "Building template…" : "Email body"}
                />
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-slate-400">
                    Auto-filled from the record — edit freely. Exactly what you send is archived on the action.
                  </p>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={previewing}
                    onClick={() => { setEmailEdited(false); void loadPreview(true); }}>
                    {previewing ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin" /> : "Reset to template"}
                  </Button>
                </div>
              </>
            )}
            {!sendEmail && actionType !== "coaching_note" && (
              <p className="text-[11px] text-amber-700">
                Skipping the formal notice is logged on the action. Coaching notes are the only action where this is typical.
              </p>
            )}
          </div>

          <Button
            className={cn(
              "w-full",
              actionType === "removal"
                ? "bg-rose-600 hover:bg-rose-700"
                : actionType === "suspension"
                  ? "bg-amber-600 hover:bg-amber-700"
                  : "bg-violet-600 hover:bg-violet-700",
              "text-white",
            )}
            disabled={saving}
            onClick={() => void submit()}
          >
            {saving ? <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> : null}
            {selectedOption?.label || "Take action"}
            {sendEmail ? " + send notice" : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

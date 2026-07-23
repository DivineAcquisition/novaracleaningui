"use client";

// ─── Cleaner profile → Accountability section ───────────────────────────
//
// The cleaner's full accountability record: current standing (Active /
// Suspended until X / Removed), active strike count front-and-center, the
// permanent action history (each with its QC case link, admin, note, and
// the archived formal email), plus the reliability trend from the Novara
// Score. Actions are taken through AccountabilityActionDialog and the
// cleaner-accountability edge function — never written directly.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  RiAlertLine,
  RiArrowGoBackLine,
  RiExternalLinkLine,
  RiLoader4Line,
  RiMailLine,
  RiScales3Line,
  RiSettings3Line,
} from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAdminRole } from "@/hooks/use-admin-role";
import AccountabilityActionDialog from "@/components/admin/AccountabilityActionDialog";

export interface AccountabilityAction {
  id: string;
  action_number: number;
  action_type: "coaching_note" | "strike" | "suspension" | "removal";
  strike_number: number | null;
  qc_issue_id: string | null;
  qc_issue_ref: string | null;
  reason: string;
  note: string;
  severe_cause: boolean;
  suspension_start: string | null;
  suspension_end: string | null;
  existing_jobs_handling: string | null;
  status: "active" | "expired" | "completed" | "lifted";
  expires_at: string | null;
  lifted_by_name: string | null;
  lift_note: string | null;
  email_to: string | null;
  email_subject: string | null;
  email_body: string | null;
  email_sent: boolean;
  email_sent_at: string | null;
  email_error: string | null;
  email_skipped: boolean;
  created_by_name: string | null;
  created_at: string;
}

interface AccountabilityCleaner {
  id: string;
  first_name: string | null;
  last_name: string | null;
  status: string | null;
  active_strike_count: number | null;
  suspended_until: string | null;
  suspension_reason: string | null;
  novara_score: number | null;
  quality_score: number | null;
  overall_score: number | null;
  terminated_at: string | null;
  termination_reason: string | null;
}

const ACTION_META: Record<string, { label: string; cls: string }> = {
  coaching_note: { label: "Coaching note", cls: "bg-sky-100 text-sky-700" },
  strike: { label: "Strike", cls: "bg-amber-100 text-amber-800" },
  suspension: { label: "Suspension", cls: "bg-orange-100 text-orange-800" },
  removal: { label: "Removal", cls: "bg-rose-100 text-rose-800" },
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  expired: { label: "Expired", cls: "bg-slate-100 text-slate-500 border-slate-200" },
  completed: { label: "Completed", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  lifted: { label: "Lifted early", cls: "bg-sky-50 text-sky-700 border-sky-200" },
};

const fmtDT = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
const fmtD = (iso?: string | null) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

export default function CleanerAccountability({
  cleanerId,
  cleanerName,
  onChanged,
}: {
  cleanerId: string;
  cleanerName: string;
  onChanged?: () => void;
}) {
  const { isAdmin } = useAdminRole();
  const [loading, setLoading] = useState(true);
  const [cleaner, setCleaner] = useState<AccountabilityCleaner | null>(null);
  const [actions, setActions] = useState<AccountabilityAction[]>([]);
  const [settings, setSettings] = useState<{ strike_expiry_months: number } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [emailView, setEmailView] = useState<AccountabilityAction | null>(null);
  const [liftTarget, setLiftTarget] = useState<AccountabilityAction | null>(null);
  const [liftNote, setLiftNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expiryDraft, setExpiryDraft] = useState("6");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("cleaner-accountability", {
        body: { action: "list", cleanerId },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; error?: string; cleaner?: AccountabilityCleaner; actions?: AccountabilityAction[]; settings?: { strike_expiry_months: number } };
      if (d?.ok === false) throw new Error(d.error || "Failed to load");
      setCleaner(d.cleaner || null);
      setActions(d.actions || []);
      setSettings(d.settings || null);
      if (d.settings) setExpiryDraft(String(d.settings.strike_expiry_months));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load accountability record");
    } finally {
      setLoading(false);
    }
  }, [cleanerId]);

  useEffect(() => { void load(); }, [load]);

  const liftSuspension = async () => {
    if (!liftTarget) return;
    if (!liftNote.trim()) { toast.error("A note is required — lifting early is logged."); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("cleaner-accountability", {
        body: { action: "lift_suspension", actionId: liftTarget.id, note: liftNote.trim() },
      });
      if (error) throw error;
      if ((data as { ok?: boolean; error?: string })?.ok === false) throw new Error((data as { error?: string }).error || "Failed");
      toast.success("Suspension lifted — eligibility restored.");
      setLiftTarget(null);
      setLiftNote("");
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to lift suspension");
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    const months = Number(expiryDraft);
    if (!Number.isFinite(months) || months < 0 || months > 60) {
      toast.error("Strike expiry must be 0–60 months (0 = never expire).");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("cleaner-accountability", {
        body: { action: "set_settings", strikeExpiryMonths: months },
      });
      if (error) throw error;
      if ((data as { ok?: boolean; error?: string })?.ok === false) throw new Error((data as { error?: string }).error || "Failed");
      toast.success("Accountability settings saved.");
      setSettingsOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="py-6 flex justify-center"><RiLoader4Line className="w-5 h-5 animate-spin text-slate-400" /></div>;
  }

  const status = String(cleaner?.status || "").toLowerCase();
  const strikes = cleaner?.active_strike_count ?? 0;
  const removed = status === "terminated";
  const suspended = status === "suspended";
  const activeSuspension = actions.find((a) => a.action_type === "suspension" && a.status === "active") || null;

  const standing = removed
    ? { label: `Removed${cleaner?.terminated_at ? ` · ${fmtD(cleaner.terminated_at)}` : ""}`, cls: "bg-rose-100 text-rose-800 border-rose-200" }
    : suspended
      ? { label: `Suspended until ${fmtDT(cleaner?.suspended_until)}`, cls: "bg-orange-100 text-orange-800 border-orange-200" }
      : { label: "Active", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };

  return (
    <div className="space-y-4">
      {/* ── Standing: strikes + status + reliability trend ────────────── */}
      <div className="grid grid-cols-3 gap-2">
        <div className={cn(
          "rounded-xl px-3 py-2.5",
          strikes >= 3 ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
            : strikes >= 1 ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200"
              : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
        )}>
          <p className="text-[10px] uppercase tracking-wide font-semibold opacity-80">Active strikes</p>
          <p className="text-xl font-bold tabular-nums leading-tight">{strikes}</p>
        </div>
        <div className="rounded-xl px-3 py-2.5 bg-slate-50 ring-1 ring-slate-200 col-span-2">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">Current status</p>
          <Badge variant="outline" className={cn("mt-1 font-medium border", standing.cls)}>{standing.label}</Badge>
        </div>
      </div>
      <p className="text-[11px] text-slate-500 -mt-2">
        Reliability trend: Novara {cleaner?.novara_score != null ? Math.round(Number(cleaner.novara_score)) : "—"} ·
        Rating {cleaner?.quality_score != null ? Math.round(Number(cleaner.quality_score)) : "—"} ·
        Overall {cleaner?.overall_score != null ? Math.round(Number(cleaner.overall_score)) : "—"}.
        Strikes auto-apply the score hit — the Novara Score stays the continuous priority lever.
        {settings ? ` Strikes ${settings.strike_expiry_months > 0 ? `expire after ${settings.strike_expiry_months} months of clean performance` : "never expire"}.` : ""}
      </p>

      {/* ── Actions row ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="bg-violet-600 hover:bg-violet-700 text-white"
          disabled={removed}
          onClick={() => setDialogOpen(true)}
        >
          <RiScales3Line className="w-4 h-4 mr-1.5" /> Take action
        </Button>
        {suspended && activeSuspension && (
          <Button
            size="sm"
            variant="outline"
            className="border-sky-200 text-sky-800 bg-sky-50 hover:bg-sky-100"
            onClick={() => setLiftTarget(activeSuspension)}
          >
            <RiArrowGoBackLine className="w-4 h-4 mr-1.5" /> Lift suspension early
          </Button>
        )}
        {isAdmin && (
          <Button size="sm" variant="ghost" className="text-slate-500" onClick={() => setSettingsOpen(true)}>
            <RiSettings3Line className="w-4 h-4 mr-1.5" /> Strike expiry
          </Button>
        )}
      </div>
      {removed && (
        <p className="text-[11px] text-rose-700">
          This cleaner has been removed. The record below is retained permanently{cleaner?.termination_reason ? ` (${cleaner.termination_reason.replaceAll("_", " ")})` : ""}.
        </p>
      )}

      {/* ── Permanent history ──────────────────────────────────────────── */}
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
          Action history ({actions.length})
        </p>
        {actions.length === 0 ? (
          <p className="text-xs text-slate-400">Clean record — no accountability actions on file.</p>
        ) : (
          actions.map((a) => {
            const meta = ACTION_META[a.action_type] || ACTION_META.coaching_note;
            const st = STATUS_META[a.status] || STATUS_META.active;
            return (
              <div key={a.id} className="rounded-lg border border-slate-200 bg-white p-3 space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge className={cn("border-0", meta.cls)}>
                    {a.action_type === "strike" && a.strike_number ? `Strike ${a.strike_number}` : meta.label}
                  </Badge>
                  {(a.action_type === "strike" || a.action_type === "suspension") && (
                    <Badge variant="outline" className={cn("border text-[10px]", st.cls)}>{st.label}</Badge>
                  )}
                  {a.severe_cause && (
                    <Badge className="bg-rose-100 text-rose-700 border-0 text-[10px]">
                      <RiAlertLine className="w-3 h-3 mr-0.5" /> severe cause
                    </Badge>
                  )}
                  {a.qc_issue_id && (
                    <Link
                      href={`/admin/qc?issue=${a.qc_issue_id}`}
                      className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-violet-700 hover:underline"
                    >
                      <RiExternalLinkLine className="w-3 h-3" /> QC {a.qc_issue_ref || "case"}
                    </Link>
                  )}
                  <span className="text-[11px] text-slate-400 ml-auto">{fmtDT(a.created_at)}</span>
                </div>
                <p className="text-sm text-slate-800">{a.reason}</p>
                <p className="text-xs text-slate-500 whitespace-pre-wrap">Note: {a.note}</p>
                {a.action_type === "suspension" && (
                  <p className="text-[11px] text-slate-500">
                    Window: {fmtD(a.suspension_start)} → {fmtD(a.suspension_end)} · existing jobs: {a.existing_jobs_handling || "keep"}
                    {a.status === "lifted" && a.lifted_by_name ? ` · lifted by ${a.lifted_by_name}${a.lift_note ? ` — "${a.lift_note}"` : ""}` : ""}
                  </p>
                )}
                {a.action_type === "strike" && a.expires_at && a.status === "active" && (
                  <p className="text-[11px] text-slate-400">Ages out {fmtD(a.expires_at)} with clean performance (stays in history).</p>
                )}
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span>By {a.created_by_name || "Admin"}</span>
                  <span>·</span>
                  {a.email_sent ? (
                    <button
                      className="inline-flex items-center gap-1 text-violet-700 font-semibold hover:underline"
                      onClick={() => setEmailView(a)}
                    >
                      <RiMailLine className="w-3 h-3" /> Email sent {fmtDT(a.email_sent_at)} — view
                    </button>
                  ) : a.email_skipped ? (
                    <span>No email sent (logged)</span>
                  ) : a.email_error ? (
                    <span className="text-rose-600 inline-flex items-center gap-1">
                      <RiMailLine className="w-3 h-3" /> Email failed: {a.email_error}
                    </span>
                  ) : (
                    <button
                      className="inline-flex items-center gap-1 text-slate-500 hover:underline"
                      onClick={() => setEmailView(a)}
                    >
                      <RiMailLine className="w-3 h-3" /> View drafted email
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
        <p className="text-[11px] text-slate-400">
          History is permanent — expired strikes and removed cleaners are retained, never deleted.
          No accountability action can dock pay for completed work.
        </p>
      </div>

      {/* ── Take-action dialog ─────────────────────────────────────────── */}
      <AccountabilityActionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        cleanerId={cleanerId}
        cleanerName={cleanerName}
        onDone={() => { void load(); onChanged?.(); }}
      />

      {/* ── Archived email viewer ──────────────────────────────────────── */}
      <Dialog open={!!emailView} onOpenChange={(o) => !o && setEmailView(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Archived formal email</DialogTitle>
            <DialogDescription>
              {emailView?.email_sent
                ? `Sent ${fmtDT(emailView?.email_sent_at)} to ${emailView?.email_to || "—"} — archived verbatim.`
                : "Drafted on the action (not sent)."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-800">{emailView?.email_subject || "—"}</p>
            <pre className="text-xs text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-lg p-3 max-h-80 overflow-y-auto font-sans">
              {emailView?.email_body || "—"}
            </pre>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Lift suspension dialog ─────────────────────────────────────── */}
      <Dialog open={!!liftTarget} onOpenChange={(o) => { if (!o) { setLiftTarget(null); setLiftNote(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Lift suspension early</DialogTitle>
            <DialogDescription>
              Restores assignment eligibility immediately. Logged with your name and note.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Reason (required)</Label>
              <Textarea rows={2} className="mt-1" value={liftNote} onChange={(e) => setLiftNote(e.target.value)}
                placeholder="e.g. Discussed by phone — circumstances verified, resuming early" />
            </div>
            <Button className="w-full" disabled={busy} onClick={() => void liftSuspension()}>
              {busy ? <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> : null}
              Lift suspension
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Strike-expiry settings (admin) ─────────────────────────────── */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Strike expiry</DialogTitle>
            <DialogDescription>
              Strikes age out of the active ladder after this many months of clean
              performance (0 = never). Expired strikes remain in history, so one bad
              week doesn&apos;t shadow a cleaner forever.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Months until a strike expires</Label>
              <Input type="number" min={0} max={60} className="mt-1" value={expiryDraft}
                onChange={(e) => setExpiryDraft(e.target.value)} />
            </div>
            <Button className="w-full" disabled={busy} onClick={() => void saveSettings()}>
              {busy ? <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

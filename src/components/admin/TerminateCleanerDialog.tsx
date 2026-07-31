"use client";

// ─── Termination workflow dialog ────────────────────────────────────────────
//
// Off-boards a contractor: pick one of the 7 core reasons, set an internal
// rehire label (rehireable / no-hire / under review / blacklist), optionally
// add notes, and send a termination letter to the contractor (HR + contact
// are CC'd; reply-to is hr@novaracleaning.com). If "Blacklist" is chosen,
// the letter says so.

import { useState } from "react";
import { RiLoader4Line, RiCloseCircleLine, RiMailSendLine } from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// The 7 core reasons a contractor leaves this role (+ Other).
export const TERMINATION_REASONS: { value: string; label: string }[] = [
  { value: "voluntary_resignation", label: "Voluntary resignation" },
  { value: "job_abandonment", label: "Job abandonment / no contact" },
  { value: "attendance", label: "Persistent no-shows or lateness" },
  { value: "performance", label: "Cleaning quality / performance" },
  { value: "misconduct", label: "Misconduct / unprofessional conduct" },
  { value: "policy_violation", label: "Policy or contract violation" },
  { value: "customer_complaints", label: "Repeated customer complaints" },
  { value: "other", label: "Other (add a note)" },
];

export const REHIRE_STATUSES: { value: string; label: string; tone: string }[] = [
  { value: "rehireable", label: "Rehireable — eligible for future work", tone: "text-emerald-700" },
  { value: "no_rehire", label: "No-hire — not eligible for rehire", tone: "text-amber-700" },
  { value: "under_review", label: "Under review — eligibility TBD", tone: "text-sky-700" },
  { value: "blacklist", label: "Blacklist — do not hire (noted in letter)", tone: "text-rose-700" },
];

export default function TerminateCleanerDialog({
  open,
  onOpenChange,
  cleanerId,
  cleanerName,
  cleanerEmail,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cleanerId: string;
  cleanerName: string;
  cleanerEmail: string | null;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [rehireStatus, setRehireStatus] = useState("no_rehire");
  const [notes, setNotes] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [sendLetter, setSendLetter] = useState(true);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setReason(""); setRehireStatus("no_rehire"); setNotes("");
    setEffectiveDate(new Date().toISOString().slice(0, 10)); setSendLetter(true);
  };

  const validEmail = !!cleanerEmail && !cleanerEmail.endsWith("@pending.novara");
  const blacklisted = rehireStatus === "blacklist";

  const submit = async () => {
    if (!reason) { toast.error("Pick a termination reason."); return; }
    if (reason === "other" && !notes.trim()) { toast.error("Add a note for 'Other'."); return; }
    const confirmMsg =
      `Terminate ${cleanerName}?\n\n` +
      `• Loses portal, job offers & payout access\n` +
      `• Open future jobs are released for reassignment\n` +
      (blacklisted ? `• Added to the do-not-hire / blacklist (stated in the letter)\n` : "") +
      (sendLetter && validEmail
        ? `• Termination letter emailed to ${cleanerEmail}, CC hr@novaracleaning.com + contact@novaracleaning.com`
        : "• No letter will be sent");
    if (!confirm(confirmMsg)) return;

    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("terminate-cleaner", {
        body: { cleanerId, reason, rehireStatus, notes: notes.trim() || undefined, effectiveDate, sendLetter },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error);
      const d = data as { letterSent?: boolean; letterError?: string; reassignedJobs?: number };
      toast.success(
        `${cleanerName} terminated.` +
        (d.letterSent ? " Letter sent (HR + contact cc'd)." : d.letterError ? ` Letter not sent: ${d.letterError}` : "") +
        (d.reassignedJobs ? ` ${d.reassignedJobs} job(s) released.` : ""),
      );
      reset();
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Termination failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { onOpenChange(v); if (!v) reset(); } }}>
      <DialogContent className="sm:max-w-lg bg-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-700">
            <RiCloseCircleLine className="w-5 h-5" /> Terminate {cleanerName}
          </DialogTitle>
          <DialogDescription>
            This off-boards the contractor and records an internal rehire label. A termination letter is emailed to them with HR and contact@ cc&apos;d.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div>
            <Label className="text-xs">Reason for leaving the role</Label>
            <Select value={reason} onValueChange={setReason} disabled={busy}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Pick a reason" /></SelectTrigger>
              <SelectContent>
                {TERMINATION_REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Internal rehire label</Label>
            <Select value={rehireStatus} onValueChange={setRehireStatus} disabled={busy}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {REHIRE_STATUSES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {blacklisted && (
              <p className="text-[11px] text-rose-600 mt-1">
                The termination letter will include a do-not-hire notice.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Effective date</Label>
              <Input type="date" className="mt-1" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} disabled={busy} />
            </div>
            <label className="flex items-end gap-2 text-sm pb-2">
              <input type="checkbox" checked={sendLetter} onChange={(e) => setSendLetter(e.target.checked)} disabled={busy} className="rounded border-slate-300" />
              <span className="text-slate-700">Email termination letter</span>
            </label>
          </div>

          <div>
            <Label className="text-xs">Notes {reason === "other" ? "(required)" : "(optional)"}</Label>
            <Textarea rows={3} className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Context for the record / letter" disabled={busy} />
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 text-[11px] text-slate-600 flex items-center gap-2">
            <RiMailSendLine className="w-3.5 h-3.5 flex-shrink-0" />
            {sendLetter
              ? validEmail
                ? <span>Letter → <strong>{cleanerEmail}</strong>, CC <strong>hr@novaracleaning.com</strong></span>
                : <span className="text-amber-700">No valid email on file — letter can&apos;t be sent.</span>
              : <span>Letter sending is off.</span>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !reason} className="bg-rose-600 hover:bg-rose-700 text-white">
            {busy ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiCloseCircleLine className="w-4 h-4 mr-1.5" />}
            Terminate contractor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

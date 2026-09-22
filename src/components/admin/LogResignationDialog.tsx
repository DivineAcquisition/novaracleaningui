"use client";

// Contractor-initiated resignation. No disciplinary reason.
// Email and SMS never use terminated / termination.

import { useEffect, useState } from "react";
import { RiLoader4Line, RiLogoutBoxRLine } from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { describeEdgeError } from "@/lib/edge-invoke";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { REHIRE_STATUSES } from "@/components/admin/TerminateCleanerDialog";

type Preview = {
  alreadyEnded?: boolean;
  status?: string | null;
  engagementEndAction?: string | null;
  w9Status?: string;
  w9Followup?: boolean;
  ytd?: { cents: number; source: string; year: number };
};

function money(cents: number | undefined): string {
  return ((cents || 0) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function LogResignationDialog({
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
  const [rehireStatus, setRehireStatus] = useState("rehireable");
  const [notes, setNotes] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");

  const reset = () => {
    setRehireStatus("rehireable");
    setNotes("");
    setEffectiveDate(new Date().toISOString().slice(0, 10));
    setPreview(null);
    setPreviewError("");
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreview(null);
    setPreviewError("");
    void (async () => {
      const { data, error } = await supabase.functions.invoke("terminate-cleaner", {
        body: { action: "preview", cleanerId },
      });
      if (cancelled) return;
      if (error || (data as { error?: string } | null)?.error) {
        setPreviewError(await describeEdgeError(error, data));
        return;
      }
      setPreview(data as Preview);
    })();
    return () => { cancelled = true; };
  }, [open, cleanerId]);

  const validEmail = !!cleanerEmail && !cleanerEmail.endsWith("@pending.novara");

  const submit = async () => {
    const confirmMsg =
      `Log ${cleanerName}'s resignation?\n\n` +
      `• Contractor-initiated. There is no disciplinary reason.\n` +
      `• Portal access and new jobs close. Open future jobs are released.\n` +
      `• Email and SMS acknowledge the resignation. They do not say terminated.\n` +
      `• Year-to-date pay is locked for the year-end 1099 batch. No 1099 is sent.`;
    if (!confirm(confirmMsg)) return;

    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("terminate-cleaner", {
        body: {
          action: "resign",
          cleanerId,
          rehireStatus,
          notes: notes.trim() || undefined,
          effectiveDate,
        },
      });
      if (error || (data as { error?: string } | null)?.error) {
        throw new Error(await describeEdgeError(error, data));
      }
      const d = data as { letterSent?: boolean; letterError?: string; reassignedJobs?: number; smsSent?: boolean; w9Followup?: boolean };
      toast.success(
        `${cleanerName} marked resigned.` +
        (d.letterSent ? " Notice emailed." : d.letterError ? ` Notice not emailed: ${d.letterError}` : "") +
        (d.smsSent ? " SMS sent." : "") +
        (d.reassignedJobs ? ` ${d.reassignedJobs} job(s) released.` : "") +
        (d.w9Followup ? " W-9 flagged for follow-up." : ""),
      );
      reset();
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not log the resignation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { onOpenChange(v); if (!v) reset(); } }}>
      <DialogContent className="sm:max-w-lg bg-white max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-800">
            <RiLogoutBoxRLine className="w-5 h-5" /> Log resignation — {cleanerName}
          </DialogTitle>
          <DialogDescription>
            Contractor-initiated. No reason category. The optional note stays internal. The notice confirms the resignation, final pay timing, and the Section 5.4 property return.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {preview?.alreadyEnded ? (
            <p className="text-sm text-rose-700 rounded-lg border border-rose-200 bg-rose-50 p-2.5">
              This engagement is already {preview.engagementEndAction || preview.status || "ended"}. Logging a resignation will not relabel it.
            </p>
          ) : null}
          {previewError ? (
            <p className="text-sm text-amber-800 rounded-lg border border-amber-200 bg-amber-50 p-2.5">{previewError}</p>
          ) : null}

          <div>
            <Label className="text-xs">Internal rehire label</Label>
            <Select value={rehireStatus} onValueChange={setRehireStatus} disabled={busy || preview?.alreadyEnded}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {REHIRE_STATUSES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Effective date</Label>
            <Input type="date" className="mt-1" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} disabled={busy} />
          </div>

          <div>
            <Label className="text-xs">Internal note (optional, never sent)</Label>
            <Textarea rows={3} className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Context for the record only" disabled={busy} />
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 text-[11px] text-slate-600 space-y-1">
            <p>
              {validEmail
                ? <>Notice from NVC Operations → <strong>{cleanerEmail}</strong>. The message does not say terminated.</>
                : <>No valid email on file. SMS still goes out when a phone is on file, without terminated wording.</>}
            </p>
            {preview?.ytd ? (
              <p>
                YTD lock {money(preview.ytd.cents)} ({preview.ytd.source}) for {preview.ytd.year}. No 1099 is sent.
                {preview.w9Followup ? ` W-9 is ${preview.w9Status} and will be flagged for follow-up.` : " W-9 looks complete."}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || preview?.alreadyEnded} className="bg-slate-900 hover:bg-slate-800 text-white">
            {busy ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiLogoutBoxRLine className="w-4 h-4 mr-1.5" />}
            Log resignation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

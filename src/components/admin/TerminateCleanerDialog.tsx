"use client";

// Company-initiated termination. The basis is an agreement section.
// The free-text note stays internal and is never put in the notice.

import { useEffect, useState } from "react";
import { RiLoader4Line, RiCloseCircleLine } from "@/components/icons";
import { supabase } from "@/integrations/supabase/client";
import { describeEdgeError } from "@/lib/edge-invoke";
import { FOR_CAUSE_GROUNDS, TERMINATION_BASES } from "@/lib/engagement-end";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const REHIRE_STATUSES: { value: string; label: string }[] = [
  { value: "rehireable", label: "Rehireable — eligible for future work" },
  { value: "no_rehire", label: "No-hire — not eligible for rehire" },
  { value: "under_review", label: "Under review — eligibility TBD" },
  { value: "blacklist", label: "Blacklist — do not hire (internal only)" },
];

type Preview = {
  alreadyEnded?: boolean;
  abandonment?: { count: number; allowed: boolean; windowDays: number; min: number };
  w9Status?: string;
  w9Followup?: boolean;
  ytd?: { cents: number; source: string; year: number };
};

function money(cents: number | undefined): string {
  return ((cents || 0) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

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
  const [basis, setBasis] = useState("");
  const [ground, setGround] = useState("");
  const [rehireStatus, setRehireStatus] = useState("no_rehire");
  const [notes, setNotes] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");

  const reset = () => {
    setBasis("");
    setGround("");
    setRehireStatus("no_rehire");
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

  const abandonment = preview?.abandonment;
  const abandonmentBlocked = basis === "job_abandonment" && abandonment && !abandonment.allowed;
  const validEmail = !!cleanerEmail && !cleanerEmail.endsWith("@pending.novara");

  const submit = async () => {
    if (!basis) { toast.error("Choose a termination basis."); return; }
    if (basis === "for_cause" && !ground) { toast.error("Choose a Section 5.3 ground."); return; }
    if (abandonmentBlocked) {
      toast.error(`Section 6.4 needs ${abandonment?.min ?? 3} documented instances in a ${abandonment?.windowDays ?? 30}-day window.`);
      return;
    }
    const confirmMsg =
      `Terminate ${cleanerName}?\n\n` +
      `• Company-initiated. The basis stays on the record and out of the notice.\n` +
      `• Portal access and new jobs close. Open future jobs are released.\n` +
      `• Email and SMS say the engagement is terminated.\n` +
      `• Year-to-date pay is locked for the year-end 1099 batch. No 1099 is sent.`;
    if (!confirm(confirmMsg)) return;

    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("terminate-cleaner", {
        body: {
          action: "terminate",
          cleanerId,
          basis,
          ground: basis === "for_cause" ? ground : undefined,
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
        `${cleanerName} terminated.` +
        (d.letterSent ? " Notice emailed." : d.letterError ? ` Notice not emailed: ${d.letterError}` : "") +
        (d.smsSent ? " SMS sent." : "") +
        (d.reassignedJobs ? ` ${d.reassignedJobs} job(s) released.` : "") +
        (d.w9Followup ? " W-9 flagged for follow-up." : ""),
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
      <DialogContent className="sm:max-w-lg bg-white max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-700">
            <RiCloseCircleLine className="w-5 h-5" /> Terminate {cleanerName}
          </DialogTitle>
          <DialogDescription>
            Company-initiated. Pick the agreement basis. The note is internal only. The notice says the engagement is terminated and does not include the reason.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {preview?.alreadyEnded ? (
            <p className="text-sm text-rose-700 rounded-lg border border-rose-200 bg-rose-50 p-2.5">
              This engagement is already ended. A second termination is blocked.
            </p>
          ) : null}
          {previewError ? (
            <p className="text-sm text-amber-800 rounded-lg border border-amber-200 bg-amber-50 p-2.5">{previewError}</p>
          ) : null}

          <div>
            <Label className="text-xs">Agreement basis</Label>
            <Select value={basis} onValueChange={(v) => { setBasis(v); if (v !== "for_cause") setGround(""); }} disabled={busy || preview?.alreadyEnded}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Pick a basis" /></SelectTrigger>
              <SelectContent>
                {TERMINATION_BASES.map((row) => (
                  <SelectItem
                    key={row.value}
                    value={row.value}
                    disabled={row.value === "job_abandonment" && !!abandonment && !abandonment.allowed}
                  >
                    {row.label}
                    {row.value === "job_abandonment" && abandonment
                      ? ` (${abandonment.count} in a ${abandonment.windowDays}-day window)`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {abandonment && !abandonment.allowed ? (
              <p className="text-[11px] text-slate-500 mt-1">
                Section 6.4 stays unavailable until the record shows {abandonment.min} documented abandonment instances inside a {abandonment.windowDays}-day window. Current high count: {abandonment.count}.
              </p>
            ) : null}
          </div>

          {basis === "for_cause" ? (
            <div>
              <Label className="text-xs">Section 5.3 ground</Label>
              <Select value={ground} onValueChange={setGround} disabled={busy}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Pick a ground" /></SelectTrigger>
                <SelectContent>
                  {FOR_CAUSE_GROUNDS.map((row) => (
                    <SelectItem key={row.value} value={row.value}>{row.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div>
            <Label className="text-xs">Internal rehire label</Label>
            <Select value={rehireStatus} onValueChange={setRehireStatus} disabled={busy}>
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
            <Label className="text-xs">Internal note (never sent)</Label>
            <Textarea rows={3} className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Context for the record only" disabled={busy} />
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 text-[11px] text-slate-600 space-y-1">
            <p>
              {validEmail
                ? <>Notice from NVC Operations → <strong>{cleanerEmail}</strong>, CC contact@. SMS uses the same terminated wording.</>
                : <>No valid email on file. SMS still goes out when a phone is on file.</>}
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
          <Button
            onClick={submit}
            disabled={busy || !basis || preview?.alreadyEnded || abandonmentBlocked}
            className="bg-rose-600 hover:bg-rose-700 text-white"
          >
            {busy ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiCloseCircleLine className="w-4 h-4 mr-1.5" />}
            Terminate contractor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

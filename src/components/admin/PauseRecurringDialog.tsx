"use client";

import { useEffect, useMemo, useState } from "react";
import { RiLoader4Line, RiPauseLine } from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { asErrorMessage, edgeResult } from "@/lib/edge-invoke";
import {
  buildRecurringPauseReason,
  buildRecurringPauseSms,
  DEFAULT_RECURRING_PAUSE_REASON,
  RECURRING_PAUSE_REASON_OPTIONS,
  type RecurringPauseReasonId,
} from "@/lib/recurring-pause";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export default function PauseRecurringDialog({
  open,
  onOpenChange,
  schedule,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  schedule: {
    id: string;
    email: string;
    first_name: string | null;
    phone: string | null;
    cadence: string;
  } | null;
  onDone: () => void;
}) {
  const [reasonCode, setReasonCode] = useState<RecurringPauseReasonId>(DEFAULT_RECURRING_PAUSE_REASON);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !schedule) return;
    setReasonCode(DEFAULT_RECURRING_PAUSE_REASON);
    setReason(buildRecurringPauseReason(DEFAULT_RECURRING_PAUSE_REASON, schedule.first_name));
  }, [open, schedule]);

  const smsPreview = useMemo(() => buildRecurringPauseSms(reason), [reason]);
  const name = `${schedule?.first_name || ""}`.trim() || schedule?.email || "this customer";

  const pickReason = (id: RecurringPauseReasonId) => {
    setReasonCode(id);
    setReason(buildRecurringPauseReason(id, schedule?.first_name));
  };

  const submit = async () => {
    if (!schedule) return;
    const message = reason.trim();
    if (!message) {
      toast.error("Write the message the customer will see.");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-recurring-pause", {
        body: { scheduleId: schedule.id, reasonCode, reason: message },
      });
      const res = await edgeResult(error, data);
      if (!res.ok) throw new Error(res.error || "Pause failed");
      const d = data as { smsSent?: boolean; emailed?: boolean; smsError?: string | null; emailError?: string | null };
      toast.success(
        `Paused ${name}.` +
        (d.emailed ? " Email sent." : d.emailError ? ` Email not sent: ${d.emailError}` : "") +
        (d.smsSent ? " SMS sent." : d.smsError ? ` SMS not sent: ${d.smsError}` : ""),
      );
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(asErrorMessage(e, "Could not pause this schedule."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg bg-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-800">
            <RiPauseLine className="w-5 h-5" /> Pause {name}&apos;s cleaning
          </DialogTitle>
          <DialogDescription>
            Pick the reason the customer will see. We text and email them this wording, then stop auto-booking. Already-created visits and Glow billing are not changed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div>
            <Label className="text-xs">Reason</Label>
            <Select value={reasonCode} onValueChange={(v) => pickReason(v as RecurringPauseReasonId)} disabled={busy}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RECURRING_PAUSE_REASON_OPTIONS.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Customer message (SMS + email)</Label>
            <Textarea
              rows={4}
              className="mt-1"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What should we tell them?"
              disabled={busy}
            />
          </div>

          {smsPreview ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px] text-slate-600">
              <p className="font-semibold text-slate-500 uppercase tracking-wide mb-1">SMS preview</p>
              <p className="whitespace-pre-wrap">{smsPreview}</p>
            </div>
          ) : null}

          {!schedule?.phone ? (
            <p className="text-[11px] text-amber-700">No phone on file — we&apos;ll email only.</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !reason.trim()} className="bg-amber-600 hover:bg-amber-700 text-white">
            {busy ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiPauseLine className="w-4 h-4 mr-1.5" />}
            Pause and notify
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

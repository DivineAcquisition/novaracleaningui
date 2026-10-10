"use client";

import { useEffect, useMemo, useState } from "react";
import { RiLoader4Line, RiPlayLine } from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { asErrorMessage, edgeResult } from "@/lib/edge-invoke";
import { buildRecurringResumeSms } from "@/lib/recurring-pause";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TIME_SLOTS = [
  "8:00 AM - 9:00 AM", "9:00 AM - 10:00 AM", "10:00 AM - 11:00 AM", "11:00 AM - 12:00 PM",
  "12:00 PM - 1:00 PM", "1:00 PM - 2:00 PM", "1:30 PM - 2:30 PM", "2:00 PM - 3:00 PM",
  "3:00 PM - 4:00 PM", "4:00 PM - 5:00 PM", "5:00 PM - 6:00 PM",
];

function formatVisit(date: string, slot: string): string {
  if (!date) return slot || "the next visit";
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return [date, slot].filter(Boolean).join(" at ");
  const label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return slot ? `${label} at ${slot}` : label;
}

export default function ResumeRecurringDialog({
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
    next_service_date: string | null;
    preferred_time_slot: string | null;
    price_cents: number | null;
  } | null;
  onDone: () => void;
}) {
  const [serviceDate, setServiceDate] = useState("");
  const [timeSlot, setTimeSlot] = useState("1:30 PM - 2:30 PM");
  const [chargeDollars, setChargeDollars] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !schedule) return;
    setServiceDate(schedule.next_service_date || "");
    setTimeSlot(schedule.preferred_time_slot || "1:30 PM - 2:30 PM");
    setChargeDollars(
      schedule.price_cents != null && schedule.price_cents > 0
        ? (schedule.price_cents / 100).toFixed(2)
        : "",
    );
  }, [open, schedule]);

  const chargeCents = Math.round(Number(chargeDollars || 0) * 100);
  const chargedLabel = Number.isFinite(chargeCents) && chargeCents > 0
    ? `$${(chargeCents / 100).toFixed(2)}`
    : null;
  const when = formatVisit(serviceDate, timeSlot);
  const smsPreview = useMemo(
    () => buildRecurringResumeSms({
      firstName: schedule?.first_name,
      when,
      chargedLabel,
    }),
    [schedule?.first_name, when, chargedLabel],
  );
  const slots = TIME_SLOTS.includes(timeSlot) ? TIME_SLOTS : [timeSlot, ...TIME_SLOTS];
  const name = `${schedule?.first_name || ""}`.trim() || schedule?.email || "this customer";

  const submit = async () => {
    if (!schedule) return;
    if (!serviceDate) {
      toast.error("Pick the next clean date.");
      return;
    }
    if (!timeSlot) {
      toast.error("Pick the next clean time.");
      return;
    }
    if (chargeDollars.trim() && (!Number.isFinite(chargeCents) || chargeCents < 0)) {
      toast.error("Enter a charge like 125.50, or leave it blank to skip billing.");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-recurring-resume", {
        body: {
          scheduleId: schedule.id,
          serviceDate,
          timeSlot,
          chargeCents: chargeCents > 0 ? chargeCents : 0,
        },
      });
      const res = await edgeResult(error, data);
      if (!res.ok) throw new Error(res.error || "Resume failed");
      const d = data as {
        smsSent?: boolean;
        emailed?: boolean;
        smsError?: string | null;
        emailError?: string | null;
        charged?: boolean;
        chargeError?: string | null;
      };
      toast.success(
        `Resumed ${name}. Next visit ${when}.` +
        (d.charged ? ` Charged ${chargedLabel}.` : d.chargeError ? ` Not charged: ${d.chargeError}` : "") +
        (d.emailed ? " Email sent." : d.emailError ? ` Email not sent: ${d.emailError}` : "") +
        (d.smsSent ? " SMS sent." : d.smsError ? ` SMS not sent: ${d.smsError}` : ""),
      );
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(asErrorMessage(e, "Could not resume this schedule."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg bg-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-800">
            <RiPlayLine className="w-5 h-5" /> Resume {name}&apos;s cleaning
          </DialogTitle>
          <DialogDescription>
            Set the next visit, charge the card on file if this resume should bill, then text and email them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Next clean date</Label>
              <Input
                type="date"
                className="mt-1"
                value={serviceDate}
                onChange={(e) => setServiceDate(e.target.value)}
                disabled={busy}
              />
            </div>
            <div>
              <Label className="text-xs">Time</Label>
              <Select value={timeSlot} onValueChange={setTimeSlot} disabled={busy}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {slots.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs">Charge the card on file ($)</Label>
            <Input
              className="mt-1"
              inputMode="decimal"
              placeholder="125.50 — leave blank to skip"
              value={chargeDollars}
              onChange={(e) => setChargeDollars(e.target.value)}
              disabled={busy}
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Leave blank if Glow billing should not run on this resume.
            </p>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Text they&apos;ll get</p>
            <p className="text-xs text-slate-700 mt-1">{smsPreview}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={busy} onClick={() => void submit()}>
            {busy ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiPlayLine className="w-4 h-4 mr-1.5" />}
            Resume and notify
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

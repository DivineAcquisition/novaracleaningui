"use client";

// ─── DelayBookingDialog ──────────────────────────────────────────────────
//
// Admin-only: push a booking's arrival window forward on the SAME day by
// 1h, 2h, or 3h with a single-select reason and optional service-recovery
// compensation (discount off the total OR a wallet credit). Reschedule is a
// different action (different day, different tone, different comms).

import { useEffect, useMemo, useState } from "react";
import { RiLoader4Line, RiTimeLine, RiArrowRightLine } from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ResponsiveModal } from "@/components/booking/ResponsiveModal";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const DELAY_HOURS: Array<{ value: 1 | 2 | 3; label: string }> = [
  { value: 1, label: "1 hour" },
  { value: 2, label: "2 hours" },
  { value: 3, label: "3 hours" },
];

// Single-select reasons — kept short + operational. Custom text isn't needed
// on purpose; if there's a truly novel reason, use Reschedule instead.
const DELAY_REASONS = [
  "Prior job ran long",
  "Traffic / travel delay",
  "Cleaner running late",
  "Weather / road conditions",
  "Team short-staffed",
  "Customer requested later arrival",
  "Supply / equipment issue",
  "Other operational delay",
];

type Compensation = "none" | "discount" | "credit";

interface DelayBookingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: {
    id: string;
    service_date: string | null;
    time_slot: string | null;
    first_name: string | null;
    last_name: string | null;
    total_estimate_cents: number | null;
  };
  onSuccess: () => void;
}

// Preview the shifted label locally so the admin sees "9:00 AM - 10:00 AM →
// 11:00 AM - 12:00 PM" before confirming. Falls back to a generic phrase for
// slots the parser can't rebuild (server does the authoritative math).
function previewShiftedSlot(slot: string | null, hours: number): string | null {
  if (!slot) return null;
  const m = slot.trim().match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m) return null;
  const toH = (h: string, mer: string | undefined) => {
    let n = parseInt(h, 10);
    if (mer) {
      const u = mer.toUpperCase();
      if (u === "PM" && n < 12) n += 12;
      if (u === "AM" && n === 12) n = 0;
    }
    return n;
  };
  const startH = toH(m[1], m[3]);
  let endH = toH(m[4], m[6]);
  if (Number.isNaN(startH) || Number.isNaN(endH)) return null;
  if (m[6] && !m[3] && startH < endH - 12) endH += 0;
  const sH = startH + hours;
  const eH = endH + hours;
  if (eH > 23) return null;
  const fmt = (h: number) => {
    const hh = ((h % 24) + 24) % 24;
    const suffix = hh >= 12 ? "PM" : "AM";
    const disp = hh % 12 === 0 ? 12 : hh % 12;
    return `${disp}:00 ${suffix}`;
  };
  return `${fmt(sH)} - ${fmt(eH)}`;
}

export function DelayBookingDialog({
  open,
  onOpenChange,
  booking,
  onSuccess,
}: DelayBookingDialogProps) {
  const [hours, setHours] = useState<1 | 2 | 3>(1);
  const [reason, setReason] = useState<string>(DELAY_REASONS[0]);
  const [compensation, setCompensation] = useState<Compensation>("none");
  const [compAmount, setCompAmount] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setHours(1);
      setReason(DELAY_REASONS[0]);
      setCompensation("none");
      setCompAmount("");
      setSubmitting(false);
    }
  }, [open]);

  const previewSlot = useMemo(
    () => previewShiftedSlot(booking.time_slot, hours),
    [booking.time_slot, hours],
  );

  const compCentsNum = Math.round(Number(compAmount) * 100);
  const compValid =
    compensation === "none" || (Number.isFinite(compCentsNum) && compCentsNum > 0);

  const totalCents = booking.total_estimate_cents ?? 0;
  const wouldOvercharge =
    compensation === "discount" && compCentsNum > totalCents && totalCents > 0;

  const submit = async () => {
    if (!compValid) {
      toast.error("Enter a dollar amount for the compensation.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-delay-booking", {
        body: {
          bookingId: booking.id,
          delayHours: hours,
          reason,
          compensation,
          compensationAmountCents: compensation === "none" ? 0 : compCentsNum,
        },
      });
      if (error) {
        const errMsg =
          typeof error === "object" && error && "message" in error
            ? String((error as { message: string }).message)
            : String(error);
        throw new Error(errMsg);
      }
      const payload = data as { ok?: boolean; error?: string; newSlot?: string; emailSent?: boolean; smsSent?: boolean; cleanerSmsSent?: boolean } | null;
      if (!payload?.ok) throw new Error(payload?.error || "Failed to delay booking");
      const notified = [
        payload.emailSent && "email",
        payload.smsSent && "SMS",
        payload.cleanerSmsSent && "cleaner",
      ]
        .filter(Boolean)
        .join(" + ");
      toast.success(
        `Delay applied — new arrival ${payload.newSlot || previewSlot || "updated"}.` +
          (notified ? ` Notified: ${notified}.` : ""),
      );
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Could not delay booking", { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const footer = (
    <div className="flex w-full gap-3 sm:justify-end">
      <Button
        variant="outline"
        onClick={() => onOpenChange(false)}
        disabled={submitting}
        className="flex-1 sm:flex-none"
      >
        Cancel
      </Button>
      <Button
        onClick={() => void submit()}
        disabled={submitting || !compValid || wouldOvercharge || !previewSlot}
        className="flex-1 sm:flex-none bg-amber-600 hover:bg-amber-700 text-white"
      >
        {submitting && <RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />}
        Apply delay
      </Button>
    </div>
  );

  const name = [booking.first_name, booking.last_name].filter(Boolean).join(" ") || "customer";

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Delay arrival window"
      description="Push today's cleaning back by 1h, 2h, or 3h. The customer + assigned cleaner are notified automatically. For a different day, use Reschedule."
      desktopMaxWidthClass="max-w-lg"
      footer={footer}
    >
      <Card className="mb-4 border-amber-200 bg-amber-50/60">
        <CardContent className="p-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-amber-800">Current window</p>
              <p className="font-semibold text-amber-900">{booking.time_slot || "—"}</p>
            </div>
            <RiArrowRightLine className="h-4 w-4 text-amber-700" />
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wider text-amber-800">After delay</p>
              <p className="font-semibold text-amber-900">
                {previewSlot || "Can't push past today"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {/* Delay length — 1 / 2 / 3 hours */}
        <div>
          <Label className="text-xs text-slate-600">How far back?</Label>
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            {DELAY_HOURS.map((h) => (
              <button
                key={h.value}
                type="button"
                onClick={() => setHours(h.value)}
                className={cn(
                  "flex items-center justify-center gap-1.5 py-2 rounded-md border text-sm font-medium transition-colors",
                  hours === h.value
                    ? "bg-amber-600 text-white border-amber-700 shadow-sm"
                    : "bg-white text-slate-700 border-slate-200 hover:border-amber-300 hover:text-amber-900",
                )}
                disabled={submitting}
              >
                <RiTimeLine className="w-4 h-4" />
                {h.label}
              </button>
            ))}
          </div>
        </div>

        {/* Reason — single select */}
        <div>
          <Label htmlFor="delay-reason" className="text-xs text-slate-600">
            Reason
          </Label>
          <Select value={reason} onValueChange={setReason} disabled={submitting}>
            <SelectTrigger id="delay-reason" className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DELAY_REASONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Compensation — discount OR credit (or none) */}
        <div>
          <Label className="text-xs text-slate-600">Compensation for {name}</Label>
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            {(
              [
                { id: "none", label: "None" },
                { id: "discount", label: "Discount" },
                { id: "credit", label: "Credit" },
              ] as Array<{ id: Compensation; label: string }>
            ).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCompensation(c.id)}
                className={cn(
                  "py-2 rounded-md border text-sm font-medium transition-colors",
                  compensation === c.id
                    ? c.id === "credit"
                      ? "bg-violet-600 text-white border-violet-700 shadow-sm"
                      : c.id === "discount"
                        ? "bg-emerald-600 text-white border-emerald-700 shadow-sm"
                        : "bg-slate-700 text-white border-slate-800 shadow-sm"
                    : "bg-white text-slate-700 border-slate-200 hover:border-slate-300",
                )}
                disabled={submitting}
              >
                {c.label}
              </button>
            ))}
          </div>
          {compensation !== "none" && (
            <div className="mt-2">
              <Label htmlFor="delay-comp-amount" className="text-xs text-slate-600">
                Amount ($)
              </Label>
              <Input
                id="delay-comp-amount"
                type="number"
                min={0}
                step="0.01"
                value={compAmount}
                onChange={(e) => setCompAmount(e.target.value)}
                placeholder={compensation === "credit" ? "e.g. 20.00 to wallet" : "e.g. 15.00 off this cleaning"}
                className="mt-1.5"
                disabled={submitting}
              />
              <p className="mt-1 text-[11px] text-slate-500">
                {compensation === "discount"
                  ? "Reduces this booking's total. Best for pre-payment goodwill."
                  : "Adds to the customer's Novara wallet — auto-applies at their next checkout."}
              </p>
              {wouldOvercharge && (
                <p className="mt-1 text-[11px] text-rose-600">
                  Discount can't exceed the booking total ({`$${(totalCents / 100).toFixed(2)}`}).
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </ResponsiveModal>
  );
}

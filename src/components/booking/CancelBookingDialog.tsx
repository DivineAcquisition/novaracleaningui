"use client";

import { RiAlertLine, RiCheckboxCircleLine, RiLoader4Line } from "@remixicon/react";
import { useState } from "react";
import { format, differenceInHours } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ResponsiveModal } from "@/components/booking/ResponsiveModal";
import { parseServiceDate } from "@/lib/service-date";

interface Booking {
  id: string;
  service_date: string;
  time_slot: string;
  service_type: string;
  address: string;
  city: string;
  state: string;
  zip_code?: string;
  total_estimate_cents: number;
  uses_credit: boolean;
}

interface CancelBookingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: Booking;
  onSuccess: () => void;
}

const CANCEL_REASONS = [
  { value: "schedule_change", label: "My schedule changed" },
  { value: "found_alternative", label: "Found another service" },
  { value: "too_expensive", label: "Too expensive" },
  { value: "not_needed", label: "No longer need the service" },
  { value: "moving", label: "Moving out of service area" },
  { value: "other", label: "Other reason" },
];

// mirrors CANCEL_SHORT_NOTICE_FEE_CENTS in supabase/functions/_shared/booking-policy.ts
const SHORT_NOTICE_FEE_CENTS = 5000;

export function CancelBookingDialog({
  open,
  onOpenChange,
  booking,
  onSuccess,
}: CancelBookingDialogProps) {
  const [step, setStep] = useState<"reason" | "confirm" | "done">("reason");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [refundInfo, setRefundInfo] = useState("");

  const serviceDate = parseServiceDate(booking.service_date);
  const hoursUntil = differenceInHours(serviceDate, new Date());
  const isWithin24Hours = hoursUntil < 24 && hoursUntil > 0;
  const totalDollars = (booking.total_estimate_cents / 100).toFixed(2);
  const refundLabel = booking.uses_credit
    ? "Membership credit will be restored — no cash refund."
    : isWithin24Hours
      ? `Refund of $${((booking.total_estimate_cents - SHORT_NOTICE_FEE_CENTS) / 100).toFixed(2)} (after $${(SHORT_NOTICE_FEE_CENTS / 100).toFixed(0)} short-notice fee)`
      : `Full refund — $${totalDollars}`;

  const handleCancel = async () => {
    if (!reason) {
      toast.error("Please select a reason");
      return;
    }
    setIsCancelling(true);
    try {
      const cancelReason = `${CANCEL_REASONS.find((r) => r.value === reason)?.label || reason}${notes ? `: ${notes}` : ""}`;
      const response = await supabase.functions.invoke("cancel-booking", {
        body: {
          bookingId: booking.id,
          cancelReason,
          // Server computes the fee + refund. `auto` lets the policy
          // helper decide based on the booking + 24-hour rule.
          refundType: booking.uses_credit ? "none" : "auto",
          source: "customer_portal",
        },
      });
      if (response.error) {
        const msg = typeof response.error === "object" && "message" in response.error
          ? (response.error as { message: string }).message
          : String(response.error);
        throw new Error(msg);
      }
      if (response.data?.error) throw new Error(response.data.error);
      setRefundInfo(response.data?.refundAmount || "None");
      setStep("done");
      toast.success("Booking cancelled. A confirmation email has been sent.");
      onSuccess();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to cancel booking";
      toast.error(msg);
    } finally {
      setIsCancelling(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => {
      setStep("reason");
      setReason("");
      setNotes("");
      setRefundInfo("");
    }, 200);
  };

  // Footer is per-step — gives the sticky bottom CTA bar on mobile so
  // the primary action is always reachable without scrolling, and the
  // secondary "Keep Booking" / "Go Back" is always one tap away.
  const footer =
    step === "reason" ? (
      <div className="flex w-full gap-3 sm:justify-end">
        <Button variant="outline" onClick={handleClose} className="flex-1 sm:flex-none">
          Keep Booking
        </Button>
        <Button
          onClick={() => setStep("confirm")}
          disabled={!reason}
          variant="destructive"
          className="flex-1 sm:flex-none"
        >
          Continue
        </Button>
      </div>
    ) : step === "confirm" ? (
      <div className="flex w-full gap-3 sm:justify-end">
        <Button
          variant="outline"
          onClick={() => setStep("reason")}
          disabled={isCancelling}
          className="flex-1 sm:flex-none"
        >
          Go Back
        </Button>
        <Button
          variant="destructive"
          onClick={handleCancel}
          disabled={isCancelling}
          className="flex-1 sm:flex-none"
        >
          {isCancelling && <RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />}
          Confirm Cancellation
        </Button>
      </div>
    ) : null;

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={handleClose}
      title={step === "done" ? "Booking Cancelled" : "Cancel Booking"}
      description={
        step === "reason"
          ? "Tell us what changed and we'll get this sorted."
          : step === "confirm"
            ? "Review your cancellation summary."
            : undefined
      }
      desktopMaxWidthClass="max-w-md"
      footer={footer}
    >
      {step === "reason" && (
        <div className="space-y-4">
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-3.5 text-sm">
              <p className="font-semibold">
                {format(serviceDate, "EEEE, MMMM d")} at {booking.time_slot}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {booking.service_type} · {booking.address}, {booking.city}
              </p>
            </CardContent>
          </Card>
          <div className="space-y-2">
            <Label>Why are you cancelling?</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Select a reason..." />
              </SelectTrigger>
              <SelectContent>
                {CANCEL_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>
              Additional notes <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything else..."
              className="resize-none"
              rows={3}
            />
          </div>
        </div>
      )}

      {step === "confirm" && (
        <div className="space-y-4">
          <div className="space-y-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-destructive/10">
                <RiAlertLine className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-sm font-semibold">Are you sure?</p>
                <p className="text-xs text-muted-foreground">This cannot be undone.</p>
              </div>
            </div>
            <Separator />
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Date</span>
                <span className="font-medium">{format(serviceDate, "MMM d, yyyy")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-medium">${totalDollars}</span>
              </div>
              {!booking.uses_credit && (
                <>
                  <Separator />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Refund</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-right text-[11px] leading-tight whitespace-normal",
                        isWithin24Hours
                          ? "border-amber-300 text-amber-700"
                          : "border-emerald-300 text-emerald-700",
                      )}
                    >
                      {refundLabel}
                    </Badge>
                  </div>
                </>
              )}
              {booking.uses_credit && (
                <>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Credit</span>
                    <Badge variant="outline" className="border-emerald-300 text-xs text-emerald-700">
                      Will be restored
                    </Badge>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-4 py-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-900/30">
            <RiCheckboxCircleLine className="h-7 w-7 text-emerald-600" />
          </div>
          <div>
            <p className="font-semibold">Booking cancelled</p>
            <p className="mt-1 text-sm text-muted-foreground">Confirmation email sent.</p>
            {refundInfo && refundInfo !== "None" && (
              <p className="mt-2 text-sm font-medium text-emerald-600">
                Refund of {refundInfo} will process in 5–10 business days.
              </p>
            )}
          </div>
          <Button onClick={handleClose} className="w-full">
            Done
          </Button>
        </div>
      )}
    </ResponsiveModal>
  );
}

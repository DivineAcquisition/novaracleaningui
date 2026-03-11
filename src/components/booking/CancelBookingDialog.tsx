"use client";

import {
  RiAlertLine,
  RiCalendarLine,
  RiCheckboxCircleLine,
  RiCloseLine,
  RiLoader4Line,
  RiMapPinLine,
  RiRefundLine,
  RiTimeLine,
} from "@remixicon/react";
import { useState } from "react";
import { format, differenceInHours } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Booking {
  id: string;
  service_date: string;
  time_slot: string;
  service_type: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
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
  { value: "reschedule_instead", label: "I'd rather reschedule" },
  { value: "other", label: "Other reason" },
];

export function CancelBookingDialog({
  open,
  onOpenChange,
  booking,
  onSuccess,
}: CancelBookingDialogProps) {
  const [step, setStep] = useState<"reason" | "confirm" | "done">("reason");
  const [reason, setReason] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [refundInfo, setRefundInfo] = useState("");

  const serviceDate = new Date(booking.service_date);
  const hoursUntil = differenceInHours(serviceDate, new Date());
  const isWithin24Hours = hoursUntil < 24 && hoursUntil > 0;
  const totalDollars = (booking.total_estimate_cents / 100).toFixed(2);

  const refundType = isWithin24Hours ? "partial" : "full";
  const refundLabel = isWithin24Hours
    ? `Partial refund (50%) — $${(booking.total_estimate_cents / 200).toFixed(2)}`
    : `Full refund — $${totalDollars}`;

  const handleCancel = async () => {
    if (!reason) {
      toast.error("Please select a reason");
      return;
    }

    setIsCancelling(true);
    try {
      const cancelReason = `${CANCEL_REASONS.find((r) => r.value === reason)?.label || reason}${additionalNotes ? `: ${additionalNotes}` : ""}`;

      const { data, error } = await supabase.functions.invoke(
        "cancel-booking",
        {
          body: {
            bookingId: booking.id,
            cancelReason,
            refundType: booking.uses_credit ? "none" : refundType,
          },
        }
      );

      if (error) throw error;

      setRefundInfo(data?.refundAmount || "None");
      setStep("done");
      toast.success("Booking cancelled. A confirmation email has been sent.");
      onSuccess();
    } catch (error: any) {
      console.error("Cancel error:", error);
      toast.error(error.message || "Failed to cancel booking");
    } finally {
      setIsCancelling(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => {
      setStep("reason");
      setReason("");
      setAdditionalNotes("");
      setRefundInfo("");
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {step === "done" ? "Booking Cancelled" : "Cancel Booking"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Cancel your upcoming cleaning appointment
          </DialogDescription>
        </DialogHeader>

        {step === "reason" && (
          <div className="space-y-4">
            {/* Booking summary */}
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-3.5">
                <div className="flex items-center gap-3">
                  <RiCalendarLine className="w-5 h-5 text-primary flex-shrink-0" />
                  <div className="text-sm">
                    <p className="font-semibold">
                      {format(serviceDate, "EEEE, MMMM d")} at{" "}
                      {booking.time_slot}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {booking.service_type} &middot; {booking.address},{" "}
                      {booking.city}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Why are you cancelling?
              </Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger>
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
              <Label className="text-sm font-medium">
                Additional notes{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Textarea
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                placeholder="Anything else we should know..."
                className="resize-none"
                rows={2}
              />
            </div>

            <div className="flex gap-3 justify-end pt-2 border-t">
              <Button variant="outline" onClick={handleClose}>
                Keep Booking
              </Button>
              <Button
                onClick={() => setStep("confirm")}
                disabled={!reason}
                variant="destructive"
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === "confirm" && (
          <div className="space-y-4">
            <div className="rounded-xl bg-destructive/5 border border-destructive/20 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center flex-shrink-0">
                  <RiAlertLine className="w-5 h-5 text-destructive" />
                </div>
                <div>
                  <p className="font-semibold text-sm">
                    Are you sure you want to cancel?
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    This action cannot be undone. You will need to rebook if you
                    change your mind.
                  </p>
                </div>
              </div>

              <Separator />

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Service</span>
                  <span className="font-medium">{booking.service_type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date</span>
                  <span className="font-medium">
                    {format(serviceDate, "MMM d, yyyy")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-medium">${totalDollars}</span>
                </div>
                {!booking.uses_credit && (
                  <>
                    <Separator />
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Refund</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs",
                          isWithin24Hours
                            ? "text-amber-600 border-amber-300"
                            : "text-emerald-600 border-emerald-300"
                        )}
                      >
                        {refundLabel}
                      </Badge>
                    </div>
                    {isWithin24Hours && (
                      <p className="text-[11px] text-amber-600">
                        Cancellations within 24 hours of the service date receive
                        a 50% refund.
                      </p>
                    )}
                  </>
                )}
                {booking.uses_credit && (
                  <>
                    <Separator />
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Credit</span>
                      <Badge
                        variant="outline"
                        className="text-xs text-emerald-600 border-emerald-300"
                      >
                        Credit will be restored
                      </Badge>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-2 border-t">
              <Button
                variant="outline"
                onClick={() => setStep("reason")}
                disabled={isCancelling}
              >
                Go Back
              </Button>
              <Button
                variant="destructive"
                onClick={handleCancel}
                disabled={isCancelling}
              >
                {isCancelling && (
                  <RiLoader4Line className="mr-2 w-4 h-4 animate-spin" />
                )}
                Confirm Cancellation
              </Button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4 text-center py-4">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <RiCheckboxCircleLine className="w-7 h-7 text-emerald-600" />
            </div>
            <div>
              <p className="font-semibold">Your booking has been cancelled</p>
              <p className="text-sm text-muted-foreground mt-1">
                A confirmation email has been sent to your inbox.
              </p>
              {refundInfo && refundInfo !== "None" && (
                <p className="text-sm text-emerald-600 mt-2 font-medium">
                  Refund of {refundInfo} will be processed within 5-10 business
                  days.
                </p>
              )}
            </div>
            <Button onClick={handleClose} className="w-full">
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

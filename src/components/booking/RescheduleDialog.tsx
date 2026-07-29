"use client";

import {
  RiArrowRightLine,
  RiCalendarLine,
  RiLoader4Line,
  RiMapPinLine,
} from "@remixicon/react";
import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ResponsiveModal } from "@/components/booking/ResponsiveModal";
import { SchedulePicker } from "@/components/booking/SchedulePicker";
import { parseServiceDate } from "@/lib/service-date";

/**
 * Safely format a YYYY-MM-DD service date. Internal/admin bookings can
 * carry a null/empty service_date; passing that straight into
 * `new Date(...)` yields an Invalid Date and makes date-fns `format`
 * throw, which previously crashed the whole reschedule modal.
 */
function safeFormatDate(value: string | null | undefined, pattern: string): string {
  if (!value) return "—";
  // A bare service_date is a calendar day, not an instant: parsed raw it lands
  // on UTC midnight and displays as the day before.
  const d = parseServiceDate(value);
  if (!d || isNaN(d.getTime())) return "—";
  return format(d, pattern);
}

interface Booking {
  id: string;
  service_date: string;
  time_slot: string;
  service_type: string;
  home_size_id: string;
  service_duration?: number;
  address: string;
  city: string;
  state: string;
}

interface RescheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: Booking;
  onSuccess: () => void;
  /**
   * Caller context — defaults to "customer_portal". The admin
   * /admin/bookings page passes "admin" so the audit trail and any
   * differential downstream behavior (skip late-fee, skip customer
   * confirmation toast, etc.) can branch on it.
   */
  source?: "customer_portal" | "admin";
}

export function RescheduleDialog({
  open,
  onOpenChange,
  booking,
  onSuccess,
  source = "customer_portal",
}: RescheduleDialogProps) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  // selectedTime carries the slot id ("9:00 AM - 10:00 AM" shape), which
  // SchedulePicker also writes into the booking funnel. Server keeps
  // bookings.time_slot in this exact format so reschedule stays joinable
  // to availability + GHL stays in sync.
  const [selectedTime, setSelectedTime] = useState("");
  const [isRescheduling, setIsRescheduling] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelectedDate(undefined);
      setSelectedTime("");
    }
  }, [open]);

  const handleReschedule = async () => {
    if (!selectedDate || !selectedTime) {
      toast.error("Please select both date and time");
      return;
    }

    setIsRescheduling(true);
    try {
      const response = await supabase.functions.invoke("reschedule-booking", {
        body: {
          bookingId: booking.id,
          newDate: format(selectedDate, "yyyy-MM-dd"),
          newTimeSlot: selectedTime,
          oldDate: booking.service_date,
          oldTimeSlot: booking.time_slot,
          source,
        },
      });

      if (response.error) {
        const errMsg = typeof response.error === "object" && "message" in response.error
          ? (response.error as { message: string }).message
          : String(response.error);
        throw new Error(errMsg || "Reschedule request failed");
      }
      const { data } = response;
      if (data?.error) throw new Error(data.error);
      if (!data?.success) {
        toast.error(data?.message || "Failed to reschedule");
        return;
      }

      const feeNote = data?.rescheduleFeeCents
        ? ` A $${(data.rescheduleFeeCents / 100).toFixed(0)} short-notice fee was added to the invoice.`
        : "";
      if (source === "admin") {
        toast.success(
          `Booking rescheduled to ${format(selectedDate, "MMM d, yyyy")} · ${selectedTime}. ` +
            `Customer notified via SMS & email; GHL pipelines updated.${feeNote}`,
        );
      } else {
        toast.success(`Booking rescheduled! Confirmation sent.${feeNote}`);
      }
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error("Reschedule error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      toast.error(msg || "Failed to reschedule booking");
    } finally {
      setIsRescheduling(false);
    }
  };

  const footer = (
    <div className="flex w-full gap-3 sm:justify-end">
      <Button
        variant="outline"
        onClick={() => onOpenChange(false)}
        disabled={isRescheduling}
        className="flex-1 sm:flex-none"
      >
        Cancel
      </Button>
      <Button
        onClick={handleReschedule}
        disabled={!selectedDate || !selectedTime || isRescheduling}
        className="flex-1 sm:flex-none"
      >
        {isRescheduling && <RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />}
        Confirm Reschedule
      </Button>
    </div>
  );

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Reschedule Booking"
      description={
        source === "admin"
          ? "Pick any new date and time. The customer is notified via SMS and GHL is updated automatically."
          : "Pick a new date and time for your appointment."
      }
      desktopMaxWidthClass="max-w-2xl"
      footer={footer}
    >
      {/* Current appointment summary */}
      <Card className="mb-4 border-primary/20 bg-primary/5">
        <CardContent className="p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <RiCalendarLine className="h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">Current Appointment</p>
                <p className="text-sm font-semibold">
                  {safeFormatDate(booking.service_date, "MMM d, yyyy")} · {booking.time_slot}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <RiMapPinLine className="h-4 w-4" />
              {booking.city}, {booking.state}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reused booking-flow SchedulePicker — same calendar, same time
          slots, same availability hook. Keeps the reschedule UX 1:1 with
          the original checkout experience. */}
      <SchedulePicker
        mode={source === "admin" ? "admin" : "customer"}
        selectedDate={selectedDate}
        selectedTime={selectedTime}
        onDateSelect={(date) => {
          setSelectedDate(date);
          setSelectedTime("");
        }}
        onTimeSelect={(date, slotId /*, startTime, endTime */) => {
          setSelectedDate(date);
          setSelectedTime(slotId);
        }}
      />

      {/* Quick visual confirmation of the From → To swap */}
      {selectedDate && selectedTime && (
        <Card className="mt-4 animate-fade-in border-primary/30 bg-gradient-to-r from-primary/5 to-accent/5">
          <CardContent className="p-3">
            <div className="flex items-center justify-center gap-3 text-sm">
              <div className="text-center">
                <p className="text-[11px] text-muted-foreground">From</p>
                <p className="font-medium">{safeFormatDate(booking.service_date, "MMM d")}</p>
                <p className="text-[11px] text-muted-foreground">{booking.time_slot}</p>
              </div>
              <RiArrowRightLine className="h-5 w-5 text-primary" />
              <div className="text-center">
                <p className="text-[11px] text-muted-foreground">To</p>
                <p className="font-semibold text-primary">{format(selectedDate, "MMM d")}</p>
                <p className="text-[11px] text-primary">{selectedTime}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </ResponsiveModal>
  );
}

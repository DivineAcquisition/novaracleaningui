"use client";

import {
  RiArrowRightLine,
  RiCalendarLine,
  RiLoader4Line,
  RiMapPinLine,
  RiTimeLine
} from "@remixicon/react";
import { useState, useEffect } from "react";
import { format, addDays } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";

import { cn } from "@/lib/utils";
import { generateTimeSlots } from "@/lib/time-slots";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
}

export function RescheduleDialog({ open, onOpenChange, booking, onSuccess }: RescheduleDialogProps) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedTime, setSelectedTime] = useState("");
  const [isRescheduling, setIsRescheduling] = useState(false);

  const minDate = addDays(new Date(), 2);
  const maxDate = addDays(new Date(), 60);
  const timeSlots = generateTimeSlots(booking.service_duration || 2, booking.service_type);

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
      const { data, error } = await supabase.functions.invoke('reschedule-booking', {
        body: {
          bookingId: booking.id,
          newDate: format(selectedDate, 'yyyy-MM-dd'),
          newTimeSlot: selectedTime,
          oldDate: booking.service_date,
          oldTimeSlot: booking.time_slot,
        }
      });

      if (error) throw error;

      if (!data.success) {
        toast.error(data.message || "Failed to reschedule");
        return;
      }

      toast.success("Booking rescheduled successfully! Confirmation email sent.");
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('Reschedule error:', error);
      toast.error("Failed to reschedule booking");
    } finally {
      setIsRescheduling(false);
    }
  };

  const isWeekend = (date: Date) => {
    const day = date.getDay();
    return day === 0; // Only disable Sundays
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Reschedule Booking</DialogTitle>
          <DialogDescription className="sr-only">Choose a new date and time for your booking</DialogDescription>
        </DialogHeader>

        {/* Current Booking Summary */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <RiCalendarLine className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-sm text-muted-foreground">Current Appointment</p>
                  <p className="font-semibold">
                    {format(new Date(booking.service_date), 'MMMM d, yyyy')} at {booking.time_slot}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RiMapPinLine className="w-4 h-4" />
                {booking.city}, {booking.state}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-2">
          {/* Date Selection - Calendar Grid */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <RiCalendarLine className="w-4 h-4" />
              Select New Date
            </h3>
            <div className="border rounded-lg p-1">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={setSelectedDate}
                disabled={(date) => date < minDate || date > maxDate || isWeekend(date)}
                className={cn("p-3 pointer-events-auto")}
              />
            </div>
          </div>

          {/* Time Slot Selection - Vertical List */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <RiTimeLine className="w-4 h-4" />
              Select New Time
            </h3>
            {selectedDate ? (
              <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                {timeSlots.map((slot) => {
                  const isSelected = selectedTime === slot.id;
                  return (
                    <button
                      key={slot.id}
                      onClick={() => setSelectedTime(slot.id)}
                      className={cn(
                        "w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left",
                        isSelected
                          ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                          : "border-border hover:border-primary/40 hover:bg-muted/50"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-3 h-3 rounded-full border-2 transition-all",
                          isSelected ? "border-primary bg-primary" : "border-muted-foreground/40"
                        )} />
                        <span className="font-medium text-sm">{slot.label}</span>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {slot.estimatedDuration}h
                      </Badge>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center justify-center h-[320px] text-sm text-muted-foreground border rounded-lg bg-muted/30">
                Select a date to see available times
              </div>
            )}
          </div>
        </div>

        {/* Confirmation Summary */}
        {selectedDate && selectedTime && (
          <Card className="border-primary/30 bg-gradient-to-r from-primary/5 to-accent/5 animate-fade-in">
            <CardContent className="p-4">
              <div className="flex items-center justify-center gap-4 text-sm">
                <div className="text-center">
                  <p className="text-muted-foreground text-xs">From</p>
                  <p className="font-medium">{format(new Date(booking.service_date), 'MMM d')}</p>
                  <p className="text-xs text-muted-foreground">{booking.time_slot}</p>
                </div>
                <RiArrowRightLine className="w-5 h-5 text-primary" />
                <div className="text-center">
                  <p className="text-muted-foreground text-xs">To</p>
                  <p className="font-semibold text-primary">{format(selectedDate, 'MMM d')}</p>
                  <p className="text-xs text-primary">{selectedTime}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-3 justify-end pt-2 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isRescheduling}>
            Cancel
          </Button>
          <Button
            onClick={handleReschedule}
            disabled={!selectedDate || !selectedTime || isRescheduling}
          >
            {isRescheduling && <RiLoader4Line className="mr-2 w-4 h-4 animate-spin" />}
            Confirm Reschedule
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

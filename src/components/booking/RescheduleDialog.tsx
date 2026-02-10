"use client";

import { useState, useEffect } from "react";
import { format, addDays, parse } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock, Calendar, Loader2 } from "lucide-react";
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Reschedule Booking</DialogTitle>
          <DialogDescription>
            Current appointment: {format(new Date(booking.service_date), 'MMMM d, yyyy')} at {booking.time_slot}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Date Selection */}
          <div className="space-y-3">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              Select New Date
            </h3>
            <ScrollArea className="w-full whitespace-nowrap rounded-lg border">
              <div className="flex gap-3 p-4">
                {Array.from({ length: 30 }, (_, i) => {
                  const date = addDays(minDate, i);
                  const isSelected = selectedDate && format(date, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd');
                  
                  return (
                    <Card
                      key={i}
                      onClick={() => setSelectedDate(date)}
                      className={cn(
                        "flex-shrink-0 w-20 cursor-pointer transition-all duration-300 hover:scale-105 active:scale-95",
                        isSelected 
                          ? "bg-primary text-primary-foreground border-primary shadow-lg scale-110 ring-2 ring-primary/50" 
                          : "hover:border-primary/50"
                      )}
                    >
                      <CardContent className="p-3 text-center space-y-1">
                        <p className={cn(
                          "text-xs font-semibold uppercase tracking-wide",
                          isSelected ? "opacity-95" : "opacity-70"
                        )}>
                          {format(date, 'EEE')}
                        </p>
                        <p className="text-2xl font-bold">
                          {format(date, 'd')}
                        </p>
                        <p className={cn(
                          "text-xs font-medium",
                          isSelected ? "opacity-95" : "opacity-70"
                        )}>
                          {format(date, 'MMM')}
                        </p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {/* Time Slot Selection */}
          {selectedDate && (
            <div className="space-y-3 animate-fade-in">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Clock className="w-5 h-5" />
                Select New Time
              </h3>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
                {timeSlots.map((slot) => (
                  <Card
                    key={slot.id}
                    className={cn(
                      "cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-105 active:scale-95",
                      selectedTime === slot.id && "ring-2 ring-primary shadow-lg scale-105 bg-primary/5"
                    )}
                    onClick={() => setSelectedTime(slot.id)}
                  >
                    <CardContent className="p-4 text-center space-y-2">
                      <Clock className="mx-auto w-6 h-6 text-primary" />
                      <p className="font-semibold text-sm">{slot.label}</p>
                      <Badge variant="secondary" className="text-xs">
                        {slot.estimatedDuration}h
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-end pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isRescheduling}>
            Cancel
          </Button>
          <Button 
            onClick={handleReschedule} 
            disabled={!selectedDate || !selectedTime || isRescheduling}
          >
            {isRescheduling && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
            Confirm Reschedule
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar as CalendarIcon, Clock, ChevronRight, Loader2 } from "lucide-react";
import { format, addDays, isWeekend, isBefore, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { useAvailability } from "@/hooks/use-availability";

interface SchedulePickerProps {
  selectedDate?: Date;
  selectedTime?: string;
  onDateSelect: (date: Date) => void;
  onTimeSelect: (date: Date, timeSlot: string, startTime: string, endTime: string) => void;
  onContinue?: () => void;
  showContinue?: boolean;
  continueDisabled?: boolean;
  isProcessing?: boolean;
}

const TIME_SLOTS = [
  { id: "8:00 AM - 10:00 AM", label: "Morning", subLabel: "8:00 AM - 10:00 AM", startTime: "08:00", endTime: "10:00" },
  { id: "10:00 AM - 12:00 PM", label: "Late Morning", subLabel: "10:00 AM - 12:00 PM", startTime: "10:00", endTime: "12:00" },
  { id: "12:00 PM - 2:00 PM", label: "Afternoon", subLabel: "12:00 PM - 2:00 PM", startTime: "12:00", endTime: "14:00" },
  { id: "2:00 PM - 4:00 PM", label: "Late Afternoon", subLabel: "2:00 PM - 4:00 PM", startTime: "14:00", endTime: "16:00" },
  { id: "4:00 PM - 6:00 PM", label: "Evening", subLabel: "4:00 PM - 6:00 PM", startTime: "16:00", endTime: "18:00" },
];

export function SchedulePicker({
  selectedDate,
  selectedTime,
  onDateSelect,
  onTimeSelect,
  onContinue,
  showContinue = false,
  continueDisabled = false,
  isProcessing = false,
}: SchedulePickerProps) {
  const minDate = addDays(new Date(), 3);
  const endDate = addDays(new Date(), 60);

  const { availability, loading: isLoading } = useAvailability(minDate, endDate);

  // Group availability by date for quick lookup
  const availabilityByDate = useMemo(() => {
    const map: Record<string, Record<string, { available: boolean; capacity: number; booked: number }>> = {};
    availability.forEach((slot) => {
      if (!map[slot.service_date]) map[slot.service_date] = {};
      map[slot.service_date][slot.time_slot] = {
        available: slot.is_available ?? (slot.current_bookings < slot.max_capacity),
        capacity: slot.max_capacity,
        booked: slot.current_bookings,
      };
    });
    return map;
  }, [availability]);

  const selectedDateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : null;
  const slotsForSelectedDate = selectedDateStr ? availabilityByDate[selectedDateStr] || {} : {};

  const disabledDays = (date: Date) => {
    return isWeekend(date) || isBefore(startOfDay(date), startOfDay(minDate));
  };

  const getSlotStatus = (slotId: string) => {
    const slot = slotsForSelectedDate[slotId];
    if (!slot) return { available: true, label: "Available" };
    if (!slot.available) return { available: false, label: "Unavailable" };
    const remaining = slot.capacity - slot.booked;
    if (remaining <= 2) return { available: true, label: "Few left" };
    return { available: true, label: "Available" };
  };

  const isScheduleComplete = selectedDate && selectedTime;

  return (
    <Card className="border-primary/20 overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-primary/5 to-transparent pb-4">
        <CardTitle className="text-xl flex items-center gap-2">
          <CalendarIcon className="w-5 h-5 text-primary" />
          Pick Your Date & Time
        </CardTitle>
        <CardDescription>
          Select a convenient appointment slot (3+ days advance booking required)
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
          {/* Calendar Section */}
          <div className="p-4 md:p-6">
            <p className="text-sm font-medium text-muted-foreground mb-3">Select Date</p>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => date && onDateSelect(date)}
              disabled={disabledDays}
              fromDate={minDate}
              toDate={endDate}
              className="rounded-lg border p-3 pointer-events-auto"
              classNames={{
                day_selected: "bg-primary text-primary-foreground hover:bg-primary/90",
                day_today: "bg-accent text-accent-foreground font-bold",
              }}
            />
          </div>

          {/* Time Slots Section */}
          <div className="p-4 md:p-6">
            <p className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Select Time
            </p>
            
            {!selectedDate ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                Select a date first
              </div>
            ) : isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-lg" />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {TIME_SLOTS.map((slot) => {
                  const status = getSlotStatus(slot.id);
                  const isSelected = selectedTime === slot.id;
                  
                  return (
                    <button
                      key={slot.id}
                      onClick={() => {
                        if (status.available && selectedDate) {
                          onTimeSelect(selectedDate, slot.id, slot.startTime, slot.endTime);
                        }
                      }}
                      disabled={!status.available}
                      className={cn(
                        "w-full flex items-center justify-between p-3 rounded-lg border transition-all min-h-[56px]",
                        isSelected 
                          ? "border-primary bg-primary/10 ring-2 ring-primary/20" 
                          : "border-border hover:border-primary/50 hover:bg-muted/50",
                        !status.available && "opacity-50 cursor-not-allowed bg-muted/30"
                      )}
                    >
                      <div className="text-left">
                        <p className={cn(
                          "font-medium",
                          isSelected && "text-primary"
                        )}>
                          {slot.label}
                        </p>
                        <p className="text-xs text-muted-foreground">{slot.subLabel}</p>
                      </div>
                      {status.label === "Few left" && status.available && (
                        <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">
                          Few left
                        </Badge>
                      )}
                      {!status.available && (
                        <Badge variant="secondary" className="text-xs">Booked</Badge>
                      )}
                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                          <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Selection Summary & Continue */}
        {showContinue && (
          <div className="border-t bg-muted/30 p-4 md:p-6">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="text-center md:text-left">
                {isScheduleComplete ? (
                  <div className="flex items-center gap-3 text-sm">
                    <Badge className="bg-primary/10 text-primary border-0">
                      <CalendarIcon className="w-3 h-3 mr-1" />
                      {format(selectedDate!, "EEE, MMM d")}
                    </Badge>
                    <Badge className="bg-primary/10 text-primary border-0">
                      <Clock className="w-3 h-3 mr-1" />
                      {selectedTime}
                    </Badge>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {selectedDate ? "Now select a time slot" : "Select a date and time to continue"}
                  </p>
                )}
              </div>
              <Button
                size="lg"
                className="w-full md:w-auto bg-gradient-primary font-semibold min-w-[200px]"
                onClick={onContinue}
                disabled={!isScheduleComplete || continueDisabled || isProcessing}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    Continue to Checkout
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, addDays, isWeekend, isBefore, startOfDay } from "date-fns";
import { useAvailability } from "@/hooks/use-availability";

interface AvailabilityCalendarProps {
  onSelectSlot: (date: Date, timeSlot: string, startTime: string, endTime: string) => void;
  selectedDate?: Date;
  selectedTime?: string;
  minDate?: Date;
  onDateSelect?: (date: Date) => void;
}

export function AvailabilityCalendar({ 
  onSelectSlot, 
  selectedDate, 
  selectedTime,
  minDate = addDays(new Date(), 3),
  onDateSelect
}: AvailabilityCalendarProps) {
  const endDate = addDays(minDate, 60);
  const { availability, loading } = useAvailability(minDate, endDate);

  // Group availability by date
  const availabilityByDate = availability.reduce((acc, slot) => {
    if (!acc[slot.service_date]) {
      acc[slot.service_date] = [];
    }
    acc[slot.service_date].push(slot);
    return acc;
  }, {} as Record<string, typeof availability>);

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return;
    console.log('Calendar clicked date:', format(date, 'yyyy-MM-dd EEEE'));
    onDateSelect?.(date);
  };

  const handleTimeClick = (slot: typeof availability[0]) => {
    if (!selectedDate || !slot.is_available) return;
    console.log('Time slot clicked:', slot.time_slot, 'for date:', format(selectedDate, 'yyyy-MM-dd'));
    onSelectSlot(selectedDate, slot.time_slot, slot.start_time, slot.end_time);
  };

  const getCapacityColor = (slot: typeof availability[0]) => {
    if (slot.blocked_by_google) return "text-muted-foreground";
    if (!slot.is_available) return "text-muted-foreground";
    const percentage = (slot.max_capacity - slot.current_bookings) / slot.max_capacity;
    if (percentage > 0.5) return "text-success";
    if (percentage > 0.25) return "text-warning";
    return "text-destructive";
  };

  const getCapacityBadge = (slot: typeof availability[0]) => {
    if (slot.blocked_by_google) return "Calendar Block";
    if (!slot.is_available) return "Sold Out";
    const remaining = slot.max_capacity - slot.current_bookings;
    if (remaining > 3) return null;
    return `Only ${remaining} left`;
  };

  // Disable weekends and dates before minDate
  const disabledDays = (date: Date) => {
    return isWeekend(date) || isBefore(date, startOfDay(minDate));
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[300px] w-full" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  const dateString = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '';
  const daySlots = dateString ? (availabilityByDate[dateString] || []) : [];

  return (
    <div className="space-y-6">
      {/* Date Selection using shadcn Calendar */}
      <div className="space-y-3">
        <h3 className="text-base md:text-lg font-semibold">Select Date</h3>
        
        <Card className="border-2 border-border/50">
          <CardContent className="p-4 flex justify-center">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleDateSelect}
              disabled={disabledDays}
              fromDate={minDate}
              toDate={endDate}
              className="pointer-events-auto"
              classNames={{
                day_selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
                day_today: "bg-accent text-accent-foreground",
              }}
            />
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>We're closed on weekends. Book at least 3 days in advance.</span>
        </p>
      </div>

      {/* Selected Date Display */}
      {selectedDate && (
        <div className="p-3 bg-primary/10 rounded-lg border border-primary/20">
          <p className="text-sm font-medium text-primary flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            {format(selectedDate, 'EEEE, MMMM d, yyyy')}
          </p>
        </div>
      )}

      {/* Time Selection */}
      <div className="space-y-3">
        <h3 className="text-base md:text-lg font-semibold">Select Time</h3>
        
        <Card className="border-2 border-border/50 shadow-md">
          <CardContent className="p-4">
            {selectedDate ? (
              daySlots.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {daySlots.map((slot) => {
                    const isSelected = selectedTime === slot.time_slot;
                    const capacityBadge = getCapacityBadge(slot);
                    const capacityColor = getCapacityColor(slot);
                    const remaining = slot.max_capacity - slot.current_bookings;

                    return (
                      <button
                        key={slot.id}
                        type="button"
                        onClick={() => handleTimeClick(slot)}
                        disabled={!slot.is_available}
                        className={cn(
                          "p-4 rounded-lg border-2 text-left",
                          "min-h-[72px] flex items-center justify-between",
                          "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
                          "transition-colors",
                          slot.is_available && !isSelected && "hover:border-primary/50 hover:bg-accent/30 cursor-pointer",
                          isSelected
                            ? "bg-primary text-primary-foreground border-primary shadow-md"
                            : slot.is_available
                            ? "border-border/60 bg-background"
                            : "border-border/30 bg-muted/30 opacity-60 cursor-not-allowed"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <Clock className={cn("w-5 h-5", isSelected ? "text-primary-foreground" : "text-muted-foreground")} />
                          <div>
                            <p className={cn("font-semibold text-sm md:text-base", isSelected && "text-primary-foreground")}>
                              {slot.time_slot}
                            </p>
                            <p className={cn("text-xs mt-0.5", isSelected ? "text-primary-foreground/80" : capacityColor)}>
                              {slot.is_available 
                                ? `${remaining}/${slot.max_capacity} spots`
                                : 'Sold out'
                              }
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {isSelected && (
                            <CheckCircle2 className="w-5 h-5 text-primary-foreground" />
                          )}
                          {!slot.is_available && (
                            <Badge variant="destructive" className="text-xs">Sold Out</Badge>
                          )}
                          {capacityBadge && slot.is_available && !isSelected && (
                            <Badge variant="outline" className={cn("text-xs", capacityColor)}>
                              {capacityBadge}
                            </Badge>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <AlertCircle className="w-10 h-10 mb-3 opacity-50" />
                  <p className="text-sm text-center">No time slots available for this date</p>
                  <p className="text-xs text-center mt-1">Please select a different date</p>
                </div>
              )
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Clock className="w-10 h-10 mb-3 opacity-50" />
                <p className="text-sm text-center">Select a date above to view available times</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

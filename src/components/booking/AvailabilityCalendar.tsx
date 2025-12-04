import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, addDays, isWeekend as checkIsWeekend, isBefore, startOfDay } from "date-fns";
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
  const [internalSelectedDate, setInternalSelectedDate] = useState<Date | undefined>(selectedDate);
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

  // Disable dates: weekends, past dates, and dates before minDate
  const isDateDisabled = (date: Date) => {
    const today = startOfDay(new Date());
    const minDateStart = startOfDay(minDate);
    
    // Disable weekends
    if (checkIsWeekend(date)) return true;
    
    // Disable dates before minDate (3-day advance)
    if (isBefore(date, minDateStart)) return true;
    
    // Check if date is fully booked
    const dateString = format(date, 'yyyy-MM-dd');
    const daySlots = availabilityByDate[dateString] || [];
    if (daySlots.length > 0 && !daySlots.some(s => s.is_available)) return true;
    
    return false;
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (date && !isDateDisabled(date)) {
      setInternalSelectedDate(date);
      onDateSelect?.(date);
    }
  };

  const handleTimeSelect = (timeSlotId: string) => {
    const dateToUse = selectedDate || internalSelectedDate;
    if (!dateToUse) return;
    
    const dateString = format(dateToUse, 'yyyy-MM-dd');
    const daySlots = availabilityByDate[dateString] || [];
    const slot = daySlots.find(s => s.id === timeSlotId);
    
    if (slot && slot.is_available) {
      onSelectSlot(dateToUse, slot.time_slot, slot.start_time, slot.end_time);
    }
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

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  const currentSelectedDate = selectedDate || internalSelectedDate;
  const dateString = currentSelectedDate ? format(currentSelectedDate, 'yyyy-MM-dd') : '';
  const daySlots = dateString ? (availabilityByDate[dateString] || []) : [];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
      {/* Date Selection - Native Calendar */}
      <div className="space-y-4">
        <div>
          <h3 className="text-base md:text-lg font-semibold" id="date-selection-label">
            Select Date
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Choose your preferred service day
          </p>
        </div>
        
        <Card className="border-2 border-border/50 shadow-md">
          <CardContent className="p-3 md:p-4">
            <Calendar
              mode="single"
              selected={currentSelectedDate}
              onSelect={handleDateSelect}
              disabled={isDateDisabled}
              fromDate={minDate}
              toDate={endDate}
              className="rounded-md border-0 pointer-events-auto w-full"
              classNames={{
                months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
                month: "space-y-4 w-full",
                caption: "flex justify-center pt-1 relative items-center",
                caption_label: "text-sm font-medium",
                nav: "space-x-1 flex items-center",
                nav_button: "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 border border-input rounded-md",
                nav_button_previous: "absolute left-1",
                nav_button_next: "absolute right-1",
                table: "w-full border-collapse space-y-1",
                head_row: "flex w-full",
                head_cell: "text-muted-foreground rounded-md w-full font-normal text-[0.8rem] flex-1 text-center",
                row: "flex w-full mt-2",
                cell: "flex-1 text-center text-sm p-0 relative focus-within:relative focus-within:z-20",
                day: "h-10 w-full p-0 font-normal aria-selected:opacity-100 hover:bg-accent hover:text-accent-foreground rounded-md transition-colors cursor-pointer",
                day_selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
                day_today: "bg-accent text-accent-foreground",
                day_outside: "text-muted-foreground opacity-50",
                day_disabled: "text-muted-foreground opacity-50 cursor-not-allowed hover:bg-transparent",
                day_hidden: "invisible",
              }}
            />
            
            <div className="mt-3 md:mt-4 pt-3 md:pt-4 border-t border-border/50">
              <p className="text-xs text-muted-foreground flex items-center gap-2" role="note">
                <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                <span>We're closed on weekends. Book at least 3 days in advance.</span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Time Selection - Radio Group */}
      <div className="space-y-4">
        <div>
          <h3 className="text-base md:text-lg font-semibold" id="time-selection-label">
            Select Time
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Pick a convenient time window
          </p>
        </div>
        
        <Card className="border-2 border-border/50 shadow-md">
          <CardContent className="p-3 md:p-4">
            {currentSelectedDate ? (
              daySlots.length > 0 ? (
                <RadioGroup
                  value={daySlots.find(s => s.time_slot === selectedTime)?.id || ""}
                  onValueChange={handleTimeSelect}
                  className="space-y-3"
                >
                  {daySlots.map((slot) => {
                    const isSelected = selectedTime === slot.time_slot;
                    const capacityBadge = getCapacityBadge(slot);
                    const capacityColor = getCapacityColor(slot);
                    const remaining = slot.max_capacity - slot.current_bookings;

                    return (
                      <div key={slot.id} className="relative">
                        <Label
                          htmlFor={slot.id}
                          className={cn(
                            "flex items-center justify-between w-full p-4 rounded-lg border-2 transition-all duration-200 cursor-pointer min-h-[68px]",
                            slot.is_available && "hover:border-primary/50 hover:shadow-md",
                            isSelected
                              ? "bg-primary text-primary-foreground border-primary shadow-md"
                              : slot.is_available
                              ? "border-border/60 bg-background hover:bg-accent/30"
                              : "border-border/30 bg-muted/30 opacity-60 cursor-not-allowed"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <RadioGroupItem
                              value={slot.id}
                              id={slot.id}
                              disabled={!slot.is_available}
                              className={cn(
                                "border-2",
                                isSelected ? "border-primary-foreground text-primary-foreground" : ""
                              )}
                            />
                            <Clock className={cn("w-5 h-5", isSelected && "text-primary-foreground")} />
                            <div>
                              <p className={cn("font-semibold text-sm md:text-base", isSelected && "text-primary-foreground")}>
                                {slot.time_slot}
                              </p>
                              <p className={cn("text-xs mt-0.5", isSelected ? "text-primary-foreground/80" : capacityColor)}>
                                {slot.is_available 
                                  ? `${remaining}/${slot.max_capacity} spots available`
                                  : 'Sold out'
                                }
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            {isSelected && (
                              <CheckCircle2 className="w-5 h-5 text-primary-foreground" aria-hidden="true" />
                            )}
                            {!slot.is_available && (
                              <Badge variant="destructive" className="text-xs">Sold Out</Badge>
                            )}
                            {capacityBadge && slot.is_available && (
                              <Badge variant="outline" className={cn("text-xs", capacityColor)}>
                                {capacityBadge}
                              </Badge>
                            )}
                          </div>
                        </Label>
                      </div>
                    );
                  })}
                </RadioGroup>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <AlertCircle className="w-12 h-12 mb-3 opacity-50" />
                  <p className="text-sm text-center">No time slots available for this date</p>
                  <p className="text-xs text-center mt-1">Please select a different date</p>
                </div>
              )
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Clock className="w-12 h-12 mb-3 opacity-50" />
                <p className="text-sm text-center">Select a date to view available times</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

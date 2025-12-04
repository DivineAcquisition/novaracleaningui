import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, addDays, isWeekend as checkIsWeekend, isBefore, startOfDay, parseISO } from "date-fns";
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

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (!value) return;
    
    // Parse the date string (yyyy-MM-dd format from input)
    const date = parseISO(value);
    
    // Validate: not a weekend
    if (checkIsWeekend(date)) {
      return;
    }
    
    // Validate: not before minDate
    if (isBefore(date, startOfDay(minDate))) {
      return;
    }
    
    setInternalSelectedDate(date);
    onDateSelect?.(date);
  };

  const handleTimeClick = (slot: typeof availability[0]) => {
    const dateToUse = selectedDate || internalSelectedDate;
    if (!dateToUse || !slot.is_available) return;
    
    onSelectSlot(dateToUse, slot.time_slot, slot.start_time, slot.end_time);
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
          <Skeleton className="h-48" />
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
      {/* Date Selection - Native HTML Input */}
      <div className="space-y-4">
        <div>
          <h3 className="text-base md:text-lg font-semibold">
            Select Date
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Choose your preferred service day
          </p>
        </div>
        
        <Card className="border-2 border-border/50 shadow-md">
          <CardContent className="p-4 md:p-6">
            <label htmlFor="service-date" className="block text-sm font-medium text-foreground mb-2">
              Service Date
            </label>
            <input
              type="date"
              id="service-date"
              min={format(minDate, 'yyyy-MM-dd')}
              max={format(endDate, 'yyyy-MM-dd')}
              value={currentSelectedDate ? format(currentSelectedDate, 'yyyy-MM-dd') : ''}
              onChange={handleDateChange}
              className={cn(
                "w-full p-4 text-base md:text-lg font-medium",
                "border-2 border-input rounded-lg",
                "bg-background text-foreground",
                "focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary",
                "cursor-pointer",
                currentSelectedDate && "border-primary bg-primary/5"
              )}
            />
            
            {currentSelectedDate && (
              <div className="mt-4 p-3 bg-primary/10 rounded-lg border border-primary/20">
                <p className="text-sm font-medium text-primary flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  {format(currentSelectedDate, 'EEEE, MMMM d, yyyy')}
                </p>
              </div>
            )}
            
            <div className="mt-4 pt-4 border-t border-border/50">
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>We're closed on weekends. Book at least 3 days in advance.</span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Time Selection - Plain Buttons */}
      <div className="space-y-4">
        <div>
          <h3 className="text-base md:text-lg font-semibold">
            Select Time
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Pick a convenient time window
          </p>
        </div>
        
        <Card className="border-2 border-border/50 shadow-md">
          <CardContent className="p-4 md:p-6">
            {currentSelectedDate ? (
              daySlots.length > 0 ? (
                <div className="space-y-3">
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
                          "w-full p-4 rounded-lg border-2 text-left transition-colors duration-150",
                          "min-h-[72px] flex items-center justify-between",
                          "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
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
                                ? `${remaining}/${slot.max_capacity} spots available`
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

import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, AlertCircle, Clock, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, addDays, isWeekend as checkIsWeekend, isBefore, startOfDay, startOfWeek, addWeeks, isSameDay } from "date-fns";
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
  const [selectedWeekIndex, setSelectedWeekIndex] = useState(0);
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

  // Generate weeks of available dates (weekdays only)
  const weeks = useMemo(() => {
    const result: Date[][] = [];
    let currentWeekStart = startOfWeek(minDate, { weekStartsOn: 1 }); // Start on Monday
    
    for (let w = 0; w < 9; w++) { // 9 weeks to cover ~60 days
      const weekDays: Date[] = [];
      
      for (let d = 0; d < 5; d++) { // Mon-Fri only
        const day = addDays(currentWeekStart, d);
        // Only include if it's on or after minDate and before endDate
        if (!isBefore(day, startOfDay(minDate)) && isBefore(day, endDate)) {
          weekDays.push(day);
        }
      }
      
      if (weekDays.length > 0) {
        result.push(weekDays);
      }
      
      currentWeekStart = addWeeks(currentWeekStart, 1);
    }
    
    return result;
  }, [minDate, endDate]);

  // Get availability info for a date
  const getDateAvailability = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const slots = availabilityByDate[dateStr] || [];
    const availableSlots = slots.filter(s => s.is_available);
    return {
      hasSlots: slots.length > 0,
      availableCount: availableSlots.length,
      totalCount: slots.length
    };
  };

  const handleDateSelect = (date: Date) => {
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
        <div className="grid grid-cols-5 gap-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-48" />
      </div>
    );
  }

  const currentSelectedDate = selectedDate || internalSelectedDate;
  const dateString = currentSelectedDate ? format(currentSelectedDate, 'yyyy-MM-dd') : '';
  const daySlots = dateString ? (availabilityByDate[dateString] || []) : [];
  const currentWeek = weeks[selectedWeekIndex] || [];

  return (
    <div className="space-y-6">
      {/* Week Tabs */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base md:text-lg font-semibold">Select Date</h3>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSelectedWeekIndex(Math.max(0, selectedWeekIndex - 1))}
              disabled={selectedWeekIndex === 0}
              className={cn(
                "p-2 rounded-lg border border-border/60 bg-background",
                "focus:outline-none focus:ring-2 focus:ring-primary",
                "disabled:opacity-40 disabled:cursor-not-allowed",
                "hover:bg-accent/50 transition-colors"
              )}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setSelectedWeekIndex(Math.min(weeks.length - 1, selectedWeekIndex + 1))}
              disabled={selectedWeekIndex >= weeks.length - 1}
              className={cn(
                "p-2 rounded-lg border border-border/60 bg-background",
                "focus:outline-none focus:ring-2 focus:ring-primary",
                "disabled:opacity-40 disabled:cursor-not-allowed",
                "hover:bg-accent/50 transition-colors"
              )}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Week Selector Tabs */}
        <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
          {weeks.slice(0, 6).map((week, index) => {
            const weekStart = week[0];
            const weekEnd = week[week.length - 1];
            const isSelected = selectedWeekIndex === index;
            
            return (
              <button
                key={index}
                type="button"
                onClick={() => setSelectedWeekIndex(index)}
                className={cn(
                  "px-3 py-2 rounded-lg border-2 text-xs md:text-sm font-medium whitespace-nowrap",
                  "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1",
                  "transition-colors min-w-[80px]",
                  isSelected
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border/60 hover:border-primary/50 hover:bg-accent/30"
                )}
              >
                <span className="block">{format(weekStart, 'MMM d')}</span>
                <span className="block text-[10px] opacity-70">
                  - {format(weekEnd, 'MMM d')}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Day Cards for Selected Week */}
      <div className="grid grid-cols-5 gap-2">
        {currentWeek.map((day) => {
          const isSelected = currentSelectedDate && isSameDay(day, currentSelectedDate);
          const dayAvail = getDateAvailability(day);
          const isDisabled = isBefore(day, startOfDay(minDate));
          
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => !isDisabled && handleDateSelect(day)}
              disabled={isDisabled}
              className={cn(
                "p-2 md:p-3 rounded-lg border-2 text-center",
                "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1",
                "transition-colors min-h-[80px] md:min-h-[100px] flex flex-col justify-center",
                isSelected
                  ? "bg-primary text-primary-foreground border-primary shadow-md"
                  : isDisabled
                  ? "bg-muted/30 border-border/30 opacity-50 cursor-not-allowed"
                  : "bg-background border-border/60 hover:border-primary/50 hover:bg-accent/30 cursor-pointer"
              )}
            >
              <span className={cn(
                "text-[10px] md:text-xs uppercase font-medium",
                isSelected ? "text-primary-foreground/80" : "text-muted-foreground"
              )}>
                {format(day, 'EEE')}
              </span>
              <span className={cn(
                "text-lg md:text-2xl font-bold",
                isSelected ? "text-primary-foreground" : "text-foreground"
              )}>
                {format(day, 'd')}
              </span>
              <span className={cn(
                "text-[10px] md:text-xs",
                isSelected 
                  ? "text-primary-foreground/80" 
                  : dayAvail.availableCount > 0 
                  ? "text-success" 
                  : "text-muted-foreground"
              )}>
                {dayAvail.availableCount > 0 
                  ? `${dayAvail.availableCount} slots`
                  : 'No slots'
                }
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected Date Display */}
      {currentSelectedDate && (
        <div className="p-3 bg-primary/10 rounded-lg border border-primary/20">
          <p className="text-sm font-medium text-primary flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            {format(currentSelectedDate, 'EEEE, MMMM d, yyyy')}
          </p>
        </div>
      )}

      {/* Time Selection */}
      <div className="space-y-3">
        <h3 className="text-base md:text-lg font-semibold">Select Time</h3>
        
        <Card className="border-2 border-border/50 shadow-md">
          <CardContent className="p-4">
            {currentSelectedDate ? (
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

        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>We're closed on weekends. Book at least 3 days in advance.</span>
        </p>
      </div>
    </div>
  );
}

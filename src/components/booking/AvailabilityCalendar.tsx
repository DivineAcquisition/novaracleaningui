import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, addDays, isWeekend as checkIsWeekend } from "date-fns";
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
  const endDate = addDays(minDate, 30);
  const { availability, loading, syncing, lastSyncTime } = useAvailability(minDate, endDate);
  const [hoveredSlot, setHoveredSlot] = useState<string | null>(null);

  // Group availability by date
  const availabilityByDate = availability.reduce((acc, slot) => {
    if (!acc[slot.service_date]) {
      acc[slot.service_date] = [];
    }
    acc[slot.service_date].push(slot);
    return acc;
  }, {} as Record<string, typeof availability>);

  const dates = Array.from({ length: 30 }, (_, i) => {
    const date = addDays(minDate, i);
    return checkIsWeekend(date) ? null : date;
  }).filter(Boolean) as Date[];

  const getCapacityColor = (slot: typeof availability[0]) => {
    if (slot.blocked_by_google) return "text-muted-foreground";
    if (!slot.is_available) return "text-muted-foreground";
    const percentage = (slot.max_capacity - slot.current_bookings) / slot.max_capacity;
    if (percentage > 0.5) return "text-success";
    if (percentage > 0.25) return "text-warning";
    return "text-destructive";
  };

  const getCapacityBadge = (slot: typeof availability[0]) => {
    if (slot.blocked_by_google) return "🔒 Calendar Block";
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 animate-slide-in-from-right">
      {/* Date Selection */}
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
            <ScrollArea className="h-[320px] md:h-[400px] pr-2 md:pr-4">
              <div className="space-y-2" role="radiogroup" aria-labelledby="date-selection-label">
                {dates.map((date) => {
                  const dateString = format(date, 'yyyy-MM-dd');
                  const isSelected = selectedDate && format(selectedDate, 'yyyy-MM-dd') === dateString;
                  const daySlots = availabilityByDate[dateString] || [];
                  const hasAvailability = daySlots.length === 0 || daySlots.some(s => s.is_available);
                  
                  return (
                    <button
                      key={dateString}
                      onClick={() => {
                        if (hasAvailability) {
                          setInternalSelectedDate(date);
                          onDateSelect?.(date);
                        }
                      }}
                      disabled={!hasAvailability}
                      role="radio"
                      aria-checked={isSelected}
                      aria-label={`${format(date, 'EEEE, MMMM d, yyyy')} - ${hasAvailability ? 'Available' : 'Fully booked'}`}
                      className={cn(
                        "w-full p-3 md:p-4 rounded-lg border-2 transition-all duration-200 text-left touch-manipulation",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        hasAvailability && "hover:border-primary/40 hover:shadow-md active:scale-[0.98]",
                        isSelected 
                          ? "bg-primary text-primary-foreground border-primary shadow-md" 
                          : hasAvailability
                          ? "border-border/60 bg-background hover:bg-accent/30"
                          : "border-border/30 bg-muted/30 opacity-60 cursor-not-allowed"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 md:gap-4">
                          <div className={cn("text-center min-w-[44px] md:min-w-[48px]", isSelected && "text-primary-foreground")}>
                            <p className="text-xs font-medium uppercase tracking-wide opacity-80">
                              {format(date, 'EEE')}
                            </p>
                            <p className="text-xl md:text-2xl font-bold leading-none mt-1">
                              {format(date, 'd')}
                            </p>
                          </div>
                          <div>
                            <p className={cn("font-semibold text-sm md:text-base", isSelected && "text-primary-foreground")}>
                              {format(date, 'MMMM d, yyyy')}
                            </p>
                            <p className={cn("text-xs md:text-sm mt-0.5", isSelected ? "text-primary-foreground/80" : "text-muted-foreground")}>
                              {hasAvailability ? `${daySlots.filter(s => s.is_available).length} slots available` : 'Fully booked'}
                            </p>
                          </div>
                        </div>
                        {!hasAvailability && (
                          <Badge variant="destructive" className="text-xs">Sold Out</Badge>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
            
            <div className="mt-3 md:mt-4 pt-3 md:pt-4 border-t border-border/50">
              <p className="text-xs text-muted-foreground flex items-center gap-2" role="note">
                <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                <span>We're closed on weekends. Book at least 3 days in advance.</span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Time Selection */}
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
            <ScrollArea className="h-[320px] md:h-[400px] pr-2 md:pr-4">
              <div className="space-y-2" role="radiogroup" aria-labelledby="time-selection-label">
                {(selectedDate || internalSelectedDate) ? (
                  (() => {
                    const dateToShow = selectedDate || internalSelectedDate;
                    if (!dateToShow) return null;
                    const dateString = format(dateToShow, 'yyyy-MM-dd');
                    const daySlots = availabilityByDate[dateString] || [];
                    
                    // Use actual database slots
                    const slotsToDisplay = daySlots;

                    return slotsToDisplay.map((slot) => {
                      const isSelected = selectedTime === slot.time_slot;
                      const capacityBadge = getCapacityBadge(slot);
                      const capacityColor = getCapacityColor(slot);
                      const isHovered = hoveredSlot === slot.id;

                      return (
                        <button
                          key={slot.id}
                          onClick={() => {
                            const dateToUse = selectedDate || internalSelectedDate;
                            if (slot.is_available && dateToUse) {
                              onSelectSlot(dateToUse, slot.time_slot, slot.start_time, slot.end_time);
                            }
                          }}
                          onMouseEnter={() => setHoveredSlot(slot.id)}
                          onMouseLeave={() => setHoveredSlot(null)}
                          disabled={!slot.is_available}
                          role="radio"
                          aria-checked={isSelected}
                          aria-label={`${slot.time_slot} - ${slot.is_available ? `${slot.max_capacity - slot.current_bookings} spots available` : 'Sold out'}`}
                          className={cn(
                            "w-full p-4 rounded-lg border-2 transition-all duration-200 text-left touch-manipulation",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            slot.is_available && "hover:border-primary/40 hover:shadow-md active:scale-[0.98]",
                            isSelected
                              ? "bg-primary text-primary-foreground border-primary shadow-md"
                              : slot.is_available
                              ? "border-border/60 bg-background hover:bg-accent/30"
                              : "border-border/30 bg-muted/30 opacity-60 cursor-not-allowed"
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <Clock className={cn("w-5 h-5", isSelected && "text-primary-foreground")} />
                              <div>
                                <p className={cn("font-semibold text-sm md:text-base", isSelected && "text-primary-foreground")}>
                                  {slot.time_slot}
                                </p>
                                <p className={cn("text-xs mt-0.5", isSelected ? "text-primary-foreground/80" : capacityColor)}>
                                  {slot.is_available 
                                    ? `${slot.max_capacity - slot.current_bookings}/${slot.max_capacity} spots available`
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
                          </div>
                        </button>
                      );
                    });
                  })()
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Clock className="w-12 h-12 mb-3 opacity-50" />
                    <p className="text-sm text-center">Select a date to view available times</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

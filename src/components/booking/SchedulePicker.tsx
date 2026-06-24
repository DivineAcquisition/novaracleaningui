import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar as CalendarIcon, Clock, ChevronRight, ChevronLeft, Loader2, Sun, Sunset, Moon } from "lucide-react";
import { format, addDays, isWeekend, isBefore, startOfDay, addMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, getDay } from "date-fns";
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

// Extended time windows - more granular slots
const TIME_SLOTS = [
  // Morning slots
  { id: "8:00 AM - 9:00 AM", label: "8:00 AM", period: "morning", startTime: "08:00", endTime: "09:00" },
  { id: "9:00 AM - 10:00 AM", label: "9:00 AM", period: "morning", startTime: "09:00", endTime: "10:00" },
  { id: "10:00 AM - 11:00 AM", label: "10:00 AM", period: "morning", startTime: "10:00", endTime: "11:00" },
  { id: "11:00 AM - 12:00 PM", label: "11:00 AM", period: "morning", startTime: "11:00", endTime: "12:00" },
  // Afternoon slots
  { id: "12:00 PM - 1:00 PM", label: "12:00 PM", period: "afternoon", startTime: "12:00", endTime: "13:00" },
  { id: "1:00 PM - 2:00 PM", label: "1:00 PM", period: "afternoon", startTime: "13:00", endTime: "14:00" },
  { id: "2:00 PM - 3:00 PM", label: "2:00 PM", period: "afternoon", startTime: "14:00", endTime: "15:00" },
  { id: "3:00 PM - 4:00 PM", label: "3:00 PM", period: "afternoon", startTime: "15:00", endTime: "16:00" },
  // Evening slots
  { id: "4:00 PM - 5:00 PM", label: "4:00 PM", period: "evening", startTime: "16:00", endTime: "17:00" },
  { id: "5:00 PM - 6:00 PM", label: "5:00 PM", period: "evening", startTime: "17:00", endTime: "18:00" },
];

const PERIOD_CONFIG = {
  morning: { label: "Morning", icon: Sun, color: "text-amber-500" },
  afternoon: { label: "Afternoon", icon: Sunset, color: "text-orange-500" },
  evening: { label: "Evening", icon: Moon, color: "text-indigo-500" },
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(minDate));

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

  const isDateDisabled = (date: Date) => {
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

  // Generate calendar days for current month view
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
    
    // Add padding days for the start of the week
    const startPadding = getDay(monthStart);
    const paddingDays = Array(startPadding).fill(null);
    
    return [...paddingDays, ...days];
  }, [currentMonth]);

  const goToPreviousMonth = () => {
    const prevMonth = addMonths(currentMonth, -1);
    if (!isBefore(endOfMonth(prevMonth), minDate)) {
      setCurrentMonth(prevMonth);
    }
  };

  const goToNextMonth = () => {
    const nextMonth = addMonths(currentMonth, 1);
    if (isBefore(startOfMonth(nextMonth), endDate)) {
      setCurrentMonth(nextMonth);
    }
  };

  // Group time slots by period
  const slotsByPeriod = useMemo(() => {
    return TIME_SLOTS.reduce((acc, slot) => {
      if (!acc[slot.period]) acc[slot.period] = [];
      acc[slot.period].push(slot);
      return acc;
    }, {} as Record<string, typeof TIME_SLOTS>);
  }, []);

  return (
    <Card className="border-primary/20 overflow-hidden shadow-lg">
      <CardHeader className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent pb-4">
        <CardTitle className="text-xl flex items-center gap-2">
          <CalendarIcon className="w-5 h-5 text-primary" />
          Pick Your Date & Time
        </CardTitle>
        <CardDescription>
          Select a convenient appointment slot (3+ days advance booking required)
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {/* Step 1: Date Selection - Horizontal scroll card layout */}
        <div className="p-4 md:p-6 border-b">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">1</span>
              Select Date
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={goToPreviousMonth}
                disabled={isBefore(endOfMonth(addMonths(currentMonth, -1)), minDate)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium min-w-[120px] text-center">
                {format(currentMonth, "MMMM yyyy")}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={goToNextMonth}
                disabled={!isBefore(startOfMonth(addMonths(currentMonth, 1)), endDate)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {WEEKDAYS.map((day) => (
              <div key={day} className="text-center text-xs font-medium text-muted-foreground py-1">
                {day}
              </div>
            ))}
          </div>
          
          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, idx) => {
              if (!day) {
                return <div key={`padding-${idx}`} className="aspect-square" />;
              }
              
              const disabled = isDateDisabled(day);
              const isSelected = selectedDate && isSameDay(day, selectedDate);
              const isToday = isSameDay(day, new Date());
              const isCurrentMonth = isSameMonth(day, currentMonth);
              
              return (
                <button
                  key={day.toISOString()}
                  onClick={() => !disabled && onDateSelect(day)}
                  disabled={disabled}
                  className={cn(
                    "aspect-square rounded-lg flex flex-col items-center justify-center text-sm font-medium transition-all relative",
                    "hover:bg-primary/10 focus:outline-none focus:ring-2 focus:ring-primary/50",
                    disabled && "opacity-30 cursor-not-allowed hover:bg-transparent",
                    !isCurrentMonth && "opacity-50",
                    isSelected && "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md",
                    isToday && !isSelected && "ring-2 ring-primary/30 font-bold",
                    !disabled && !isSelected && "hover:scale-105"
                  )}
                >
                  <span>{format(day, "d")}</span>
                  {isToday && !isSelected && (
                    <span className="absolute bottom-1 w-1 h-1 rounded-full bg-primary" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 2: Time Selection */}
        <div className="p-4 md:p-6">
          <p className="text-sm font-semibold flex items-center gap-2 mb-4">
            <span className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors",
              selectedDate ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            )}>2</span>
            Select Time
          </p>
          
          {!selectedDate ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Clock className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">Select a date first to see available times</p>
            </div>
          ) : isLoading ? (
            <div className="space-y-4">
              {["morning", "afternoon", "evening"].map((period) => (
                <div key={period} className="space-y-2">
                  <Skeleton className="h-5 w-20" />
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 3, 4].map((i) => (
                      <Skeleton key={i} className="h-12 rounded-lg" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {(["morning", "afternoon", "evening"] as const).map((period) => {
                const config = PERIOD_CONFIG[period];
                const Icon = config.icon;
                const slots = slotsByPeriod[period] || [];
                
                return (
                  <div key={period} className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <Icon className={cn("w-4 h-4", config.color)} />
                      {config.label}
                    </div>
                    <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                      {slots.map((slot) => {
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
                              "relative py-2.5 px-2 rounded-lg border text-sm font-medium transition-all",
                              "hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/50",
                              isSelected 
                                ? "border-primary bg-primary text-primary-foreground shadow-md" 
                                : "border-border hover:bg-muted/50",
                              !status.available && "opacity-40 cursor-not-allowed bg-muted/30 hover:bg-muted/30",
                              !isSelected && status.available && "hover:scale-105"
                            )}
                          >
                            {slot.label}
                            {status.label === "Few left" && status.available && !isSelected && (
                              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Selection Summary & Continue */}
        {showContinue && (
          <div className="border-t bg-gradient-to-r from-muted/50 to-muted/30 p-4 md:p-6">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="text-center md:text-left">
                {isScheduleComplete ? (
                  <div className="flex items-center gap-3 text-sm animate-scale-in">
                    <Badge className="bg-primary/15 text-primary border-0 py-1.5 px-3">
                      <CalendarIcon className="w-3.5 h-3.5 mr-1.5" />
                      {format(selectedDate!, "EEE, MMM d, yyyy")}
                    </Badge>
                    <Badge className="bg-primary/15 text-primary border-0 py-1.5 px-3">
                      <Clock className="w-3.5 h-3.5 mr-1.5" />
                      {selectedTime}
                    </Badge>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {selectedDate ? "Now select a time slot above" : "Select a date and time to continue"}
                  </p>
                )}
              </div>
              <Button
                size="lg"
                className={cn(
                  "w-full md:w-auto font-semibold min-w-[200px] transition-all",
                  isScheduleComplete ? "bg-gradient-primary shadow-lg hover:shadow-xl" : "bg-muted text-muted-foreground"
                )}
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

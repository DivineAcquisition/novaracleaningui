import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar as CalendarIcon, Clock, ChevronRight, ChevronLeft, Loader2, Sun, Sunset, Moon, Check, Sparkles } from "lucide-react";
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

const TIME_SLOTS = [
  { id: "8:00 AM - 9:00 AM", label: "8:00 AM", period: "morning", startTime: "08:00", endTime: "09:00" },
  { id: "9:00 AM - 10:00 AM", label: "9:00 AM", period: "morning", startTime: "09:00", endTime: "10:00" },
  { id: "10:00 AM - 11:00 AM", label: "10:00 AM", period: "morning", startTime: "10:00", endTime: "11:00" },
  { id: "11:00 AM - 12:00 PM", label: "11:00 AM", period: "morning", startTime: "11:00", endTime: "12:00" },
  { id: "12:00 PM - 1:00 PM", label: "12:00 PM", period: "afternoon", startTime: "12:00", endTime: "13:00" },
  { id: "1:00 PM - 2:00 PM", label: "1:00 PM", period: "afternoon", startTime: "13:00", endTime: "14:00" },
  { id: "2:00 PM - 3:00 PM", label: "2:00 PM", period: "afternoon", startTime: "14:00", endTime: "15:00" },
  { id: "3:00 PM - 4:00 PM", label: "3:00 PM", period: "afternoon", startTime: "15:00", endTime: "16:00" },
  { id: "4:00 PM - 5:00 PM", label: "4:00 PM", period: "evening", startTime: "16:00", endTime: "17:00" },
  { id: "5:00 PM - 6:00 PM", label: "5:00 PM", period: "evening", startTime: "17:00", endTime: "18:00" },
];

const PERIOD_CONFIG = {
  morning: { label: "Morning", icon: Sun, color: "text-amber-500", bgColor: "bg-amber-50", borderColor: "border-amber-200" },
  afternoon: { label: "Afternoon", icon: Sunset, color: "text-orange-500", bgColor: "bg-orange-50", borderColor: "border-orange-200" },
  evening: { label: "Evening", icon: Moon, color: "text-violet-500", bgColor: "bg-violet-50", borderColor: "border-violet-200" },
};

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

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

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
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

  const slotsByPeriod = useMemo(() => {
    return TIME_SLOTS.reduce((acc, slot) => {
      if (!acc[slot.period]) acc[slot.period] = [];
      acc[slot.period].push(slot);
      return acc;
    }, {} as Record<string, typeof TIME_SLOTS>);
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-2xl md:text-3xl font-bold mb-2">When would you like us?</h2>
        <p className="text-muted-foreground">Book 3+ days in advance for best availability</p>
      </div>

      {/* Main Content Grid */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Date Selection Card */}
        <Card className="border-2 border-border hover:border-[#5500FF]/30 transition-colors overflow-hidden">
          <div className="bg-gradient-to-r from-[#5500FF]/10 to-[#8F7BFD]/10 px-5 py-4 border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center",
                  selectedDate ? "bg-[#5500FF] text-white" : "bg-muted"
                )}>
                  {selectedDate ? <Check className="w-5 h-5" /> : <CalendarIcon className="w-5 h-5" />}
                </div>
                <div>
                  <p className="font-semibold">Select Date</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedDate ? format(selectedDate, "EEEE, MMM d") : "Choose your preferred day"}
                  </p>
                </div>
              </div>
            </div>
          </div>
          
          <CardContent className="p-4">
            {/* Month Navigation */}
            <div className="flex items-center justify-between mb-4">
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0"
                onClick={goToPreviousMonth}
                disabled={isBefore(endOfMonth(addMonths(currentMonth, -1)), minDate)}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <h3 className="text-lg font-semibold">
                {format(currentMonth, "MMMM yyyy")}
              </h3>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0"
                onClick={goToNextMonth}
                disabled={!isBefore(startOfMonth(addMonths(currentMonth, 1)), endDate)}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>
            
            {/* Weekday Headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {WEEKDAYS.map((day, i) => (
                <div key={i} className="text-center text-xs font-medium text-muted-foreground py-2">
                  {day}
                </div>
              ))}
            </div>
            
            {/* Calendar Grid */}
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
                      "aspect-square rounded-xl flex items-center justify-center text-sm font-medium transition-all relative",
                      "hover:bg-[#5500FF]/10 focus:outline-none focus:ring-2 focus:ring-[#5500FF]/50",
                      disabled && "opacity-25 cursor-not-allowed hover:bg-transparent",
                      !isCurrentMonth && "opacity-40",
                      isSelected && "bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] text-white shadow-lg scale-110",
                      isToday && !isSelected && "ring-2 ring-[#5500FF]/40 font-bold text-[#5500FF]",
                      !disabled && !isSelected && "hover:scale-105"
                    )}
                  >
                    {format(day, "d")}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Time Selection Card */}
        <Card className="border-2 border-border hover:border-[#5500FF]/30 transition-colors overflow-hidden">
          <div className="bg-gradient-to-r from-[#8F7BFD]/10 to-[#5500FF]/10 px-5 py-4 border-b">
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center",
                selectedTime ? "bg-[#5500FF] text-white" : "bg-muted"
              )}>
                {selectedTime ? <Check className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
              </div>
              <div>
                <p className="font-semibold">Select Time</p>
                <p className="text-xs text-muted-foreground">
                  {selectedTime || "Pick your arrival window"}
                </p>
              </div>
            </div>
          </div>
          
          <CardContent className="p-4">
            {!selectedDate ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                  <Clock className="w-8 h-8 opacity-40" />
                </div>
                <p className="text-sm font-medium">Select a date first</p>
                <p className="text-xs">Available times will appear here</p>
              </div>
            ) : isLoading ? (
              <div className="space-y-4 py-4">
                {["morning", "afternoon", "evening"].map((period) => (
                  <div key={period} className="space-y-2">
                    <Skeleton className="h-6 w-24" />
                    <div className="grid grid-cols-2 gap-2">
                      {[1, 2, 3, 4].map((i) => (
                        <Skeleton key={i} className="h-12 rounded-xl" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-5 py-2">
                {(["morning", "afternoon", "evening"] as const).map((period) => {
                  const config = PERIOD_CONFIG[period];
                  const Icon = config.icon;
                  const slots = slotsByPeriod[period] || [];
                  
                  return (
                    <div key={period}>
                      <div className={cn(
                        "flex items-center gap-2 mb-3 px-3 py-2 rounded-lg",
                        config.bgColor, config.borderColor, "border"
                      )}>
                        <Icon className={cn("w-4 h-4", config.color)} />
                        <span className="text-sm font-semibold">{config.label}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
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
                                "relative py-3 px-4 rounded-xl border-2 text-sm font-semibold transition-all",
                                "focus:outline-none focus:ring-2 focus:ring-[#5500FF]/50",
                                isSelected 
                                  ? "border-[#5500FF] bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] text-white shadow-lg" 
                                  : "border-border hover:border-[#5500FF]/50 hover:bg-[#5500FF]/5",
                                !status.available && "opacity-30 cursor-not-allowed bg-muted/30 hover:bg-muted/30 hover:border-border",
                              )}
                            >
                              {slot.label}
                              {status.label === "Few left" && status.available && !isSelected && (
                                <Badge className="absolute -top-2 -right-2 px-1.5 py-0.5 text-[10px] bg-amber-500 text-white border-0">
                                  2 left
                                </Badge>
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
          </CardContent>
        </Card>
      </div>

      {/* Selection Summary & Continue */}
      {showContinue && (
        <Card className={cn(
          "border-2 transition-all overflow-hidden",
          isScheduleComplete 
            ? "border-[#5500FF] bg-gradient-to-r from-[#5500FF]/5 to-[#8F7BFD]/5" 
            : "border-border bg-muted/30"
        )}>
          <CardContent className="p-5">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                {isScheduleComplete ? (
                  <>
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] flex items-center justify-center">
                      <Sparkles className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <p className="font-semibold">Perfect! You're all set.</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CalendarIcon className="w-4 h-4" />
                        {format(selectedDate!, "EEE, MMM d")}
                        <span>•</span>
                        <Clock className="w-4 h-4" />
                        {selectedTime}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                      <CalendarIcon className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium text-muted-foreground">
                        {selectedDate ? "Now select a time" : "Select date & time to continue"}
                      </p>
                    </div>
                  </>
                )}
              </div>
              <Button
                size="lg"
                className={cn(
                  "w-full md:w-auto min-w-[200px] h-12 font-semibold text-base transition-all",
                  isScheduleComplete 
                    ? "bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90 shadow-lg" 
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                )}
                onClick={onContinue}
                disabled={!isScheduleComplete || continueDisabled || isProcessing}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    Continue to Checkout
                    <ChevronRight className="w-5 h-5 ml-1" />
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

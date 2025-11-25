import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { CalendarDays } from "lucide-react";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { MembershipBanner } from "@/components/booking/MembershipBanner";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { useAuth } from "@/contexts/AuthContext";
import { useBookingSwipe } from "@/hooks/use-booking-swipe";
import { getEstimatedHours } from "@/lib/pricing-system";
import { calculateServiceDuration, generateTimeSlots, isWeekend } from "@/lib/time-slots";
import { addDays } from "date-fns";

const BOOKING_STEPS = [
  { number: 1, label: "Location" },
  { number: 2, label: "Home Size" },
  { number: 3, label: "Service" },
  { number: 4, label: "Schedule" },
  { number: 5, label: "Details" },
  { number: 6, label: "Payment" },
];

export default function BookingSchedule() {
  const navigate = useNavigate();
  const { bookingData, updateBookingData } = useBooking();
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    bookingData.serviceDate ? new Date(bookingData.serviceDate) : undefined
  );
  const [selectedTime, setSelectedTime] = useState<string>(bookingData.timeSlot || "");

  useBookingSwipe({
    onSwipeLeft: () => selectedDate && selectedTime && handleContinue(),
    onSwipeRight: () => navigate("/book/service"),
  });

  const serviceDuration = calculateServiceDuration(
    bookingData.homeSizeId,
    bookingData.serviceType,
    getEstimatedHours(bookingData.homeSizeId)
  );

  const timeSlots = generateTimeSlots(serviceDuration, bookingData.serviceType);

  const isDateDisabled = (date: Date) => {
    const today = new Date();
    const minDate = addDays(today, 3);
    return date < minDate || isWeekend(date);
  };

  const handleContinue = () => {
    if (!selectedDate || !selectedTime) return;
    
    const dateStr = selectedDate.toISOString().split('T')[0];
    const selectedSlot = timeSlots.find(slot => slot.id === selectedTime);
    
    updateBookingData({
      serviceDate: dateStr,
      timeSlot: selectedTime,
      startTime: selectedSlot?.startTime,
      endTime: selectedSlot?.endTime,
      serviceDuration,
    });
    navigate("/book/details");
  };

  const handleBack = () => {
    navigate("/book/service");
  };

  return (
    <div className="min-h-screen bg-gradient-hero pb-32 md:pb-8 animate-fade-in">
      <ProgressBar currentStep={4} totalSteps={6} steps={BOOKING_STEPS} />
      
      <div className="container max-w-5xl mx-auto px-3 md:px-6 py-4 md:py-8 space-y-3 md:space-y-4">
        {!user && (
          <Card className="bg-gradient-to-r from-success/10 via-success/5 to-background border-2 border-success/40">
            <div className="p-3 md:p-6">
              <div className="flex items-center gap-2 md:gap-4">
                <span className="text-2xl">🎉</span>
                <div>
                  <h3 className="text-sm md:text-lg font-semibold text-success">New Customer!</h3>
                  <p className="text-xs md:text-sm">Get <span className="font-bold">$30 off</span> your first service</p>
                </div>
              </div>
            </div>
          </Card>
        )}
        
        {user && <MembershipBanner />}
        
        <Card>
          <div className="p-6">
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                  <CalendarDays className="w-5 h-5" />
                  Select Date & Time
                </h3>
                <p className="text-muted-foreground">Choose your preferred date and time (closed on weekends)</p>
              </div>

              {/* Date Selection */}
              <div>
                <h4 className="font-medium mb-3">Select Date</h4>
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  disabled={isDateDisabled}
                  className="rounded-md border"
                />
                <p className="text-xs text-muted-foreground mt-2">
                  We require at least 3 days advance notice
                </p>
              </div>

              {/* Time Selection */}
              {selectedDate && (
                <div>
                  <h4 className="font-medium mb-3">Select Time</h4>
                  <div className="grid grid-cols-2 gap-3">
                    {timeSlots.map((slot) => (
                      <Button
                        key={slot.id}
                        variant={selectedTime === slot.id ? "default" : "outline"}
                        onClick={() => setSelectedTime(slot.id)}
                        className="h-auto py-3"
                      >
                        {slot.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              <div className="hidden md:flex gap-4 pt-8 mt-8 border-t">
                <Button variant="outline" size="lg" onClick={handleBack} className="h-14">
                  Back
                </Button>
                <Button size="lg" onClick={handleContinue} disabled={!selectedDate || !selectedTime} className="flex-1 h-14">
                  Continue
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <BottomNavigation 
        currentStep={4} 
        totalSteps={6} 
        onBack={handleBack} 
        onContinue={handleContinue} 
        continueDisabled={!selectedDate || !selectedTime}
        steps={BOOKING_STEPS}
      />
    </div>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarDays } from "lucide-react";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { MembershipBanner } from "@/components/booking/MembershipBanner";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { useAuth } from "@/contexts/AuthContext";
import { useBookingSwipe } from "@/hooks/use-booking-swipe";
import { getEstimatedHours } from "@/lib/pricing-system";
import { calculateServiceDuration } from "@/lib/time-slots";
import { AvailabilityCalendar } from "@/components/booking/AvailabilityCalendar";
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
  const [selectedDate, setSelectedDate] = useState<string>(bookingData.serviceDate || "");
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

  const minDate = addDays(new Date(), 3);

  const handleDateSelect = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    setSelectedDate(dateStr);
    setSelectedTime(""); // Clear time when date changes
  };

  const handleSelectSlot = (date: Date, timeSlot: string, startTime: string, endTime: string) => {
    const dateStr = date.toISOString().split('T')[0];
    setSelectedDate(dateStr);
    setSelectedTime(timeSlot);
  };

  const handleContinue = () => {
    if (!selectedDate || !selectedTime) return;
    
    updateBookingData({
      serviceDate: selectedDate,
      timeSlot: selectedTime,
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
              
              <AvailabilityCalendar 
                selectedDate={selectedDate ? new Date(selectedDate) : undefined} 
                selectedTime={selectedTime} 
                onSelectSlot={handleSelectSlot}
                onDateSelect={handleDateSelect}
                minDate={minDate} 
              />

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

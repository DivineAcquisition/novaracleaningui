import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, ArrowLeft, CalendarDays } from "lucide-react";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { AvailabilityCalendar } from "@/components/booking/AvailabilityCalendar";
import { calculateServiceDuration } from "@/lib/time-slots";
import { useBookingSwipe } from "@/hooks/use-booking-swipe";
import { getEstimatedHours } from "@/lib/pricing-system";
import { MembershipBanner } from "@/components/booking/MembershipBanner";

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
  const [selectedDate, setSelectedDate] = useState(bookingData.serviceDate || "");
  const [selectedTime, setSelectedTime] = useState(bookingData.timeSlot || "");
  const [serviceDuration, setServiceDuration] = useState(2);

  const swipeHandlers = useBookingSwipe({
    onSwipeRight: () => navigate('/book/service'),
    step: 4,
  });

  useEffect(() => {
    if (bookingData.homeSizeId && bookingData.serviceType) {
      const baseHours = getEstimatedHours(bookingData.homeSizeId);
      const duration = calculateServiceDuration(bookingData.homeSizeId, bookingData.serviceType, baseHours);
      setServiceDuration(duration);
    }
  }, [bookingData.homeSizeId, bookingData.serviceType]);

  const minDate = new Date();
  minDate.setDate(minDate.getDate() + 3);

  const handleSelectSlot = (date: string, time: string) => {
    setSelectedDate(date);
    setSelectedTime(time);
  };

  const handleContinue = () => {
    if (!selectedDate || !selectedTime) return;
    updateBookingData({ serviceDate: selectedDate, timeSlot: selectedTime, serviceDuration });
    navigate('/book/details');
  };

  const handleBack = () => navigate('/book/service');

  return (
    <div className="min-h-screen bg-gradient-hero pb-32 md:pb-8 animate-fade-in" {...swipeHandlers}>
      <ProgressBar currentStep={4} totalSteps={6} steps={BOOKING_STEPS} />
      <div className="container max-w-5xl mx-auto px-3 md:px-6 py-4 md:py-8 space-y-3 md:space-y-4">
        {!user && (
          <Card className="bg-gradient-to-r from-success/10 via-success/5 to-background border-2 border-success/40">
            <CardContent className="p-3 md:p-6">
              <div className="flex items-center gap-2 md:gap-4">
                <span className="text-2xl">🎉</span>
                <div>
                  <h3 className="text-sm md:text-lg font-semibold text-success">New Customer!</h3>
                  <p className="text-xs md:text-sm">Get <span className="font-bold">$30 off</span> your first service</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        {user && <MembershipBanner />}
        <Card>
          <CardContent className="p-6">
            <div className="mb-8 text-center">
              <div className="flex items-center justify-center gap-2 mb-3">
                <CalendarDays className="w-8 h-8 text-primary" />
                <h2 className="text-3xl font-bold">Select Date & Time</h2>
              </div>
              <p className="text-muted-foreground">Choose your preferred date and time (closed on weekends)</p>
            </div>
            <AvailabilityCalendar selectedDate={selectedDate} selectedTime={selectedTime} onSelectSlot={handleSelectSlot} minDate={minDate} />

            <div className="hidden md:flex gap-4 pt-8 mt-8 border-t">
              <Button variant="outline" size="lg" onClick={handleBack} className="h-14">
                <ArrowLeft className="mr-2 w-5 h-5" />Back
              </Button>
              <Button variant="default" size="lg" onClick={handleContinue} disabled={!selectedDate || !selectedTime} className="flex-1 h-14">
                Continue<ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <BottomNavigation onBack={handleBack} onNext={handleContinue} nextDisabled={!selectedDate || !selectedTime} />
    </div>
  );
}

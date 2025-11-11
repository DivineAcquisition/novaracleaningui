import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Clock, ArrowRight, ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { generateTimeSlots, calculateServiceDuration, isWeekend } from "@/lib/time-slots";
import { useBookingSwipe } from "@/hooks/use-booking-swipe";
import { HOME_SIZE_RANGES, MEMBERSHIP_PLANS, SERVICE_TIER_PRICING, ADD_ONS } from "@/lib/pricing-system";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { addDays, format } from "date-fns";

const BOOKING_STEPS = [
  { number: 1, label: "Location" },
  { number: 2, label: "Home Size" },
  { number: 3, label: "Service" },
  { number: 4, label: "Schedule" },
  { number: 5, label: "Checkout" },
];

export default function BookingSchedule() {
  const navigate = useNavigate();
  const { bookingData, updateBookingData, currentStep, setCurrentStep } = useBooking();
  const { user } = useAuth();
  
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    bookingData.serviceDate ? new Date(bookingData.serviceDate) : undefined
  );
  const [selectedTime, setSelectedTime] = useState(bookingData.timeSlot || "");
  const [serviceDuration, setServiceDuration] = useState(2);

  // Swipe gesture handlers
  const swipeHandlers = useBookingSwipe({
    onSwipeRight: () => {
      setCurrentStep(3);
      navigate("/book/service");
    },
    onSwipeLeft: () => {
      if (selectedDate && selectedTime) {
        handleContinue();
      }
    },
    canSwipeLeft: !!(selectedDate && selectedTime),
    step: 4,
  });

  // Calculate service duration based on home size and service type
  useEffect(() => {
    const homeSize = HOME_SIZE_RANGES.find(h => h.id === bookingData.homeSizeId);
    if (homeSize) {
      const duration = calculateServiceDuration(
        bookingData.homeSizeId,
        bookingData.serviceType,
        homeSize.baseHours
      );
      setServiceDuration(duration);
      updateBookingData({ serviceDuration: duration });
    }
  }, [bookingData.homeSizeId, bookingData.serviceType]);

  // Generate time slots based on service duration
  const timeSlots = generateTimeSlots(serviceDuration, bookingData.serviceType);

  // Minimum date is 3 days from now, and we don't work weekends
  const minDate = addDays(new Date(), 3);

  const handleContinue = () => {
    if (!selectedDate || !selectedTime) {
      toast.error("Please select both date and time");
      return;
    }

    updateBookingData({
      serviceDate: format(selectedDate, 'yyyy-MM-dd'),
      timeSlot: selectedTime,
    });
    setCurrentStep(5);
    navigate("/book/checkout");
  };

  const handleBack = () => {
    setCurrentStep(3);
    navigate("/book/service");
  };

  return (
    <div className="min-h-screen bg-gradient-hero pb-32 md:pb-8 animate-fade-in" {...swipeHandlers}>
      <ProgressBar currentStep={currentStep} totalSteps={5} steps={BOOKING_STEPS} />
      
      <div className="container max-w-4xl mx-auto px-4 md:px-6 py-6 md:py-8">
        <Card className="shadow-xl animate-slide-in-right">
          <CardHeader className="text-center space-y-2 pb-6 px-4 md:px-6 md:pb-8">
            <CardTitle className="text-xl md:text-3xl font-bold">Schedule your service</CardTitle>
            <CardDescription className="text-sm md:text-base">
              Select your preferred date and time window
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-6 md:space-y-8 px-4 md:px-6">
            {/* New Customer Banner */}
            {!user && (
              <Card className="border-2 border-green-500/50 bg-gradient-to-br from-green-50 to-emerald-50 animate-fade-in">
                <CardContent className="p-4 text-center">
                  <Badge className="mb-2 bg-green-600 text-white">
                    🎉 New Customer Special
                  </Badge>
                  <p className="text-xl md:text-2xl font-bold text-green-700">
                    $60 Off All Services!
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Horizontal Date Scroller */}
            <div className="space-y-3 md:space-y-4 animate-slide-in-from-right">
              <div>
                <h3 className="text-base md:text-xl font-semibold">Select a date</h3>
                <p className="text-sm text-muted-foreground mt-1">We're closed on weekends. Book at least 3 days in advance.</p>
              </div>
              <ScrollArea className="w-full whitespace-nowrap rounded-lg border">
                <div className="flex gap-2 md:gap-3 p-3 md:p-4">
                  {Array.from({ length: 30 }, (_, i) => {
                    const date = addDays(minDate, i);
                    
                    // Skip weekends - we're closed Saturday and Sunday
                    if (isWeekend(date)) {
                      return null;
                    }
                    
                    const isSelected = selectedDate && format(date, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd');
                    
                    return (
                      <Card
                        key={i}
                        onClick={() => setSelectedDate(date)}
                        className={cn(
                          "flex-shrink-0 w-[85px] md:w-20 cursor-pointer transition-all duration-300 min-h-[85px] md:min-h-[80px] active:scale-95",
                          isSelected 
                            ? "bg-primary text-primary-foreground border-primary shadow-lg scale-110 ring-2 ring-primary/50" 
                            : "hover:border-primary/50 hover:scale-105"
                        )}
                      >
                        <CardContent className="p-3 md:p-3 text-center space-y-1 flex flex-col justify-center h-full">
                          <p className={cn(
                            "text-xs md:text-xs font-semibold uppercase tracking-wide",
                            isSelected ? "opacity-95" : "opacity-70"
                          )}>
                            {format(date, 'EEE')}
                          </p>
                          <p className="text-3xl md:text-2xl font-bold">
                            {format(date, 'd')}
                          </p>
                          <p className={cn(
                            "text-sm md:text-xs font-medium",
                            isSelected ? "opacity-95" : "opacity-70"
                          )}>
                            {format(date, 'MMM')}
                          </p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>

            {/* Time Slots */}
            {selectedDate && (
              <div className="space-y-3 md:space-y-4 animate-slide-in-from-right">
                <h3 className="text-base md:text-xl font-semibold">Choose a time window</h3>
                <div className="grid gap-3 md:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                  {timeSlots.map((slot) => (
                    <Card
                      key={slot.id}
                      className={cn(
                        "cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-[1.02] md:hover:scale-105 active:scale-95 min-h-[110px] md:min-h-[100px]",
                        selectedTime === slot.id && "ring-2 ring-primary shadow-lavender scale-[1.02] md:scale-105 bg-primary/5"
                      )}
                      onClick={() => setSelectedTime(slot.id)}
                    >
                      <CardContent className="p-5 md:p-6 text-center space-y-2 flex flex-col justify-center h-full">
                        <Clock className="mx-auto w-9 h-9 md:w-8 md:h-8 text-primary" />
                        <p className="font-semibold text-base md:text-base">{slot.label}</p>
                        <Badge variant="secondary" className="text-xs mx-auto">
                          {slot.estimatedDuration} {slot.estimatedDuration === 1 ? 'hour' : 'hours'}
                        </Badge>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Desktop Navigation - Hidden on Mobile */}
            <div className="hidden md:flex gap-4 pt-6">
              <Button variant="outline" size="lg" onClick={handleBack} className="h-12 md:h-14">
                <ArrowLeft className="mr-2 w-4 h-4 md:w-5 md:h-5" /> Back
              </Button>
              <Button 
                size="lg" 
                onClick={handleContinue} 
                disabled={!selectedDate || !selectedTime}
                className="h-12 md:h-14"
              >
                Continue <ArrowRight className="ml-2 w-4 h-4 md:w-5 md:h-5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Mobile Navigation */}
      <BottomNavigation
        currentStep={currentStep}
        totalSteps={5}
        steps={BOOKING_STEPS}
        onBack={handleBack}
        onContinue={handleContinue}
        continueDisabled={!selectedDate || !selectedTime}
      />
    </div>
  );
}

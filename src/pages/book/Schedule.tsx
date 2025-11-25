import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowRight, ArrowLeft, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { BookingFooter } from "@/components/booking/BookingFooter";
import { AvailabilityCalendar } from "@/components/booking/AvailabilityCalendar";
import { calculateServiceDuration } from "@/lib/time-slots";
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
  { number: 5, label: "Details" },
  { number: 6, label: "Payment" },
];

export default function BookingSchedule() {
  const navigate = useNavigate();
  const { bookingData, updateBookingData, currentStep, setCurrentStep } = useBooking();
  const { user } = useAuth();
  const dateTimeSectionRef = useRef<HTMLDivElement>(null);
  
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    bookingData.serviceDate ? new Date(bookingData.serviceDate) : undefined
  );
  const [selectedTime, setSelectedTime] = useState(bookingData.timeSlot || "");
  const [selectedStartTime, setSelectedStartTime] = useState("");
  const [selectedEndTime, setSelectedEndTime] = useState("");
  const [membershipPlan, setMembershipPlan] = useState(bookingData.membershipPlan || "none");
  const [useCredit, setUseCredit] = useState(bookingData.useCredit || false);
  const [creditAvailable, setCreditAvailable] = useState(false);
  const [creditAvailableDate, setCreditAvailableDate] = useState<string>("");
  const [checkingCredit, setCheckingCredit] = useState(false);
  const [serviceDuration, setServiceDuration] = useState(2);

  // Swipe gesture handlers
  const swipeHandlers = useBookingSwipe({
    onSwipeRight: () => {
      setCurrentStep(3);
      navigate("/book/service");
    },
    onSwipeLeft: () => {
      if (selectedDate && selectedTime && !checkingCredit && (!useCredit || creditAvailable)) {
        handleContinue();
      }
    },
    canSwipeLeft: !!(selectedDate && selectedTime && !checkingCredit && (!useCredit || creditAvailable)),
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

  // Auto-scroll to date/time section when membership is selected
  useEffect(() => {
    if (membershipPlan !== 'none' && dateTimeSectionRef.current) {
      setTimeout(() => {
        dateTimeSectionRef.current?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'start' 
        });
      }, 300);
    }
  }, [membershipPlan]);

  const minDate = addDays(new Date(), 3);

  // Check credit availability
  useEffect(() => {
    if (!useCredit || !user || !selectedDate) {
      setCreditAvailable(true);
      return;
    }

    const checkCredit = async () => {
      setCheckingCredit(true);
      try {
        const { data, error } = await supabase.functions.invoke('check-subscription', {
          body: { 
            userId: user.id,
            requestedDate: format(selectedDate, 'yyyy-MM-dd')
          }
        });

        if (error) throw error;

        if (data.canUseCredit) {
          setCreditAvailable(true);
        } else {
          setCreditAvailable(false);
          setCreditAvailableDate(data.nextAvailableDate);
          toast.error(`Credit not available until ${data.nextAvailableDate}`);
        }
      } catch (error) {
        console.error('Error checking credit:', error);
        toast.error('Failed to check credit availability');
        setCreditAvailable(false);
      } finally {
        setCheckingCredit(false);
      }
    };

    checkCredit();
  }, [useCredit, user, selectedDate]);

  const handleContinue = () => {
    if (!selectedDate || !selectedTime) {
      toast.error("Please select both date and time");
      return;
    }

    if (useCredit && !creditAvailable) {
      toast.error("Credit is not available for the selected date");
      return;
    }

    updateBookingData({
      serviceDate: format(selectedDate, 'yyyy-MM-dd'),
      timeSlot: selectedTime,
      membershipPlan,
      useCredit,
      startTime: selectedStartTime,
      endTime: selectedEndTime,
    });
    setCurrentStep(5);
    navigate("/book/details");
  };

  const handleSelectSlot = (date: Date, timeSlot: string, startTime: string, endTime: string) => {
    setSelectedDate(date);
    setSelectedTime(timeSlot);
    setSelectedStartTime(startTime);
    setSelectedEndTime(endTime);
  };

  const handleBack = () => {
    setCurrentStep(3);
    navigate("/book/service");
  };

  return (
    <div className="min-h-screen bg-gradient-hero pb-32 md:pb-8 animate-fade-in" {...swipeHandlers}>
      <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
      
      <div className="container max-w-4xl mx-auto px-3 md:px-6 py-4 md:py-8">
        <Card variant="outlined" className="animate-slide-in-right">
          <CardHeader className="text-center space-y-1.5 pb-4 px-3 md:px-6 md:pb-8">
            <CardTitle className="text-base md:text-xl font-semibold font-jakarta">Schedule your service</CardTitle>
            <CardDescription className="text-xs md:text-sm">
              Select your preferred date and time window
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-4 md:space-y-8 px-3 md:px-6">
            {/* New Customer Banner */}
            {!user && (
              <Card className="border-2 border-green-500/60 bg-gradient-to-br from-green-50 to-emerald-50 shadow-card animate-fade-in">
                <CardContent className="p-3 md:p-4 text-center">
                  <Badge className="mb-1.5 md:mb-2 bg-green-600 text-white text-xs">
                    🎉 New Customer Special
                  </Badge>
                  <p className="text-sm md:text-lg font-semibold text-green-700">
                    $60 Off All Services!
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Membership Plan Selection */}
            <div className="space-y-2.5 md:space-y-4 animate-slide-in-from-right">
              <h3 className="text-sm md:text-lg font-semibold">Choose a plan</h3>
              <div className="grid gap-2.5 md:gap-4 grid-cols-1 sm:grid-cols-2">
                {Object.entries(MEMBERSHIP_PLANS).map(([planId, plan]) => {
                  // Calculate potential savings based on current extras
                  const serviceTierPrice = SERVICE_TIER_PRICING[bookingData.serviceType as keyof typeof SERVICE_TIER_PRICING]?.addition || 0;
                  const addOnsTotal = bookingData.addOns.reduce((sum, addon) => 
                    sum + (ADD_ONS[addon as keyof typeof ADD_ONS]?.price || 0), 0
                  );
                  const extrasAmount = serviceTierPrice + addOnsTotal;
                  const dollarSavings = extrasAmount * plan.discount;

                  return (
                  <Card
                    key={planId}
                    className={cn(
                      "card-interactive min-h-[140px] md:min-h-0",
                      membershipPlan === planId && "ring-2 ring-primary border-primary/60 shadow-lavender scale-[1.02] md:scale-105"
                    )}
                    onClick={() => setMembershipPlan(planId)}
                  >
                    <CardContent className="p-5 md:p-6 space-y-2 flex flex-col justify-center h-full">
                      <div className="flex justify-between items-start">
                        <h4 className="font-semibold text-base md:text-lg">{plan.label}</h4>
                        {plan.discount > 0 && (
                          <div className="flex flex-col items-end gap-1">
                            <Badge variant="secondary" className="text-xs">
                              {(plan.discount * 100).toFixed(0)}% off extras
                            </Badge>
                            {extrasAmount > 0 && dollarSavings > 0 && (
                              <span className="text-xs font-semibold text-green-600">
                                Save ${dollarSavings.toFixed(2)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <p className="text-xl md:text-2xl font-bold text-primary">
                        ${plan.monthlyPrice}<span className="text-sm text-muted-foreground">/mo</span>
                      </p>
                      <p className="text-xs md:text-sm text-muted-foreground">{plan.description}</p>
                    </CardContent>
                  </Card>
                  );
                })}
              </div>
            </div>

            {/* Credit Usage Toggle */}
            {membershipPlan !== 'none' && (
              <Card className="bg-muted/50 border border-border/60 shadow-md">
                <CardContent className="p-4 md:p-6">
                  <div className="flex items-start space-x-3">
                    <Checkbox
                      id="useCredit"
                      checked={useCredit}
                      onCheckedChange={(checked) => setUseCredit(checked as boolean)}
                      className="mt-1"
                    />
                    <div className="flex-1 space-y-2">
                      <label
                        htmlFor="useCredit"
                        className="text-sm md:text-base font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                      >
                        Use membership credit for this standard cleaning
                      </label>
                      <p className="text-xs text-muted-foreground">
                        Credits cover standard cleanings only
                      </p>
                      {useCredit && !creditAvailable && creditAvailableDate && (
                        <div className="flex items-start gap-2 text-xs md:text-sm text-amber-600 dark:text-amber-500">
                          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <span>Credit available from {creditAvailableDate}</span>
                        </div>
                      )}
                      {useCredit && creditAvailable && (
                        <div className="flex items-center gap-2 text-xs md:text-sm text-success">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Credit available for this date</span>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Date & Time Selection with Live Availability */}
            <div ref={dateTimeSectionRef} className="space-y-4 md:space-y-6">
              <AvailabilityCalendar
                onSelectSlot={handleSelectSlot}
                selectedDate={selectedDate}
                selectedTime={selectedTime}
                minDate={minDate}
              />
            </div>

            {/* Desktop Navigation - Hidden on Mobile */}
            <div className="hidden md:flex gap-4 pt-6">
              <Button 
                variant="outline" 
                size="lg" 
                onClick={handleBack} 
                className="h-12 md:h-14"
                aria-label="Go back to service selection"
              >
                <ArrowLeft className="mr-2 w-4 h-4 md:w-5 md:h-5" aria-hidden="true" /> 
                Back
              </Button>
              <Button 
                size="lg" 
                onClick={handleContinue} 
                disabled={!selectedDate || !selectedTime || checkingCredit || (useCredit && !creditAvailable)}
                className="h-12 md:h-14"
                aria-label={
                  !selectedDate 
                    ? "Please select a date to continue" 
                    : !selectedTime 
                    ? "Please select a time to continue"
                    : "Continue to contact details"
                }
                aria-disabled={!selectedDate || !selectedTime || checkingCredit || (useCredit && !creditAvailable)}
              >
                {checkingCredit ? (
                  <>
                    <Loader2 className="mr-2 w-4 h-4 md:w-5 md:h-5 animate-spin" aria-hidden="true" />
                    Checking Credit...
                  </>
                ) : (
                  <>
                    Continue 
                    <ArrowRight className="ml-2 w-4 h-4 md:w-5 md:h-5" aria-hidden="true" />
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Mobile Navigation */}
      <BottomNavigation
        currentStep={currentStep}
        totalSteps={6}
        steps={BOOKING_STEPS}
        onBack={handleBack}
        onContinue={handleContinue}
        continueDisabled={!selectedDate || !selectedTime || checkingCredit || (useCredit && !creditAvailable)}
        continueText={checkingCredit ? "Checking Credit..." : "Continue"}
      />

      <BookingFooter />
    </div>
  );
}

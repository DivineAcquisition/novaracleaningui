import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Clock, ArrowRight, ArrowLeft, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { DateTimeSkeleton } from "@/components/booking/DateTimeSkeleton";
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
  { number: 5, label: "Details" },
  { number: 6, label: "Payment" },
];

export default function BookingSchedule() {
  const navigate = useNavigate();
  const { bookingData, updateBookingData, currentStep, setCurrentStep } = useBooking();
  const { user } = useAuth();
  
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    bookingData.serviceDate ? new Date(bookingData.serviceDate) : undefined
  );
  const [selectedTime, setSelectedTime] = useState(bookingData.timeSlot || "");
  const [membershipPlan, setMembershipPlan] = useState(bookingData.membershipPlan || "none");
  const [useCredit, setUseCredit] = useState(bookingData.useCredit || false);
  const [creditAvailable, setCreditAvailable] = useState(false);
  const [creditAvailableDate, setCreditAvailableDate] = useState<string>("");
  const [checkingCredit, setCheckingCredit] = useState(false);
  const [serviceDuration, setServiceDuration] = useState(2);
  const [isLoadingDates, setIsLoadingDates] = useState(true);

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

  // Simulate loading dates
  useEffect(() => {
    setIsLoadingDates(true);
    const timer = setTimeout(() => {
      setIsLoadingDates(false);
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  // Generate time slots based on service duration
  const timeSlots = generateTimeSlots(serviceDuration, bookingData.serviceType);

  // Minimum date is 3 days from now, and we don't work weekends
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
    });
    setCurrentStep(5);
    navigate("/book/details");
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
                        Use membership credit for this booking
                      </label>
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

            {/* Date & Time Selection - Side by Side Layout */}
            {isLoadingDates ? (
              <DateTimeSkeleton />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 animate-slide-in-from-right">
                {/* Date Selection */}
                <div className="space-y-4">
                  <div>
                    <h3 
                      className="text-base md:text-lg font-semibold"
                      id="date-selection-label"
                    >
                      Select Date
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Choose your preferred service day
                    </p>
                  </div>
                  
                  <Card className="border-2 border-border/50 shadow-md">
                    <CardContent className="p-3 md:p-4">
                      <ScrollArea className="h-[320px] md:h-[400px] pr-2 md:pr-4">
                        <div 
                          className="space-y-2"
                          role="radiogroup"
                          aria-labelledby="date-selection-label"
                          aria-describedby="date-selection-description"
                        >
                          {Array.from({ length: 30 }, (_, i) => {
                            const date = addDays(minDate, i);
                            
                            // Skip weekends - we're closed Saturday and Sunday
                            if (isWeekend(date)) {
                              return null;
                            }
                            
                            const isSelected = selectedDate && format(date, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd');
                            const dateString = format(date, 'EEEE, MMMM d, yyyy');
                            
                            return (
                              <button
                                key={i}
                                onClick={() => setSelectedDate(date)}
                                role="radio"
                                aria-checked={isSelected}
                                aria-label={`Select ${dateString} for your cleaning service`}
                                className={cn(
                                  "w-full p-3 md:p-4 rounded-lg border-2 transition-all duration-200 text-left touch-manipulation",
                                  "hover:border-primary/40 hover:shadow-md active:scale-[0.98]",
                                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                  isSelected 
                                    ? "bg-primary text-primary-foreground border-primary shadow-md" 
                                    : "border-border/60 bg-background hover:bg-accent/30"
                                )}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3 md:gap-4">
                                    <div className={cn(
                                      "text-center min-w-[44px] md:min-w-[48px]",
                                      isSelected && "text-primary-foreground"
                                    )}>
                                      <p className="text-xs font-medium uppercase tracking-wide opacity-80">
                                        {format(date, 'EEE')}
                                      </p>
                                      <p className="text-xl md:text-2xl font-bold leading-none mt-1">
                                        {format(date, 'd')}
                                      </p>
                                    </div>
                                    <div>
                                      <p className={cn(
                                        "font-semibold text-sm md:text-base",
                                        isSelected && "text-primary-foreground"
                                      )}>
                                        {format(date, 'MMMM d, yyyy')}
                                      </p>
                                      <p className={cn(
                                        "text-xs md:text-sm mt-0.5",
                                        isSelected ? "text-primary-foreground/80" : "text-muted-foreground"
                                      )}>
                                        {format(date, 'EEEE')}
                                      </p>
                                    </div>
                                  </div>
                                  {isSelected && (
                                    <CheckCircle2 
                                      className="w-5 h-5 text-primary-foreground flex-shrink-0" 
                                      aria-hidden="true"
                                    />
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </ScrollArea>
                      
                      <div 
                        className="mt-3 md:mt-4 pt-3 md:pt-4 border-t border-border/50"
                        id="date-selection-description"
                      >
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
                    <h3 
                      className="text-base md:text-lg font-semibold"
                      id="time-selection-label"
                    >
                      Select Time
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {selectedDate 
                        ? `Available times for ${format(selectedDate, 'MMM d')}`
                        : 'Choose a date first'}
                    </p>
                  </div>
                  
                  {selectedDate ? (
                    <Card className="border-2 border-border/50 shadow-md">
                      <CardContent className="p-3 md:p-4">
                        <div 
                          className="space-y-2 md:space-y-3"
                          role="radiogroup"
                          aria-labelledby="time-selection-label"
                          aria-describedby="time-selection-description"
                        >
                          {timeSlots.map((slot) => {
                            const isSelected = selectedTime === slot.id;
                            
                            return (
                              <button
                                key={slot.id}
                                onClick={() => setSelectedTime(slot.id)}
                                role="radio"
                                aria-checked={isSelected}
                                aria-label={`Select ${slot.label} time window, estimated ${slot.estimatedDuration} ${slot.estimatedDuration === 1 ? 'hour' : 'hours'} service`}
                                className={cn(
                                  "w-full p-3 md:p-4 rounded-lg border-2 transition-all duration-200 text-left touch-manipulation",
                                  "hover:border-primary/40 hover:shadow-md active:scale-[0.98]",
                                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                  isSelected 
                                    ? "bg-primary text-primary-foreground border-primary shadow-md" 
                                    : "border-border/60 bg-background hover:bg-accent/30"
                                )}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <div className={cn(
                                      "w-10 h-10 md:w-12 md:h-12 rounded-lg flex items-center justify-center flex-shrink-0",
                                      isSelected 
                                        ? "bg-primary-foreground/20" 
                                        : "bg-primary/10"
                                    )}>
                                      <Clock className={cn(
                                        "w-5 h-5 md:w-6 md:h-6",
                                        isSelected ? "text-primary-foreground" : "text-primary"
                                      )} aria-hidden="true" />
                                    </div>
                                    <div>
                                      <p className={cn(
                                        "font-semibold text-sm md:text-base",
                                        isSelected && "text-primary-foreground"
                                      )}>
                                        {slot.label}
                                      </p>
                                      <p className={cn(
                                        "text-xs md:text-sm mt-0.5",
                                        isSelected ? "text-primary-foreground/80" : "text-muted-foreground"
                                      )}>
                                        {slot.estimatedDuration} {slot.estimatedDuration === 1 ? 'hour' : 'hours'} service
                                      </p>
                                    </div>
                                  </div>
                                  {isSelected && (
                                    <CheckCircle2 
                                      className="w-5 h-5 text-primary-foreground flex-shrink-0" 
                                      aria-hidden="true"
                                    />
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                        <p 
                          id="time-selection-description" 
                          className="sr-only"
                        >
                          Select your preferred time window for the cleaning service
                        </p>
                      </CardContent>
                    </Card>
                  ) : (
                    <Card className="border-2 border-dashed border-border/50">
                      <CardContent className="p-6 md:p-8 text-center">
                        <Clock 
                          className="w-10 h-10 md:w-12 md:h-12 text-muted-foreground/50 mx-auto mb-3" 
                          aria-hidden="true"
                        />
                        <p className="text-sm md:text-base text-muted-foreground" role="status">
                          Please select a date to view available time slots
                        </p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            )}

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
    </div>
  );
}

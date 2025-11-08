import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Clock, CalendarDays, Crown, Sparkles, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, addDays } from "date-fns";
import { MEMBERSHIP_PLANS, HOME_SIZE_RANGES } from "@/lib/pricing-system";
import { generateTimeSlots, calculateServiceDuration } from "@/lib/time-slots";
import { useIsMobile } from "@/hooks/use-mobile";
import { Checkbox } from "@/components/ui/checkbox";

const BOOKING_STEPS = [
  { number: 1, label: "Location" },
  { number: 2, label: "Home Size" },
  { number: 3, label: "Service" },
  { number: 4, label: "Schedule" },
  { number: 5, label: "Details" },
  { number: 6, label: "Payment" },
];

const BookingSchedule = () => {
  const navigate = useNavigate();
  const { bookingData, updateBookingData, currentStep, setCurrentStep } = useBooking();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    bookingData.serviceDate ? new Date(bookingData.serviceDate) : undefined
  );
  const [selectedTime, setSelectedTime] = useState(bookingData.timeSlot || "");
  const [membershipPlan, setMembershipPlan] = useState(bookingData.membershipPlan || "none");
  const [useCredit, setUseCredit] = useState(bookingData.useCredit || false);
  const [creditAvailable, setCreditAvailable] = useState(false);
  const [creditAvailableDate, setCreditAvailableDate] = useState<string>("");

  // Calculate service duration
  const homeSize = HOME_SIZE_RANGES.find(h => h.id === bookingData.homeSizeId);
  const serviceDuration = homeSize ? calculateServiceDuration(homeSize.baseHours, bookingData.serviceType) : 2;
  const timeSlots = generateTimeSlots(serviceDuration, bookingData.serviceType);

  // Generate next 30 days for date selection
  const minDate = addDays(new Date(), 2);
  const availableDates = Array.from({ length: 30 }, (_, i) => addDays(minDate, i));

  useEffect(() => {
    const checkCredit = async () => {
      if (!useCredit || !user) return;

      try {
        const { data, error } = await supabase.functions.invoke('check-credit-availability', {
          body: { 
            userId: user.id,
            requestedDate: selectedDate?.toISOString(),
          },
        });

        if (error) throw error;

        setCreditAvailable(data.available);
        setCreditAvailableDate(data.availableDate);

        if (!data.available) {
          toast.error(`Credit not available until ${format(new Date(data.availableDate), 'MMM d, yyyy')}`);
        }
      } catch (error) {
        console.error('Error checking credit:', error);
        setCreditAvailable(false);
      }
    };

    checkCredit();
  }, [useCredit, user, selectedDate]);

  const handleContinue = () => {
    if (!selectedDate || !selectedTime) {
      toast.error("Please select both a date and time");
      return;
    }

    if (useCredit && !creditAvailable) {
      toast.error("Credit not yet available for selected date");
      return;
    }

    updateBookingData({
      serviceDate: selectedDate.toISOString(),
      timeSlot: selectedTime,
      membershipPlan,
      useCredit,
      serviceDuration,
    });
    setCurrentStep(5);
    navigate("/book/details");
  };

  const handleBack = () => {
    navigate("/book/service");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
      
      <div className="container max-w-4xl mx-auto px-3 py-4 lg:px-4 lg:py-8 pb-32 lg:pb-8">
        <Card className="animate-fade-in border-border/50 shadow-lg">
          <CardHeader className="space-y-1 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-gradient-to-br from-primary to-primary/60">
                <CalendarDays className="w-5 h-5 lg:w-6 lg:h-6 text-primary-foreground" />
              </div>
              <div>
                <CardTitle className="text-xl lg:text-3xl">Schedule Your Service</CardTitle>
                <CardDescription className="text-sm lg:text-base">Choose a date, time, and membership plan</CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Membership Plans */}
            <div className="space-y-3">
              <h3 className="text-base lg:text-lg font-semibold flex items-center gap-2">
                <Crown className="w-4 h-4 lg:w-5 lg:h-5 text-primary" />
                Choose Your Plan
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Object.entries(MEMBERSHIP_PLANS).map(([key, plan]) => (
                  <Card
                    key={key}
                    className={cn(
                      "cursor-pointer transition-all duration-300 hover:shadow-md hover:border-primary/50 active:scale-95",
                      membershipPlan === key && "border-primary bg-primary/5 shadow-md"
                    )}
                    onClick={() => setMembershipPlan(key)}
                  >
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-semibold text-sm lg:text-base">{plan.label}</h4>
                          <p className="text-xs lg:text-sm text-muted-foreground">{plan.description}</p>
                        </div>
                        {plan.credits > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {plan.credits} credit{plan.credits > 1 ? 's' : ''}
                          </Badge>
                        )}
                      </div>
                      <div className="text-lg lg:text-xl font-bold text-primary">
                        {plan.monthlyPrice === 0 ? 'Pay as you go' : `$${plan.monthlyPrice}/mo`}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Use Credit Checkbox */}
              {membershipPlan !== 'none' && user && (
                <div className="flex items-start space-x-3 p-4 bg-secondary/30 rounded-lg border border-secondary">
                  <Checkbox
                    id="useCredit"
                    checked={useCredit}
                    onCheckedChange={(checked) => setUseCredit(checked as boolean)}
                  />
                  <div className="space-y-1">
                    <label
                      htmlFor="useCredit"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2 cursor-pointer"
                    >
                      <CreditCard className="w-4 h-4" />
                      Use monthly credit for this service
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Cover the base cleaning cost with your membership credit
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Date Selection */}
            <div className="space-y-3">
              <h3 className="text-base lg:text-lg font-semibold flex items-center gap-2">
                <CalendarDays className="w-4 h-4 lg:w-5 lg:h-5 text-primary" />
                Select Date
              </h3>
              <div className="overflow-x-auto pb-2 -mx-3 px-3 lg:mx-0 lg:px-0">
                <div className="flex gap-2 lg:gap-3 min-w-max lg:grid lg:grid-cols-7 lg:min-w-0">
                  {availableDates.slice(0, isMobile ? 14 : 21).map((date, index) => {
                    const isSelected = selectedDate && format(date, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd');
                    return (
                      <Card
                        key={index}
                        className={cn(
                          "cursor-pointer transition-all duration-300 hover:border-primary/50 hover:shadow-md flex-shrink-0 w-20 lg:w-auto active:scale-95",
                          isSelected && "border-primary bg-primary/10 shadow-md"
                        )}
                        onClick={() => setSelectedDate(date)}
                      >
                        <CardContent className="p-3 text-center space-y-1">
                          <div className={cn(
                            "text-xs font-medium uppercase",
                            isSelected ? "text-primary" : "text-muted-foreground"
                          )}>
                            {format(date, 'EEE')}
                          </div>
                          <div className={cn(
                            "text-xl lg:text-2xl font-bold",
                            isSelected && "text-primary"
                          )}>
                            {format(date, 'd')}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {format(date, 'MMM')}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Time Selection */}
            {selectedDate && (
              <div className="space-y-3 animate-fade-in">
                <h3 className="text-base lg:text-lg font-semibold flex items-center gap-2">
                  <Clock className="w-4 h-4 lg:w-5 lg:h-5 text-primary" />
                  Select Time Window
                </h3>
                <p className="text-xs lg:text-sm text-muted-foreground flex items-center gap-2">
                  <Sparkles className="w-3 h-3 lg:w-4 lg:h-4" />
                  Estimated service time: {serviceDuration} hours
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {timeSlots.map((slot, index) => {
                    const isSelected = selectedTime === slot.id;
                    return (
                      <Card
                        key={slot.id}
                        className={cn(
                          "cursor-pointer transition-all duration-300 hover:border-primary/50 hover:shadow-md animate-fade-in active:scale-95",
                          isSelected && "border-primary bg-primary/10 shadow-md"
                        )}
                        style={{ animationDelay: `${index * 50}ms` }}
                        onClick={() => setSelectedTime(slot.id)}
                      >
                        <CardContent className="p-4 text-center space-y-2">
                          <Clock className={cn(
                            "w-5 h-5 lg:w-6 lg:h-6 mx-auto",
                            isSelected ? "text-primary" : "text-muted-foreground"
                          )} />
                          <div className={cn(
                            "font-semibold text-sm lg:text-base",
                            isSelected && "text-primary"
                          )}>
                            {slot.label}
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {slot.duration}hr service
                          </Badge>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Desktop Buttons */}
            <div className="hidden lg:flex gap-4 pt-4">
              <Button
                variant="outline"
                size="lg"
                onClick={handleBack}
                className="flex-1"
              >
                Back
              </Button>
              <Button
                size="lg"
                onClick={handleContinue}
                disabled={!selectedDate || !selectedTime || (useCredit && !creditAvailable)}
                className="flex-1"
              >
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Mobile Bottom Navigation */}
      <BottomNavigation
        currentStep={currentStep}
        totalSteps={6}
        onBack={handleBack}
        onContinue={handleContinue}
        continueDisabled={!selectedDate || !selectedTime || (useCredit && !creditAvailable)}
        showBack={true}
      />
    </div>
  );
};

export default BookingSchedule;

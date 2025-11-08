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
import { generateTimeSlots, calculateServiceDuration } from "@/lib/time-slots";
import { HOME_SIZE_RANGES, MEMBERSHIP_PLANS } from "@/lib/pricing-system";
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

  // Minimum date is 2 days from now
  const minDate = addDays(new Date(), 2);

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
    <div className="min-h-screen bg-gradient-hero pb-32 md:pb-8">
      <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
      
      <div className="container max-w-4xl mx-auto px-3 md:px-4 py-4 md:py-8">
        <Card className="shadow-xl animate-fade-in">
          <CardHeader className="text-center space-y-2 pb-6 md:pb-8">
            <CardTitle className="text-2xl md:text-3xl font-bold">Schedule your service</CardTitle>
            <CardDescription className="text-sm md:text-base">
              Select your preferred date and time window
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-6 md:space-y-8">
            {/* Membership Plan Selection */}
            <div className="space-y-4">
              <h3 className="text-lg md:text-xl font-semibold">Choose a plan</h3>
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                {Object.entries(MEMBERSHIP_PLANS).map(([planId, plan]) => (
                  <Card
                    key={planId}
                    className={cn(
                      "cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-105",
                      membershipPlan === planId && "ring-2 ring-primary shadow-lavender scale-105"
                    )}
                    onClick={() => setMembershipPlan(planId)}
                  >
                    <CardContent className="p-4 md:p-6 space-y-2">
                      <div className="flex justify-between items-start">
                        <h4 className="font-bold text-base md:text-lg">{plan.label}</h4>
                        {plan.discount > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            Save {plan.discount}%
                          </Badge>
                        )}
                      </div>
                      <p className="text-xl md:text-2xl font-bold text-primary">
                        ${plan.monthlyPrice}<span className="text-sm text-muted-foreground">/mo</span>
                      </p>
                      <p className="text-xs md:text-sm text-muted-foreground">{plan.description}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            {/* Credit Usage Toggle */}
            {membershipPlan !== 'none' && (
              <Card className="bg-muted/50">
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

            {/* Horizontal Date Scroller */}
            <div className="space-y-4">
              <h3 className="text-lg md:text-xl font-semibold">Select a date</h3>
              <ScrollArea className="w-full whitespace-nowrap rounded-lg border">
                <div className="flex gap-3 p-4">
                  {Array.from({ length: 30 }, (_, i) => {
                    const date = addDays(minDate, i);
                    const isSelected = selectedDate && format(date, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd');
                    
                    return (
                      <Card
                        key={i}
                        onClick={() => setSelectedDate(date)}
                        className={cn(
                          "flex-shrink-0 w-20 cursor-pointer transition-all duration-300",
                          isSelected 
                            ? "bg-primary text-primary-foreground border-primary shadow-lg scale-105" 
                            : "hover:border-primary/50 hover:scale-105"
                        )}
                      >
                        <CardContent className="p-3 text-center space-y-1">
                          <p className={cn(
                            "text-xs font-medium",
                            isSelected ? "opacity-90" : "opacity-70"
                          )}>
                            {format(date, 'EEE')}
                          </p>
                          <p className="text-2xl font-bold">
                            {format(date, 'd')}
                          </p>
                          <p className={cn(
                            "text-xs",
                            isSelected ? "opacity-90" : "opacity-70"
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
              <div className="space-y-4 animate-fade-in">
                <h3 className="text-lg md:text-xl font-semibold">Choose a time window</h3>
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                  {timeSlots.map((slot) => (
                    <Card
                      key={slot.id}
                      className={cn(
                        "cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-105",
                        selectedTime === slot.id && "ring-2 ring-primary shadow-lavender scale-105"
                      )}
                      onClick={() => setSelectedTime(slot.id)}
                    >
                      <CardContent className="p-4 md:p-6 text-center space-y-2">
                        <Clock className="mx-auto w-8 h-8 text-primary" />
                        <p className="font-semibold text-sm md:text-base">{slot.label}</p>
                        <Badge variant="secondary" className="text-xs">
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
              <Button variant="outline" size="lg" onClick={handleBack}>
                <ArrowLeft className="mr-2" /> Back
              </Button>
              <Button 
                size="lg" 
                onClick={handleContinue} 
                disabled={!selectedDate || !selectedTime || checkingCredit || (useCredit && !creditAvailable)}
              >
                Continue <ArrowRight className="ml-2" />
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
      />
    </div>
  );
}

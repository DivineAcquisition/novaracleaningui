import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, ArrowLeft, Calendar as CalendarIcon, Clock, CreditCard, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { format, addDays, isAfter } from "date-fns";
import { MEMBERSHIP_PLANS } from "@/lib/pricing-system";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";

const BOOKING_STEPS = [
  { number: 1, label: "Location" },
  { number: 2, label: "Home Size" },
  { number: 3, label: "Service" },
  { number: 4, label: "Schedule" },
  { number: 5, label: "Details" },
  { number: 6, label: "Payment" },
];

const TIME_SLOTS = [
  { id: "8-12", label: "8:00 AM - 12:00 PM" },
  { id: "12-16", label: "12:00 PM - 4:00 PM" },
  { id: "16-20", label: "4:00 PM - 8:00 PM" },
];

export default function BookingSchedule() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { bookingData, updateBookingData, currentStep, setCurrentStep } = useBooking();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    bookingData.serviceDate ? new Date(bookingData.serviceDate) : undefined
  );
  const [selectedTime, setSelectedTime] = useState(bookingData.timeSlot || "");
  const [membershipPlan, setMembershipPlan] = useState(bookingData.membershipPlan || "none");
  const [useCredit, setUseCredit] = useState(bookingData.useCredit || false);
  const [creditAvailable, setCreditAvailable] = useState(false);
  const [creditAvailableDate, setCreditAvailableDate] = useState<string | null>(null);
  const [checkingCredit, setCheckingCredit] = useState(false);

  // Check credit availability when user wants to use credit
  useEffect(() => {
    const checkCreditAvailability = async () => {
      if (!useCredit || !user || !selectedDate) {
        return;
      }

      setCheckingCredit(true);
      try {
        const { data, error } = await supabase.functions.invoke('check-credit-availability', {
          body: { requestedDate: format(selectedDate, "yyyy-MM-dd") }
        });

        if (error) throw error;

        setCreditAvailable(data.available);
        setCreditAvailableDate(data.credit_available_date);

        if (!data.available) {
          toast.error(
            `Credit not available yet. Available from ${format(new Date(data.credit_available_date), "MMM dd, yyyy")}`
          );
        }
      } catch (error: any) {
        console.error('Error checking credit:', error);
        toast.error('Failed to check credit availability');
        setUseCredit(false);
      } finally {
        setCheckingCredit(false);
      }
    };

    checkCreditAvailability();
  }, [useCredit, user, selectedDate]);

  const handleContinue = () => {
    if (!selectedDate || !selectedTime) {
      return;
    }

    // Prevent continue if user wants to use credit but it's not available
    if (useCredit && !creditAvailable) {
      toast.error('Please wait until credit is available or uncheck "Use membership credit"');
      return;
    }
    
    updateBookingData({
      serviceDate: format(selectedDate, "yyyy-MM-dd"),
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

  const minDate = addDays(new Date(), 2);

  return (
    <div className="min-h-screen bg-gradient-hero">
      <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
      
      <div className="container max-w-6xl mx-auto px-4 py-8">
        <Card className="shadow-xl animate-fade-in">
          <CardHeader className="text-center space-y-2 pb-8 bg-gradient-to-br from-primary/5 to-transparent">
            <div className="mx-auto w-16 h-16 bg-gradient-primary rounded-full flex items-center justify-center mb-4 shadow-lavender">
              <CalendarIcon className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-3xl font-bold">Schedule your cleaning</CardTitle>
            <CardDescription className="text-base">
              Choose your membership plan, date, and time
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-8">
            {/* Membership Selection */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CreditCard className="w-6 h-6 text-primary" />
                <h3 className="text-xl font-semibold">Choose membership plan</h3>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {Object.entries(MEMBERSHIP_PLANS).map(([key, plan]) => (
                  <Card
                    key={key}
                    className={cn(
                      "cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-105 relative group",
                      membershipPlan === key && "ring-2 ring-primary shadow-lavender scale-105"
                    )}
                    onClick={() => setMembershipPlan(key)}
                  >
                    {plan.credits > 0 && (
                      <Badge className="absolute -top-2 -right-2 bg-success shadow-md">
                        {plan.credits} credit{plan.credits > 1 ? 's' : ''}
                      </Badge>
                    )}
                    <CardContent className="p-5 space-y-2">
                      <h4 className="font-bold text-base">{plan.label}</h4>
                      {plan.monthlyPrice > 0 ? (
                        <p className="text-xl font-semibold text-primary">${plan.monthlyPrice}/mo</p>
                      ) : (
                        <p className="text-xl font-semibold text-muted-foreground">One-time</p>
                      )}
                      <p className="text-xs text-muted-foreground leading-relaxed">{plan.description}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
              
              {membershipPlan !== 'none' && (
                <div className="space-y-2">
                  <div className="flex items-center space-x-2 p-4 bg-muted/50 rounded-lg">
                    <Checkbox 
                      id="use-credit"
                      checked={useCredit}
                      onCheckedChange={(checked) => setUseCredit(checked as boolean)}
                      disabled={checkingCredit}
                    />
                    <label
                      htmlFor="use-credit"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      Use membership credit for this booking
                    </label>
                  </div>
                  
                  {useCredit && !creditAvailable && creditAvailableDate && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        Credit available from {format(new Date(creditAvailableDate), "MMMM dd, yyyy")}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
            </div>

            {/* Date Selection */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-6 h-6 text-primary" />
                <h3 className="text-xl font-semibold">Select a date</h3>
              </div>
              <div className="flex justify-center p-4 bg-gradient-to-br from-primary/5 to-transparent rounded-lg">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  disabled={(date) => !isAfter(date, minDate)}
                  className="rounded-lg border-2 border-primary/20 shadow-md bg-background pointer-events-auto"
                />
              </div>
              {selectedDate && (
                <p className="text-center text-sm text-muted-foreground animate-fade-in">
                  Selected: {format(selectedDate, "EEEE, MMMM d, yyyy")}
                </p>
              )}
            </div>

            {/* Time Slot Selection */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Clock className="w-6 h-6 text-primary" />
                <h3 className="text-xl font-semibold">Preferred time window</h3>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {TIME_SLOTS.map((slot, index) => (
                  <Card
                    key={slot.id}
                    className={cn(
                      "cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-105 group",
                      selectedTime === slot.id && "ring-2 ring-primary shadow-lavender scale-105"
                    )}
                    onClick={() => setSelectedTime(slot.id)}
                    style={{ animationDelay: `${index * 0.1}s` }}
                  >
                    <CardContent className="p-6 text-center space-y-3">
                      <div className={cn(
                        "mx-auto w-12 h-12 rounded-full flex items-center justify-center transition-all",
                        selectedTime === slot.id ? "bg-gradient-primary shadow-lavender" : "bg-primary/10 group-hover:bg-primary/20"
                      )}>
                        <Clock className={cn(
                          "w-6 h-6 transition-colors",
                          selectedTime === slot.id ? "text-white" : "text-primary"
                        )} />
                      </div>
                      <p className="font-semibold text-sm">{slot.label}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            <div className="flex gap-4 pt-6">
              <Button
                variant="outline"
                size="lg"
                onClick={handleBack}
                className="h-14"
              >
                <ArrowLeft className="mr-2 w-5 h-5" />
                Back
              </Button>
              <Button
                size="lg"
                className="flex-1 h-14 text-base font-semibold"
                onClick={handleContinue}
                disabled={!selectedDate || !selectedTime || checkingCredit || (useCredit && !creditAvailable)}
              >
                Continue
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

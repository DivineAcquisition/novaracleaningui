import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, ArrowLeft, Calendar as CalendarIcon, Clock, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { format, addDays, isAfter } from "date-fns";
import { MEMBERSHIP_PLANS } from "@/lib/pricing-system";

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
  const { bookingData, updateBookingData, currentStep, setCurrentStep } = useBooking();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    bookingData.serviceDate ? new Date(bookingData.serviceDate) : undefined
  );
  const [selectedTime, setSelectedTime] = useState(bookingData.timeSlot || "");
  const [membershipPlan, setMembershipPlan] = useState(bookingData.membershipPlan || "none");
  const [useCredit, setUseCredit] = useState(bookingData.useCredit || false);

  const handleContinue = () => {
    if (!selectedDate || !selectedTime) {
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
      
      <div className="container max-w-5xl mx-auto px-4 py-8">
        <Card className="shadow-xl">
          <CardHeader className="text-center space-y-2 pb-8">
            <CardTitle className="text-3xl font-bold">Schedule your cleaning</CardTitle>
            <CardDescription className="text-base">
              Choose your membership plan, date, and time
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-8">
            {/* Membership Selection */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-primary" />
                <h3 className="text-xl font-semibold">Choose membership plan</h3>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {Object.entries(MEMBERSHIP_PLANS).map(([key, plan]) => (
                  <Card
                    key={key}
                    className={cn(
                      "cursor-pointer transition-all duration-300 hover:shadow-md relative",
                      membershipPlan === key && "ring-2 ring-primary shadow-md"
                    )}
                    onClick={() => setMembershipPlan(key)}
                  >
                    {plan.credits > 0 && (
                      <Badge className="absolute -top-2 -right-2 bg-success">
                        {plan.credits} credit{plan.credits > 1 ? 's' : ''}
                      </Badge>
                    )}
                    <CardContent className="p-4 space-y-2">
                      <h4 className="font-bold">{plan.label}</h4>
                      {plan.monthlyPrice > 0 && (
                        <p className="text-lg font-semibold text-primary">${plan.monthlyPrice}/mo</p>
                      )}
                      <p className="text-xs text-muted-foreground">{plan.description}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
              
              {membershipPlan !== 'none' && (
                <div className="flex items-center space-x-2 p-4 bg-muted/50 rounded-lg">
                  <Checkbox 
                    id="use-credit"
                    checked={useCredit}
                    onCheckedChange={(checked) => setUseCredit(checked as boolean)}
                  />
                  <label
                    htmlFor="use-credit"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    Use membership credit for this booking
                  </label>
                </div>
              )}
            </div>

            {/* Date Selection */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-5 h-5 text-primary" />
                <h3 className="text-xl font-semibold">Select a date</h3>
              </div>
              <div className="flex justify-center">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  disabled={(date) => !isAfter(date, minDate)}
                  className="rounded-md border"
                />
              </div>
            </div>

            {/* Time Slot Selection */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                <h3 className="text-xl font-semibold">Preferred time window</h3>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {TIME_SLOTS.map((slot) => (
                  <Card
                    key={slot.id}
                    className={cn(
                      "cursor-pointer transition-all duration-300 hover:shadow-md",
                      selectedTime === slot.id && "ring-2 ring-primary shadow-md"
                    )}
                    onClick={() => setSelectedTime(slot.id)}
                  >
                    <CardContent className="p-4 text-center">
                      <p className="font-semibold">{slot.label}</p>
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
                disabled={!selectedDate || !selectedTime}
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

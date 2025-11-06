import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { ArrowRight, ArrowLeft, Calendar as CalendarIcon, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { format, addDays, isAfter } from "date-fns";

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

const FREQUENCIES = [
  { id: "one_time", label: "One-time", discount: 0, description: "Perfect for a one-time clean" },
  { id: "weekly", label: "Weekly", discount: 15, description: "Save 15% on recurring service" },
  { id: "biweekly", label: "Bi-weekly", discount: 10, description: "Save 10% on recurring service" },
  { id: "monthly", label: "Monthly", discount: 5, description: "Save 5% on recurring service" },
];

export default function BookingSchedule() {
  const navigate = useNavigate();
  const { bookingData, updateBookingData, currentStep, setCurrentStep } = useBooking();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    bookingData.serviceDate ? new Date(bookingData.serviceDate) : undefined
  );
  const [selectedTime, setSelectedTime] = useState(bookingData.timeSlot || "");
  const [frequency, setFrequency] = useState(bookingData.frequency || "one_time");

  const handleContinue = () => {
    if (!selectedDate || !selectedTime || !frequency) {
      return;
    }
    
    updateBookingData({
      serviceDate: format(selectedDate, "yyyy-MM-dd"),
      timeSlot: selectedTime,
      frequency,
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
              Choose your preferred date, time, and frequency
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-8">
            {/* Frequency Selection */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-5 h-5 text-primary" />
                <h3 className="text-xl font-semibold">How often?</h3>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {FREQUENCIES.map((freq) => (
                  <Card
                    key={freq.id}
                    className={cn(
                      "cursor-pointer transition-all duration-300 hover:shadow-md",
                      frequency === freq.id && "ring-2 ring-primary shadow-md"
                    )}
                    onClick={() => setFrequency(freq.id)}
                  >
                    <CardContent className="p-4 text-center space-y-2">
                      <h4 className="font-bold">{freq.label}</h4>
                      {freq.discount > 0 && (
                        <p className="text-sm font-semibold text-success">Save {freq.discount}%</p>
                      )}
                      <p className="text-xs text-muted-foreground">{freq.description}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
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
                disabled={!selectedDate || !selectedTime || !frequency}
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

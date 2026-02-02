"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { HOME_SIZE_RANGES, SERVICE_TIER_PRICING } from "@/lib/pricing-system";
import { format, isBefore, startOfDay } from "date-fns";

const TIME_SLOTS = [
  { id: "8:00 AM - 10:00 AM", label: "8:00 AM - 10:00 AM", period: "Morning" },
  { id: "10:00 AM - 12:00 PM", label: "10:00 AM - 12:00 PM", period: "Morning" },
  { id: "1:00 PM - 3:00 PM", label: "1:00 PM - 3:00 PM", period: "Afternoon" },
  { id: "3:00 PM - 5:00 PM", label: "3:00 PM - 5:00 PM", period: "Afternoon" },
];

export default function BookingOffer() {
  const router = useRouter();
  const { bookingData, updateBookingData, setCurrentStep } = useBooking();
  
  const [selectedService, setSelectedService] = useState<"deep" | "recurring">(
    bookingData.membershipPlan !== "none" ? "recurring" : "deep"
  );
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    bookingData.serviceDate ? new Date(bookingData.serviceDate + "T12:00:00") : undefined
  );
  const [selectedTime, setSelectedTime] = useState(bookingData.timeSlot || "");

  const selectedHomeSize = useMemo(() => {
    return HOME_SIZE_RANGES.find((h) => h.id === bookingData.homeSizeId);
  }, [bookingData.homeSizeId]);

  const prices = useMemo(() => {
    const basePrice = selectedHomeSize?.standardPrice || 150;
    const deepCleanPrice = basePrice + SERVICE_TIER_PRICING.deep.addition;
    const recurringPrice = Math.round(basePrice * 0.85);

    return {
      deep: deepCleanPrice,
      recurring: recurringPrice,
      savings: basePrice - recurringPrice,
    };
  }, [selectedHomeSize]);

  const handleContinue = () => {
    if (!selectedDate || !selectedTime) return;

    updateBookingData({
      serviceType: selectedService === "deep" ? "Deep Clean" : "Standard Clean",
      membershipPlan: selectedService === "recurring" ? "biweekly" : "none",
      serviceDate: format(selectedDate, "yyyy-MM-dd"),
      timeSlot: selectedTime,
    });
    setCurrentStep(4);
    router.push("/book/checkout");
  };

  const handleBack = () => {
    setCurrentStep(2);
    router.push("/book/sqft");
  };

  const canContinue = selectedDate && selectedTime;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-primary/[0.02] to-background">
      {/* Header */}
      <header className="border-b border-border/50 backdrop-blur-sm bg-background/80 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <Link href="/" className="flex items-center gap-2.5 w-fit">
            <div className="w-9 h-9 rounded-xl bg-primary glow-primary-sm flex items-center justify-center">
              <i className="ri-sparkling-2-fill text-white text-lg"></i>
            </div>
            <span className="font-semibold text-lg">NovaraCleaning</span>
          </Link>
        </div>
      </header>

      <main className="container max-w-3xl mx-auto px-4 py-8 md:py-12">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between text-sm mb-3">
            <span className="text-muted-foreground">Step 3 of 5</span>
            <span className="font-medium">Service & Schedule</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary glow-primary-sm rounded-full transition-all duration-500" style={{ width: "60%" }} />
          </div>
        </div>

        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <i className="ri-sparkling-fill text-primary text-3xl"></i>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold mb-2">Choose Your Service</h1>
          <p className="text-muted-foreground">
            {selectedHomeSize?.label} • {selectedHomeSize?.bedroomRange}
          </p>
        </div>

        {/* Service Selection */}
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          {/* Deep Clean Option */}
          <Card
            onClick={() => setSelectedService("deep")}
            className={cn(
              "cursor-pointer transition-all duration-300 relative overflow-hidden",
              selectedService === "deep" ? "card-selected" : "card-premium-hover"
            )}
          >
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <Badge className="bg-amber-100 text-amber-700 border-0">
                  <i className="ri-fire-fill mr-1"></i>
                  Popular
                </Badge>
                {selectedService === "deep" && (
                  <div className="w-6 h-6 rounded-full bg-primary glow-primary-sm flex items-center justify-center">
                    <i className="ri-check-line text-white text-sm"></i>
                  </div>
                )}
              </div>
              
              <div className="flex items-center gap-3 mb-3">
                <div className={cn(
                  "w-11 h-11 rounded-xl flex items-center justify-center",
                  selectedService === "deep" ? "bg-primary text-white" : "bg-muted"
                )}>
                  <i className="ri-sparkles-fill text-xl"></i>
                </div>
                <h3 className="font-semibold text-lg">One-Time Deep Clean</h3>
              </div>
              
              <p className="text-sm text-muted-foreground mb-4">
                Thorough cleaning with our 40-point checklist
              </p>
              
              <div className="pt-4 border-t border-border/50">
                <p className="text-3xl font-bold text-primary">${prices.deep}</p>
                <p className="text-xs text-muted-foreground">one-time service</p>
              </div>
            </CardContent>
          </Card>

          {/* Recurring Option */}
          <Card
            onClick={() => setSelectedService("recurring")}
            className={cn(
              "cursor-pointer transition-all duration-300 relative overflow-hidden",
              selectedService === "recurring" ? "card-selected" : "card-premium-hover"
            )}
          >
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <Badge className="bg-green-100 text-green-700 border-0">
                  <i className="ri-percent-fill mr-1"></i>
                  Save 15%
                </Badge>
                {selectedService === "recurring" && (
                  <div className="w-6 h-6 rounded-full bg-primary glow-primary-sm flex items-center justify-center">
                    <i className="ri-check-line text-white text-sm"></i>
                  </div>
                )}
              </div>
              
              <div className="flex items-center gap-3 mb-3">
                <div className={cn(
                  "w-11 h-11 rounded-xl flex items-center justify-center",
                  selectedService === "recurring" ? "bg-primary text-white" : "bg-muted"
                )}>
                  <i className="ri-calendar-check-fill text-xl"></i>
                </div>
                <h3 className="font-semibold text-lg">Recurring Service</h3>
              </div>
              
              <p className="text-sm text-muted-foreground mb-4">
                Bi-weekly cleaning with your dedicated team
              </p>
              
              <div className="pt-4 border-t border-border/50">
                <div className="flex items-baseline gap-2">
                  <p className="text-3xl font-bold text-primary">${prices.recurring}</p>
                  <p className="text-sm text-muted-foreground line-through">${selectedHomeSize?.standardPrice}</p>
                </div>
                <p className="text-xs text-muted-foreground">per clean • cancel anytime</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Schedule Selection */}
        <Card className="card-premium mb-8">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
                <i className="ri-calendar-line text-primary text-xl"></i>
              </div>
              <div>
                <h3 className="font-semibold text-lg">Select Date & Time</h3>
                <p className="text-sm text-muted-foreground">Choose when you&apos;d like us to come</p>
              </div>
            </div>
            
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Date</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full h-12 justify-start text-left font-normal border-2",
                        !selectedDate && "text-muted-foreground"
                      )}
                    >
                      <i className="ri-calendar-line mr-2 text-lg"></i>
                      {selectedDate ? format(selectedDate, "EEEE, MMMM d") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={setSelectedDate}
                      disabled={(date) => isBefore(date, startOfDay(new Date()))}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Time</label>
                <Select value={selectedTime} onValueChange={setSelectedTime}>
                  <SelectTrigger className="h-12 border-2">
                    <SelectValue placeholder="Select time slot" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_SLOTS.map((slot) => (
                      <SelectItem key={slot.id} value={slot.id}>
                        <div className="flex items-center gap-2">
                          <i className="ri-time-line"></i>
                          {slot.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Navigation */}
        <div className="flex gap-3">
          <Button variant="outline" onClick={handleBack} className="h-12 px-6">
            <i className="ri-arrow-left-line mr-2"></i>
            Back
          </Button>
          <Button
            className="flex-1 h-12 glow-primary-sm"
            onClick={handleContinue}
            disabled={!canContinue}
          >
            Continue to Checkout
            <i className="ri-arrow-right-line ml-2"></i>
          </Button>
        </div>
      </main>
    </div>
  );
}

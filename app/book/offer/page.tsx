"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, ArrowLeft, Sparkles, CalendarIcon, Clock, Check } from "lucide-react";
import { HOME_SIZE_RANGES, SERVICE_TIER_PRICING } from "@/lib/pricing-system";
import { format, addDays, isBefore, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";

const TIME_SLOTS = [
  { id: "8:00 AM - 10:00 AM", label: "8:00 AM - 10:00 AM" },
  { id: "10:00 AM - 12:00 PM", label: "10:00 AM - 12:00 PM" },
  { id: "1:00 PM - 3:00 PM", label: "1:00 PM - 3:00 PM" },
  { id: "3:00 PM - 5:00 PM", label: "3:00 PM - 5:00 PM" },
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
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto px-4 py-8">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
            <span>Step 3 of 5</span>
            <span>Service & Schedule</span>
          </div>
          <div className="h-2 bg-muted rounded-full">
            <div className="h-full bg-primary rounded-full" style={{ width: "60%" }} />
          </div>
        </div>

        {/* Service Selection */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              Choose Your Service
            </CardTitle>
            <CardDescription>
              {selectedHomeSize?.label} • {selectedHomeSize?.bedroomRange}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={selectedService}
              onValueChange={(v) => setSelectedService(v as "deep" | "recurring")}
              className="space-y-3"
            >
              <div className="flex items-center">
                <RadioGroupItem value="deep" id="deep" className="peer sr-only" />
                <Label
                  htmlFor="deep"
                  className="flex flex-1 items-center justify-between p-4 border rounded-lg cursor-pointer hover:bg-muted/50 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">One-Time Deep Clean</p>
                      <Badge variant="secondary">Popular</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Thorough cleaning with 40-point checklist
                    </p>
                  </div>
                  <p className="text-lg font-semibold">${prices.deep}</p>
                </Label>
              </div>

              <div className="flex items-center">
                <RadioGroupItem value="recurring" id="recurring" className="peer sr-only" />
                <Label
                  htmlFor="recurring"
                  className="flex flex-1 items-center justify-between p-4 border rounded-lg cursor-pointer hover:bg-muted/50 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">Recurring Service</p>
                      <Badge className="bg-green-100 text-green-700">Save 15%</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Bi-weekly cleaning with the same team
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold">${prices.recurring}</p>
                    <p className="text-xs text-muted-foreground">/clean</p>
                  </div>
                </Label>
              </div>
            </RadioGroup>
          </CardContent>
        </Card>

        {/* Schedule Selection */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarIcon className="w-5 h-5" />
              Select Date & Time
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !selectedDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {selectedDate ? format(selectedDate, "PPP") : "Pick a date"}
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

            <div className="space-y-2">
              <Label>Time</Label>
              <Select value={selectedTime} onValueChange={setSelectedTime}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a time slot" />
                </SelectTrigger>
                <SelectContent>
                  {TIME_SLOTS.map((slot) => (
                    <SelectItem key={slot.id} value={slot.id}>
                      {slot.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Navigation */}
        <div className="flex gap-3">
          <Button variant="outline" onClick={handleBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <Button className="flex-1" onClick={handleContinue} disabled={!canContinue}>
            Continue
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { useBooking } from "@/app/providers";
import { supabase } from "@/lib/supabase";
import { format, addDays, isBefore, startOfDay } from "date-fns";
import {
  Sparkles,
  CheckCircle,
  Crown,
  CalendarDays,
  Clock,
  ArrowRight,
  Loader2,
  Gift,
} from "lucide-react";
import { toast } from "sonner";

const timeSlots = [
  "8:00 AM - 10:00 AM",
  "9:00 AM - 11:00 AM",
  "10:00 AM - 12:00 PM",
  "11:00 AM - 1:00 PM",
  "12:00 PM - 2:00 PM",
  "1:00 PM - 3:00 PM",
  "2:00 PM - 4:00 PM",
  "3:00 PM - 5:00 PM",
];

export default function OfferPage() {
  const router = useRouter();
  const { bookingData, updateBookingData } = useBooking();
  const [selectedOffer, setSelectedOffer] = useState<"deep_clean" | "membership" | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const minDate = addDays(new Date(), 2); // At least 2 days out
  const maxDate = addDays(new Date(), 60); // Up to 60 days out

  const deepCleanPrice = 19900; // $199
  const membershipPrice = 18900; // $189/month

  const handleContinue = async () => {
    if (!selectedOffer) {
      toast.error("Please select a service option");
      return;
    }
    if (!selectedDate) {
      toast.error("Please select a date");
      return;
    }
    if (!selectedTime) {
      toast.error("Please select a time slot");
      return;
    }

    setIsLoading(true);
    try {
      const dateStr = format(selectedDate, "yyyy-MM-dd");

      // Check availability
      const { data: slots, error } = await supabase
        .from("availability_slots")
        .select("*")
        .eq("date", dateStr)
        .eq("time_slot", selectedTime)
        .eq("is_available", true)
        .single();

      if (error || !slots) {
        // Slot might not exist in DB, but we'll allow booking anyway for MVP
        console.log("No slot found, proceeding anyway");
      }

      updateBookingData({
        offerType: selectedOffer,
        serviceDate: dateStr,
        timeSlot: selectedTime,
        serviceType: selectedOffer === "membership" ? "Standard Clean" : "Deep Clean",
      });

      router.push("/checkout");
    } catch (error) {
      console.error("Error checking availability:", error);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="text-center space-y-4">
        <h1 className="text-3xl md:text-4xl font-bold">
          Choose Your Service
        </h1>
        <p className="text-lg text-muted-foreground max-w-xl mx-auto">
          Select the perfect cleaning plan for your home
        </p>
      </div>

      {/* Offer Cards */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Deep Clean Option */}
        <Card
          className={`cursor-pointer transition-all ${
            selectedOffer === "deep_clean"
              ? "ring-2 ring-primary shadow-lg"
              : "hover:shadow-md"
          }`}
          onClick={() => setSelectedOffer("deep_clean")}
        >
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <Sparkles className="h-6 w-6 text-blue-600" />
              </div>
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                Save $50
              </Badge>
            </div>
            <CardTitle className="mt-4">One-Time Deep Clean</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold">$149</span>
                <span className="text-muted-foreground line-through">$199</span>
              </div>
              <p className="text-sm text-muted-foreground">with code NEWYEAR</p>
            </div>

            <ul className="space-y-2">
              {[
                "Deep cleaning of all rooms",
                "Inside appliances & cabinets",
                "Baseboards & light fixtures",
                "No commitment required",
              ].map((feature, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                  {feature}
                </li>
              ))}
            </ul>

            <Button
              variant={selectedOffer === "deep_clean" ? "default" : "outline"}
              className="w-full"
            >
              {selectedOffer === "deep_clean" ? "Selected" : "Select"}
            </Button>
          </CardContent>
        </Card>

        {/* Membership Option */}
        <Card
          className={`cursor-pointer transition-all relative overflow-hidden ${
            selectedOffer === "membership"
              ? "ring-2 ring-primary shadow-lg"
              : "hover:shadow-md"
          }`}
          onClick={() => setSelectedOffer("membership")}
        >
          <div className="absolute top-0 right-0 bg-gradient-to-l from-primary to-accent text-white px-4 py-1 text-sm font-medium">
            Best Value
          </div>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                <Crown className="h-6 w-6 text-primary" />
              </div>
            </div>
            <CardTitle className="mt-4">Novara Membership</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold">$189</span>
                <span className="text-muted-foreground">/month</span>
              </div>
              <p className="text-sm text-green-600 font-medium">First clean included!</p>
            </div>

            <ul className="space-y-2">
              {[
                "Monthly standard cleaning",
                "Priority scheduling",
                "Same cleaner each visit",
                "10% off additional services",
                "Pause or cancel anytime",
              ].map((feature, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                  {feature}
                </li>
              ))}
            </ul>

            <Button
              variant={selectedOffer === "membership" ? "default" : "outline"}
              className="w-full"
            >
              {selectedOffer === "membership" ? "Selected" : "Select"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Schedule Picker - Shows after selection */}
      {selectedOffer && (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              Choose Your Date & Time
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              {/* Date Picker */}
              <div className="space-y-2">
                <Label>Select Date</Label>
                <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-start text-left font-normal h-12"
                    >
                      <CalendarDays className="mr-2 h-4 w-4" />
                      {selectedDate ? (
                        format(selectedDate, "EEEE, MMMM d, yyyy")
                      ) : (
                        <span className="text-muted-foreground">Pick a date</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(date) => {
                        setSelectedDate(date);
                        setCalendarOpen(false);
                      }}
                      disabled={(date) =>
                        isBefore(date, startOfDay(minDate)) ||
                        isBefore(maxDate, date)
                      }
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Time Picker */}
              <div className="space-y-2">
                <Label>Select Time Slot</Label>
                <div className="grid grid-cols-2 gap-2">
                  {timeSlots.map((slot) => (
                    <Button
                      key={slot}
                      variant={selectedTime === slot ? "default" : "outline"}
                      className="h-auto py-2 px-3 text-sm"
                      onClick={() => setSelectedTime(slot)}
                    >
                      <Clock className="h-3 w-3 mr-1.5" />
                      {slot}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <Button
              size="lg"
              className="w-full h-14 text-lg"
              onClick={handleContinue}
              disabled={isLoading || !selectedDate || !selectedTime}
            >
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  Continue to Checkout
                  <ArrowRight className="ml-2 h-5 w-5" />
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Promo reminder */}
      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Gift className="h-4 w-4" />
        <span>
          Use code <span className="font-semibold text-primary">NEWYEAR</span> for $50 off
        </span>
      </div>
    </div>
  );
}

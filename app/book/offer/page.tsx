"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Check, Clock, Calendar, ArrowRight, Gift } from "lucide-react";
import { cn } from "@/lib/utils";
import { BookingHeader } from "@/components/booking/BookingHeader";
import { BookingFooter } from "@/components/booking/BookingFooter";
import { SchedulePicker } from "@/components/booking/SchedulePicker";
import { HOME_SIZE_RANGES, SERVICE_TIER_PRICING, DEPOSIT_AMOUNT } from "@/lib/pricing-system";
import { motion } from "framer-motion";
import { format } from "date-fns";

const DEEP_CLEAN_DISCOUNT = 50;

const DEEP_CLEAN_FEATURES = [
  "40-point Deep Clean checklist",
  "2-person professional team",
  "All supplies included",
  "48-hour re-clean guarantee",
];

const RECURRING_FEATURES = [
  "15% off every clean",
  "Same trusted team",
  "Priority scheduling",
  "Cancel anytime",
];

export default function BookingOffer() {
  const router = useRouter();
  const { bookingData, updateBookingData, setCurrentStep } = useBooking();
  const [selectedService, setSelectedService] = useState<"deep" | "recurring" | null>(
    bookingData.serviceType === "recurring" ? "recurring" : bookingData.serviceType ? "deep" : null
  );
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    bookingData.serviceDate ? new Date(bookingData.serviceDate + "T12:00:00") : undefined
  );
  const [selectedTime, setSelectedTime] = useState<string>(bookingData.timeSlot || "");

  const handleTimeSelect = (date: Date, timeSlot: string, startTime: string, endTime: string) => {
    setSelectedTime(timeSlot);
  };

  const selectedHomeSize = useMemo(() => {
    return HOME_SIZE_RANGES.find((h) => h.id === bookingData.homeSizeId);
  }, [bookingData.homeSizeId]);

  const prices = useMemo(() => {
    const basePrice = selectedHomeSize?.standardPrice || 150;
    const deepCleanPrice = basePrice + SERVICE_TIER_PRICING.deep.addition;
    const discountedDeepClean = deepCleanPrice - DEEP_CLEAN_DISCOUNT;
    const recurringPrice = Math.round(basePrice * 0.85);

    return {
      deep: {
        original: deepCleanPrice,
        discounted: discountedDeepClean,
        deposit: Math.round(discountedDeepClean * 0.25),
      },
      recurring: {
        original: basePrice,
        discounted: recurringPrice,
        deposit: Math.round(recurringPrice * 0.25),
      },
    };
  }, [selectedHomeSize]);

  const handleContinue = () => {
    if (!selectedService || !selectedDate || !selectedTime) return;

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

  const canContinue = selectedService && selectedDate && selectedTime;

  return (
    <div className="min-h-screen bg-gradient-hero pb-24">
      <BookingHeader currentStep={3} totalSteps={6} stepLabel="Service" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="container max-w-4xl mx-auto px-4 py-8"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-primary text-white rounded-full text-sm font-medium mb-4"
          >
            <Gift className="w-4 h-4" />
            New Year Special - Save $50!
          </motion.div>
          <h1 className="text-2xl md:text-3xl font-bold mb-2">Choose Your Service</h1>
          <p className="text-muted-foreground">
            {selectedHomeSize?.label} • {selectedHomeSize?.bedroomRange}
          </p>
        </div>

        {/* Service Options */}
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          {/* Deep Clean Option */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card
              className={cn(
                "cursor-pointer transition-all duration-300 relative overflow-hidden h-full",
                selectedService === "deep"
                  ? "border-primary border-2 ring-4 ring-primary/20 shadow-xl"
                  : "border-border hover:border-primary/50 hover:shadow-lg hover:-translate-y-1"
              )}
              onClick={() => setSelectedService("deep")}
            >
              {selectedService === "deep" && (
                <div className="absolute top-3 right-3">
                  <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                </div>
              )}
              <CardHeader className="pb-2">
                <Badge className="w-fit bg-amber-500/10 text-amber-600 border-amber-500/20 mb-2">
                  Most Popular
                </Badge>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  One-Time Deep Clean
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-4">
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-primary">
                      ${prices.deep.discounted}
                    </span>
                    <span className="text-lg text-muted-foreground line-through">
                      ${prices.deep.original}
                    </span>
                  </div>
                  <p className="text-sm text-green-600 font-medium">Save $50 today!</p>
                </div>
                <ul className="space-y-2">
                  {DEEP_CLEAN_FEATURES.map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 pt-4 border-t">
                  <p className="text-sm text-muted-foreground">
                    Only <span className="font-semibold text-foreground">${prices.deep.deposit}</span> deposit today
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Recurring Option */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card
              className={cn(
                "cursor-pointer transition-all duration-300 relative overflow-hidden h-full",
                selectedService === "recurring"
                  ? "border-primary border-2 ring-4 ring-primary/20 shadow-xl"
                  : "border-border hover:border-primary/50 hover:shadow-lg hover:-translate-y-1"
              )}
              onClick={() => setSelectedService("recurring")}
            >
              {selectedService === "recurring" && (
                <div className="absolute top-3 right-3">
                  <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                </div>
              )}
              <CardHeader className="pb-2">
                <Badge className="w-fit bg-green-500/10 text-green-600 border-green-500/20 mb-2">
                  Best Value
                </Badge>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-primary" />
                  Recurring Service
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-4">
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-primary">
                      ${prices.recurring.discounted}
                    </span>
                    <span className="text-lg text-muted-foreground line-through">
                      ${prices.recurring.original}
                    </span>
                    <span className="text-sm text-muted-foreground">/clean</span>
                  </div>
                  <p className="text-sm text-green-600 font-medium">15% off every clean</p>
                </div>
                <ul className="space-y-2">
                  {RECURRING_FEATURES.map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 pt-4 border-t">
                  <p className="text-sm text-muted-foreground">
                    Only <span className="font-semibold text-foreground">${prices.recurring.deposit}</span> deposit today
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Schedule Picker */}
        {selectedService && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Card className="mb-8">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-primary" />
                  Select Date & Time
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SchedulePicker
                  selectedDate={selectedDate}
                  selectedTime={selectedTime}
                  onDateSelect={setSelectedDate}
                  onTimeSelect={handleTimeSelect}
                />
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Navigation */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="flex justify-between"
        >
          <Button variant="outline" onClick={handleBack}>
            ← Back
          </Button>
          <Button
            onClick={handleContinue}
            disabled={!canContinue}
            className="bg-gradient-primary min-w-[200px]"
          >
            Continue to Checkout
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </motion.div>
      </motion.div>

      <BookingFooter />
    </div>
  );
}

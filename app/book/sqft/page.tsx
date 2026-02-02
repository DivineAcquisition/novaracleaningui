"use client";

import { useRouter } from "next/navigation";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Home as HomeIcon, CheckCircle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { BookingHeader } from "@/components/booking/BookingHeader";
import { BookingFooter } from "@/components/booking/BookingFooter";
import { HOME_SIZE_RANGES } from "@/lib/pricing-system";
import { motion } from "framer-motion";

export default function BookingSqft() {
  const router = useRouter();
  const { bookingData, updateBookingData, setCurrentStep } = useBooking();

  const handleSelect = (sizeId: string) => {
    if (sizeId === "5000_plus") {
      router.push("/book/custom-quote");
      return;
    }

    updateBookingData({ homeSizeId: sizeId });
    setCurrentStep(3);
    router.push("/book/offer");
  };

  const handleBack = () => {
    setCurrentStep(1);
    router.push("/book/zip");
  };

  return (
    <div className="min-h-screen bg-gradient-hero">
      <BookingHeader currentStep={2} totalSteps={6} stepLabel="Home Size" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="container max-w-3xl mx-auto px-4 py-8 md:py-12"
      >
        {/* Header */}
        <div className="text-center mb-8 md:mb-10">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.3 }}
            className="mx-auto w-16 h-16 bg-gradient-primary rounded-2xl flex items-center justify-center mb-4 shadow-lg"
          >
            <HomeIcon className="w-8 h-8 text-white" />
          </motion.div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            How big is your home?
          </h1>
          <p className="text-muted-foreground">
            Select your home size to see instant pricing
          </p>

          {/* Google Guaranteed Badge */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="inline-flex items-center gap-2 mt-4 px-4 py-2 border-2 border-green-500 rounded-full bg-green-50 dark:bg-green-950/30"
          >
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span className="text-sm font-medium text-green-700 dark:text-green-300">
              Google Guaranteed
            </span>
          </motion.div>
        </div>

        {/* Size Selection Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {HOME_SIZE_RANGES.filter((size) => size.id !== "5000_plus").map((size, index) => {
            const isSelected = bookingData.homeSizeId === size.id;
            return (
              <motion.div
                key={size.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + index * 0.05 }}
              >
                <Card
                  className={cn(
                    "cursor-pointer transition-all duration-300 hover:border-primary/60 hover:shadow-lg bg-background relative group",
                    isSelected
                      ? "border-primary border-2 ring-4 ring-primary/20 shadow-lg"
                      : "border-border hover:-translate-y-1"
                  )}
                  onClick={() => handleSelect(size.id)}
                >
                  {isSelected && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center shadow-md"
                    >
                      <CheckCircle className="w-4 h-4 text-white" />
                    </motion.div>
                  )}
                  <CardContent className="p-6 text-center">
                    <h3 className="text-lg font-bold text-foreground mb-1">{size.label}</h3>
                    <p className="text-sm text-muted-foreground mb-3">{size.bedroomRange}</p>
                    <div className="space-y-1">
                      <p className="text-2xl font-bold text-primary">${size.standardPrice}</p>
                      <p className="text-xs text-muted-foreground">Starting price</p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* Large Home Option */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          <Card
            className="cursor-pointer transition-all duration-300 hover:border-primary/60 hover:shadow-lg bg-gradient-lavender border-primary/20"
            onClick={() => handleSelect("5000_plus")}
          >
            <CardContent className="p-6 text-center">
              <h3 className="text-lg font-bold text-foreground mb-1">5,000+ sq ft</h3>
              <p className="text-sm text-muted-foreground">
                Large homes need custom quotes. We&apos;ll contact you within 24 hours.
              </p>
              <Button variant="link" className="mt-2 text-primary">
                Get Custom Quote <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </CardContent>
          </Card>
        </motion.div>

        {/* Navigation */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="flex justify-between mt-8"
        >
          <Button variant="outline" onClick={handleBack}>
            ← Back
          </Button>
          <Button
            onClick={() => bookingData.homeSizeId && handleSelect(bookingData.homeSizeId)}
            disabled={!bookingData.homeSizeId}
            className="bg-gradient-primary"
          >
            Continue <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </motion.div>
      </motion.div>

      <BookingFooter />
    </div>
  );
}

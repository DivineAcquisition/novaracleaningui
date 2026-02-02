"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { HOME_SIZE_RANGES } from "@/lib/pricing-system";

export default function BookingSqft() {
  const router = useRouter();
  const { bookingData, updateBookingData, setCurrentStep } = useBooking();

  const handleSelect = (sizeId: string) => {
    if (sizeId === "5000_plus") {
      router.push("/book/custom-quote");
      return;
    }
    updateBookingData({ homeSizeId: sizeId });
  };

  const handleContinue = () => {
    if (!bookingData.homeSizeId) return;
    setCurrentStep(3);
    router.push("/book/offer");
  };

  const handleBack = () => {
    setCurrentStep(1);
    router.push("/");
  };

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
            <span className="text-muted-foreground">Step 2 of 5</span>
            <span className="font-medium">Home Size</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary glow-primary-sm rounded-full transition-all duration-500" style={{ width: "40%" }} />
          </div>
        </div>

        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <i className="ri-home-4-fill text-primary text-3xl"></i>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold mb-2">How big is your home?</h1>
          <p className="text-muted-foreground">Select your home size to see instant pricing</p>
        </div>

        {/* Size Selection */}
        <div className="grid gap-3 mb-6">
          {HOME_SIZE_RANGES.filter((size) => size.id !== "5000_plus").map((size) => {
            const isSelected = bookingData.homeSizeId === size.id;
            return (
              <Card
                key={size.id}
                onClick={() => handleSelect(size.id)}
                className={cn(
                  "cursor-pointer transition-all duration-300",
                  isSelected ? "card-selected" : "card-premium-hover"
                )}
              >
                <CardContent className="p-4 md:p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
                        isSelected ? "bg-primary text-white glow-primary-sm" : "bg-muted text-muted-foreground"
                      )}>
                        <i className="ri-home-line text-xl"></i>
                      </div>
                      <div>
                        <h3 className="font-semibold text-base">{size.label}</h3>
                        <p className="text-sm text-muted-foreground">{size.bedroomRange}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-primary">${size.standardPrice}</p>
                      <p className="text-xs text-muted-foreground">starting price</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Custom Quote Option */}
        <Card 
          onClick={() => router.push("/book/custom-quote")}
          className="cursor-pointer card-premium-hover border-dashed mb-8"
        >
          <CardContent className="p-4 md:p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center">
                  <i className="ri-building-line text-accent text-xl"></i>
                </div>
                <div>
                  <h3 className="font-semibold text-base">5,000+ sq ft</h3>
                  <p className="text-sm text-muted-foreground">Request a custom quote for larger homes</p>
                </div>
              </div>
              <i className="ri-arrow-right-line text-xl text-muted-foreground"></i>
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
            disabled={!bookingData.homeSizeId}
          >
            Continue
            <i className="ri-arrow-right-line ml-2"></i>
          </Button>
        </div>
      </main>
    </div>
  );
}

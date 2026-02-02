"use client";

import { useRouter } from "next/navigation";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ArrowRight, ArrowLeft, Home } from "lucide-react";
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
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto px-4 py-8">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
            <span>Step 2 of 5</span>
            <span>Home Size</span>
          </div>
          <div className="h-2 bg-muted rounded-full">
            <div className="h-full bg-primary rounded-full" style={{ width: "40%" }} />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Home className="w-5 h-5" />
              How big is your home?
            </CardTitle>
            <CardDescription>
              Select your home size to see pricing
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={bookingData.homeSizeId || ""}
              onValueChange={handleSelect}
              className="space-y-3"
            >
              {HOME_SIZE_RANGES.filter((size) => size.id !== "5000_plus").map((size) => (
                <div key={size.id} className="flex items-center">
                  <RadioGroupItem value={size.id} id={size.id} className="peer sr-only" />
                  <Label
                    htmlFor={size.id}
                    className="flex flex-1 items-center justify-between p-4 border rounded-lg cursor-pointer hover:bg-muted/50 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5"
                  >
                    <div>
                      <p className="font-medium">{size.label}</p>
                      <p className="text-sm text-muted-foreground">{size.bedroomRange}</p>
                    </div>
                    <p className="text-lg font-semibold">${size.standardPrice}</p>
                  </Label>
                </div>
              ))}
            </RadioGroup>

            <div className="mt-4 p-4 border rounded-lg bg-muted/30">
              <button
                onClick={() => router.push("/book/custom-quote")}
                className="w-full text-left"
              >
                <p className="font-medium">5,000+ sq ft</p>
                <p className="text-sm text-muted-foreground">
                  Request a custom quote for larger homes
                </p>
              </button>
            </div>

            <div className="flex gap-3 mt-6">
              <Button variant="outline" onClick={handleBack}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button
                className="flex-1"
                onClick={handleContinue}
                disabled={!bookingData.homeSizeId}
              >
                Continue
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function BookingZip() {
  const router = useRouter();
  const { updateBookingData, setCurrentStep } = useBooking();
  
  const [zipCode, setZipCode] = useState("");
  const [isValidating, setIsValidating] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (zipCode.length !== 5) {
      toast.error("Please enter a valid 5-digit ZIP code");
      return;
    }
    
    setIsValidating(true);

    try {
      await supabase
        .from("service_coverage_zones")
        .select("city, state")
        .eq("zip_code", zipCode)
        .eq("is_active", true)
        .maybeSingle();

      updateBookingData({ zipCode });
      setCurrentStep(2);
      router.push("/book/sqft");
    } catch (error) {
      console.error("ZIP validation error:", error);
      updateBookingData({ zipCode });
      setCurrentStep(2);
      router.push("/book/sqft");
    } finally {
      setIsValidating(false);
    }
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

      <main className="container max-w-md mx-auto px-4 py-12 md:py-16">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between text-sm mb-3">
            <span className="text-muted-foreground">Step 1 of 5</span>
            <span className="font-medium">Location</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary glow-primary-sm rounded-full transition-all duration-500" style={{ width: "20%" }} />
          </div>
        </div>

        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <i className="ri-map-pin-fill text-primary text-3xl"></i>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold mb-2">Check Availability</h1>
          <p className="text-muted-foreground">Enter your ZIP code to see if we service your area</p>
        </div>

        <Card className="card-premium card-glow">
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label className="text-sm font-medium">ZIP Code</Label>
                <div className="relative">
                  <i className="ri-map-pin-line absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-lg"></i>
                  <Input
                    type="text"
                    placeholder="Enter ZIP code"
                    value={zipCode}
                    onChange={(e) => setZipCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                    className="pl-11 h-14 text-lg border-2 focus:border-primary"
                    maxLength={5}
                    autoFocus
                  />
                </div>
              </div>

              <Button 
                type="submit" 
                className="w-full h-12 glow-primary-sm" 
                disabled={zipCode.length !== 5 || isValidating}
              >
                {isValidating ? (
                  <>
                    <i className="ri-loader-4-line animate-spin mr-2"></i>
                    Checking...
                  </>
                ) : (
                  <>
                    Continue
                    <i className="ri-arrow-right-line ml-2"></i>
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MapPin, ArrowRight, Loader2, Sparkles } from "lucide-react";
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
      const { data: coverage } = await supabase
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
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-semibold">NovaraCleaning</span>
          </Link>
        </div>
      </header>

      <div className="container max-w-md mx-auto px-4 py-12">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
            <span>Step 1 of 5</span>
            <span>Location</span>
          </div>
          <div className="h-2 bg-muted rounded-full">
            <div className="h-full bg-primary rounded-full" style={{ width: "20%" }} />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              Check Availability
            </CardTitle>
            <CardDescription>
              Enter your ZIP code to see if we service your area
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="zip">ZIP Code</Label>
                <Input
                  id="zip"
                  type="text"
                  placeholder="Enter ZIP code"
                  value={zipCode}
                  onChange={(e) => setZipCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                  maxLength={5}
                  autoFocus
                />
              </div>

              <Button type="submit" className="w-full" disabled={zipCode.length !== 5 || isValidating}>
                {isValidating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Checking...
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

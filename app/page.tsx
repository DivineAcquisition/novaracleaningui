"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { formatPhoneNumber } from "@/lib/input-formatters";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function Home() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { updateBookingData } = useBooking();
  
  const [step, setStep] = useState<"zip" | "contact">("zip");
  const [zipCode, setZipCode] = useState("");
  const [cityState, setCityState] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleZipSubmit = async (e: React.FormEvent) => {
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

      if (coverage) {
        setCityState(`${coverage.city}, ${coverage.state}`);
      } else {
        setCityState("your area");
      }
      
      updateBookingData({ zipCode });
      setStep("contact");
    } catch (error) {
      console.error("ZIP validation error:", error);
      setCityState("your area");
      setStep("contact");
    } finally {
      setIsValidating(false);
    }
  };

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName || !lastName || !email || !phone) {
      toast.error("Please fill in all fields");
      return;
    }
    
    setIsSubmitting(true);
    const formattedPhone = phone.replace(/\D/g, "");

    updateBookingData({
      firstName,
      lastName,
      email,
      phone: formattedPhone,
    });

    router.push("/book/sqft");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-primary/[0.02] to-background">
      {/* Header */}
      <header className="border-b border-border/50 backdrop-blur-sm bg-background/80 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary glow-primary-sm flex items-center justify-center">
              <i className="ri-sparkling-2-fill text-white text-lg"></i>
            </div>
            <span className="font-semibold text-lg">NovaraCleaning</span>
          </Link>
          
          <div className="flex items-center gap-2">
            {user ? (
              <>
                <Link href="/account">
                  <Button variant="ghost" size="sm" className="gap-2">
                    <i className="ri-user-line"></i>
                    Account
                  </Button>
                </Link>
                <Button variant="outline" size="sm" onClick={signOut}>
                  Sign Out
                </Button>
              </>
            ) : (
              <Link href="/auth">
                <Button variant="outline" size="sm" className="gap-2">
                  <i className="ri-login-box-line"></i>
                  Sign In
                </Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="container mx-auto px-4 py-16 md:py-24">
        <div className="max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left Content */}
            <div className="text-center lg:text-left">
              <Badge variant="secondary" className="mb-6 gap-1.5 px-3 py-1.5 text-sm">
                <i className="ri-verified-badge-fill text-green-500"></i>
                Serving DFW Metro Area
              </Badge>
              
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-[1.1] mb-6">
                Professional
                <span className="block text-primary text-glow">Home Cleaning</span>
              </h1>
              
              <p className="text-lg text-muted-foreground mb-8 max-w-md mx-auto lg:mx-0">
                Book trusted, vetted cleaners in minutes. Satisfaction guaranteed or we&apos;ll re-clean for free.
              </p>

              {/* Trust Badges */}
              <div className="flex flex-wrap justify-center lg:justify-start gap-x-6 gap-y-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <i className="ri-shield-check-fill text-primary text-lg"></i>
                  <span>Insured & Bonded</span>
                </div>
                <div className="flex items-center gap-2">
                  <i className="ri-star-fill text-amber-500 text-lg"></i>
                  <span>5-Star Rated</span>
                </div>
                <div className="flex items-center gap-2">
                  <i className="ri-time-fill text-primary text-lg"></i>
                  <span>Same-Day Available</span>
                </div>
              </div>
            </div>

            {/* Booking Card */}
            <div>
              <Card className="card-premium card-glow overflow-hidden">
                <div className="bg-gradient-to-r from-primary to-primary/80 p-6 text-white">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                      <i className="ri-calendar-check-fill text-xl"></i>
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold">Get Instant Pricing</h2>
                      <p className="text-white/70 text-sm">Takes less than 60 seconds</p>
                    </div>
                  </div>
                </div>

                <CardContent className="p-6">
                  {step === "zip" ? (
                    <form onSubmit={handleZipSubmit} className="space-y-5">
                      <div className="space-y-2">
                        <Label className="text-base font-medium">What&apos;s your ZIP code?</Label>
                        <div className="relative">
                          <i className="ri-map-pin-line absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-lg"></i>
                          <Input
                            type="text"
                            placeholder="Enter ZIP code"
                            value={zipCode}
                            onChange={(e) => setZipCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                            className="pl-11 h-12 text-base border-2 focus:border-primary"
                            maxLength={5}
                            autoFocus
                          />
                        </div>
                      </div>

                      <Button 
                        type="submit" 
                        className="w-full h-12 text-base glow-primary-sm" 
                        disabled={zipCode.length !== 5 || isValidating}
                      >
                        {isValidating ? (
                          <>
                            <i className="ri-loader-4-line animate-spin mr-2"></i>
                            Checking...
                          </>
                        ) : (
                          <>
                            Check Availability
                            <i className="ri-arrow-right-line ml-2"></i>
                          </>
                        )}
                      </Button>

                      <p className="text-xs text-center text-muted-foreground">
                        <i className="ri-lock-line mr-1"></i>
                        No credit card required • Free quotes
                      </p>
                    </form>
                  ) : (
                    <form onSubmit={handleContactSubmit} className="space-y-4">
                      {/* ZIP Success Badge */}
                      <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950/30 rounded-xl border border-green-200 dark:border-green-900">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-green-500 glow-success flex items-center justify-center">
                            <i className="ri-check-line text-white"></i>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-green-700 dark:text-green-300">
                              We service {cityState}!
                            </p>
                            <p className="text-xs text-green-600 dark:text-green-400">ZIP: {zipCode}</p>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setStep("zip")}
                          className="text-green-600 hover:text-green-700 text-xs"
                        >
                          Change
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-sm">First Name</Label>
                          <div className="relative">
                            <i className="ri-user-line absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"></i>
                            <Input
                              value={firstName}
                              onChange={(e) => setFirstName(e.target.value)}
                              className="pl-9 h-11 border-2 focus:border-primary"
                              placeholder="John"
                            />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-sm">Last Name</Label>
                          <Input
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                            className="h-11 border-2 focus:border-primary"
                            placeholder="Doe"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-sm">Email</Label>
                        <div className="relative">
                          <i className="ri-mail-line absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"></i>
                          <Input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="pl-9 h-11 border-2 focus:border-primary"
                            placeholder="john@example.com"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-sm">Phone</Label>
                        <div className="relative">
                          <i className="ri-phone-line absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"></i>
                          <Input
                            type="tel"
                            value={phone}
                            onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
                            className="pl-9 h-11 border-2 focus:border-primary"
                            placeholder="(555) 123-4567"
                          />
                        </div>
                      </div>

                      <div className="flex gap-3 pt-2">
                        <Button 
                          type="button" 
                          variant="outline" 
                          onClick={() => setStep("zip")}
                          className="h-11"
                        >
                          <i className="ri-arrow-left-line mr-1"></i>
                          Back
                        </Button>
                        <Button 
                          type="submit" 
                          className="flex-1 h-11 glow-primary-sm" 
                          disabled={!firstName || !lastName || !email || !phone || isSubmitting}
                        >
                          {isSubmitting ? (
                            <>
                              <i className="ri-loader-4-line animate-spin mr-2"></i>
                              Please wait...
                            </>
                          ) : (
                            <>
                              Get Quote
                              <i className="ri-arrow-right-line ml-2"></i>
                            </>
                          )}
                        </Button>
                      </div>
                    </form>
                  )}
                </CardContent>
              </Card>

              {/* Social Proof */}
              <div className="flex items-center justify-center gap-4 mt-6 text-sm text-muted-foreground">
                <div className="flex -space-x-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent border-2 border-background flex items-center justify-center text-white text-xs font-medium"
                    >
                      {String.fromCharCode(64 + i)}
                    </div>
                  ))}
                </div>
                <div>
                  <div className="flex items-center gap-0.5 text-amber-500">
                    <i className="ri-star-fill"></i>
                    <i className="ri-star-fill"></i>
                    <i className="ri-star-fill"></i>
                    <i className="ri-star-fill"></i>
                    <i className="ri-star-fill"></i>
                  </div>
                  <p className="text-xs">500+ happy customers</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 mt-auto py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} NovaraCleaning. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, CheckCircle, MapPin, User, Phone, Mail, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatPhoneNumber } from "@/lib/input-formatters";
import { toast } from "sonner";

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
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-semibold">NovaraCleaning</span>
          </Link>
          
          <div className="flex items-center gap-2">
            {user ? (
              <>
                <Link href="/account">
                  <Button variant="ghost" size="sm">Account</Button>
                </Link>
                <Button variant="outline" size="sm" onClick={signOut}>Sign Out</Button>
              </>
            ) : (
              <Link href="/auth">
                <Button variant="outline" size="sm">Sign In</Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-12">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-2">Professional Cleaning</h1>
            <p className="text-muted-foreground">
              Get an instant quote in under 60 seconds
            </p>
          </div>

          {step === "zip" ? (
            <Card>
              <CardHeader>
                <CardTitle>Check Availability</CardTitle>
                <CardDescription>Enter your ZIP code to get started</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleZipSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="zip">ZIP Code</Label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="zip"
                        type="text"
                        placeholder="Enter ZIP code"
                        value={zipCode}
                        onChange={(e) => setZipCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                        className="pl-10"
                        maxLength={5}
                        autoFocus
                      />
                    </div>
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
          ) : (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Your Information</CardTitle>
                    <CardDescription>Tell us how to reach you</CardDescription>
                  </div>
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />
                    {zipCode}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleContactSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First Name</Label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          id="firstName"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          className="pl-10"
                          placeholder="John"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last Name</Label>
                      <Input
                        id="lastName"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        placeholder="Doe"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10"
                        placeholder="john@example.com"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="phone"
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
                        className="pl-10"
                        placeholder="(555) 123-4567"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => setStep("zip")}>
                      Back
                    </Button>
                    <Button type="submit" className="flex-1" disabled={!firstName || !lastName || !email || !phone || isSubmitting}>
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Please wait...
                        </>
                      ) : (
                        <>
                          Get Quote
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}

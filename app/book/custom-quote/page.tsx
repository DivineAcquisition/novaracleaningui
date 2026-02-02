"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export default function CustomQuote() {
  const router = useRouter();
  const { bookingData, setCurrentStep } = useBooking();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [firstName, setFirstName] = useState(bookingData.firstName || "");
  const [lastName, setLastName] = useState(bookingData.lastName || "");
  const [email, setEmail] = useState(bookingData.email || "");
  const [phone, setPhone] = useState(bookingData.phone || "");
  const [address, setAddress] = useState("");
  const [squareFootage, setSquareFootage] = useState("");
  const [additionalDetails, setAdditionalDetails] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!firstName || !lastName || !email || !phone || !address || !squareFootage) {
      toast.error("Please fill in all required fields");
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase.from("custom_quotes").insert({
        full_name: `${firstName} ${lastName}`,
        email,
        phone,
        address,
        sqft: parseInt(squareFootage) || 5000,
        notes: `First Name: ${firstName}, Last Name: ${lastName}. Additional Details: ${additionalDetails}`,
        status: "pending",
      });

      if (error) throw error;

      toast.success("Quote request submitted! We'll be in touch soon.");
      setCurrentStep(1);
      router.push("/");
    } catch (error: any) {
      console.error("Custom quote error:", error);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBack = () => {
    setCurrentStep(2);
    router.push("/book/sqft");
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

      <main className="container max-w-xl mx-auto px-4 py-8 md:py-12">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-accent/20 flex items-center justify-center mx-auto mb-4">
            <i className="ri-building-2-fill text-accent text-3xl"></i>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold mb-2">Request Custom Quote</h1>
          <p className="text-muted-foreground">
            For homes over 5,000 sq ft, we&apos;ll create a personalized quote
          </p>
        </div>

        <Card className="card-premium card-glow">
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">First Name</Label>
                  <div className="relative">
                    <i className="ri-user-line absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"></i>
                    <Input
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="John"
                      className="pl-9 h-12 border-2 focus:border-primary"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Last Name</Label>
                  <Input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Doe"
                    className="h-12 border-2 focus:border-primary"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Email</Label>
                <div className="relative">
                  <i className="ri-mail-line absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"></i>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="john@example.com"
                    className="pl-9 h-12 border-2 focus:border-primary"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Phone</Label>
                <div className="relative">
                  <i className="ri-phone-line absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"></i>
                  <Input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    className="pl-9 h-12 border-2 focus:border-primary"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Address</Label>
                <div className="relative">
                  <i className="ri-map-pin-line absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"></i>
                  <Input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="123 Main St, Dallas, TX"
                    className="pl-9 h-12 border-2 focus:border-primary"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Approximate Square Footage</Label>
                <div className="relative">
                  <i className="ri-ruler-line absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"></i>
                  <Input
                    type="number"
                    value={squareFootage}
                    onChange={(e) => setSquareFootage(e.target.value)}
                    placeholder="6000"
                    className="pl-9 h-12 border-2 focus:border-primary"
                    min="5000"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Additional Details (optional)</Label>
                <Textarea
                  value={additionalDetails}
                  onChange={(e) => setAdditionalDetails(e.target.value)}
                  placeholder="Tell us about your home, special requirements, or services needed..."
                  rows={4}
                  className="border-2 focus:border-primary resize-none"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" onClick={handleBack} className="h-12 px-6">
                  <i className="ri-arrow-left-line mr-2"></i>
                  Back
                </Button>
                <Button type="submit" className="flex-1 h-12 glow-primary-sm" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <i className="ri-loader-4-line animate-spin mr-2"></i>
                      Submitting...
                    </>
                  ) : (
                    <>
                      Submit Request
                      <i className="ri-send-plane-fill ml-2"></i>
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <p className="text-sm text-center text-muted-foreground mt-6">
          <i className="ri-time-line mr-1"></i>
          We typically respond within 24 hours
        </p>
      </main>
    </div>
  );
}

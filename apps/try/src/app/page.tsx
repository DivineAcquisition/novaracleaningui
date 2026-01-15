"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useBooking } from "./providers";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import {
  Sparkles,
  CheckCircle,
  Star,
  Shield,
  Clock,
  ArrowRight,
  Phone,
  Mail,
  MapPin,
  Loader2,
} from "lucide-react";

export default function LandingPage() {
  const router = useRouter();
  const { updateBookingData } = useBooking();
  const [step, setStep] = useState<"zip" | "lead">("zip");
  const [isLoading, setIsLoading] = useState(false);
  const [zipCode, setZipCode] = useState("");
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  });

  const handleZipSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!zipCode || zipCode.length !== 5) {
      toast.error("Please enter a valid 5-digit ZIP code");
      return;
    }

    setIsLoading(true);
    try {
      // Check service coverage
      const { data: coverage, error } = await supabase
        .from("service_coverage_zones")
        .select("*")
        .eq("zip_code", zipCode)
        .eq("status", "active")
        .single();

      if (error || !coverage) {
        toast.error("Sorry, we don't service that area yet. Enter your info and we'll notify you when we expand!");
        setStep("lead");
        return;
      }

      // ZIP is covered, proceed to lead capture
      updateBookingData({ zipCode });
      setStep("lead");
    } catch (error) {
      console.error("Error checking ZIP:", error);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.firstName || !formData.lastName || !formData.email || !formData.phone) {
      toast.error("Please fill in all fields");
      return;
    }

    setIsLoading(true);
    try {
      // Create lead in database
      const { error: leadError } = await supabase.from("leads").insert({
        email: formData.email,
        phone: formData.phone,
        first_name: formData.firstName,
        last_name: formData.lastName,
        zip_code: zipCode,
        source: "try.novaracleaning.com",
      });

      if (leadError) {
        console.error("Lead creation error:", leadError);
      }

      // Fire webhook for GHL/Zapier
      try {
        await supabase.functions.invoke("send-lead-capture-webhook", {
          body: {
            email: formData.email,
            phone: formData.phone,
            first_name: formData.firstName,
            last_name: formData.lastName,
            zip_code: zipCode,
            source: "try.novaracleaning.com",
          },
        });
      } catch (webhookError) {
        console.error("Webhook error:", webhookError);
      }

      // Update booking context and proceed
      updateBookingData({
        ...formData,
        zipCode,
      });

      router.push("/sqft");
    } catch (error) {
      console.error("Error submitting lead:", error);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold text-primary">NovaraCleaning</span>
          </div>
          <div className="hidden md:flex items-center gap-4">
            <a href="tel:+1234567890" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <Phone className="h-4 w-4" />
              (123) 456-7890
            </a>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left Content */}
            <div className="space-y-8">
              <Badge variant="secondary" className="text-sm px-4 py-2">
                🎉 New Year Special - Limited Time!
              </Badge>
              
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
                Professional House Cleaning
                <span className="text-primary block mt-2">Starting at $189/mo</span>
              </h1>
              
              <p className="text-xl text-muted-foreground max-w-lg">
                Join thousands of happy homeowners enjoying spotless homes. 
                Your first clean is included with membership!
              </p>

              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span>Background-checked cleaners</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span>100% satisfaction guarantee</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span>Eco-friendly products</span>
                </div>
              </div>

              {/* Trust Signals */}
              <div className="flex items-center gap-6 pt-4">
                <div className="flex items-center gap-1">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="h-5 w-5 fill-yellow-400 text-yellow-400" />
                  ))}
                  <span className="ml-2 font-semibold">4.9/5</span>
                </div>
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-blue-500" />
                  <span className="text-sm">Google Guaranteed</span>
                </div>
              </div>
            </div>

            {/* Right Form */}
            <Card className="shadow-2xl border-0 bg-white">
              <CardContent className="p-8">
                {step === "zip" ? (
                  <form onSubmit={handleZipSubmit} className="space-y-6">
                    <div className="text-center mb-6">
                      <h2 className="text-2xl font-bold">Get Your Quote</h2>
                      <p className="text-muted-foreground mt-1">
                        Enter your ZIP code to check availability
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="zipCode" className="text-base">ZIP Code</Label>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                        <Input
                          id="zipCode"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={5}
                          placeholder="Enter your ZIP code"
                          value={zipCode}
                          onChange={(e) => setZipCode(e.target.value.replace(/\D/g, ""))}
                          className="pl-10 h-14 text-lg"
                          autoFocus
                        />
                      </div>
                    </div>

                    <Button
                      type="submit"
                      size="lg"
                      className="w-full h-14 text-lg"
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <>
                          Check Availability
                          <ArrowRight className="ml-2 h-5 w-5" />
                        </>
                      )}
                    </Button>

                    <p className="text-center text-sm text-muted-foreground">
                      Takes less than 2 minutes to book
                    </p>
                  </form>
                ) : (
                  <form onSubmit={handleLeadSubmit} className="space-y-6">
                    <div className="text-center mb-6">
                      <h2 className="text-2xl font-bold">Almost There!</h2>
                      <p className="text-muted-foreground mt-1">
                        Enter your details to see available services
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="firstName">First Name</Label>
                        <Input
                          id="firstName"
                          placeholder="John"
                          value={formData.firstName}
                          onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                          className="h-12"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="lastName">Last Name</Label>
                        <Input
                          id="lastName"
                          placeholder="Smith"
                          value={formData.lastName}
                          onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                          className="h-12"
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                        <Input
                          id="email"
                          type="email"
                          placeholder="john@example.com"
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          className="pl-10 h-12"
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone</Label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                        <Input
                          id="phone"
                          type="tel"
                          placeholder="(555) 123-4567"
                          value={formData.phone}
                          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                          className="pl-10 h-12"
                          required
                        />
                      </div>
                    </div>

                    <Button
                      type="submit"
                      size="lg"
                      className="w-full h-14 text-lg"
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <>
                          Continue
                          <ArrowRight className="ml-2 h-5 w-5" />
                        </>
                      )}
                    </Button>

                    <p className="text-center text-xs text-muted-foreground">
                      By continuing, you agree to our Terms of Service and Privacy Policy.
                      We'll never spam you.
                    </p>
                  </form>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 bg-white">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-12">
            Why Choose NovaraCleaning?
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center p-6">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Shield className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Trusted Professionals</h3>
              <p className="text-muted-foreground">
                All cleaners are background-checked, insured, and trained to our high standards.
              </p>
            </div>
            <div className="text-center p-6">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Clock className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Flexible Scheduling</h3>
              <p className="text-muted-foreground">
                Book online 24/7. Easily reschedule or modify your appointments anytime.
              </p>
            </div>
            <div className="text-center p-6">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Satisfaction Guaranteed</h3>
              <p className="text-muted-foreground">
                Not happy? We'll come back and make it right, or your money back.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Promo Banner */}
      <section className="py-12 bg-gradient-to-r from-primary to-accent text-white">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-4">
            New Year Special: Save $50 on Your First Clean! 🎊
          </h2>
          <p className="text-xl opacity-90 mb-6">
            Use code <span className="font-bold bg-white/20 px-3 py-1 rounded">NEWYEAR</span> at checkout
          </p>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          >
            Claim Your Discount
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 bg-muted/50">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-primary" />
              <span className="font-semibold">NovaraCleaning</span>
            </div>
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} NovaraCleaning. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

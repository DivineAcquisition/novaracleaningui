"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Sparkles,
  CheckCircle,
  Star,
  Shield,
  Clock,
  ArrowRight,
  Phone,
  Loader2,
} from "lucide-react";

export default function TryLandingPage() {
  const router = useRouter();
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
      sessionStorage.setItem("booking_zip", zipCode);
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

      sessionStorage.setItem("booking_lead", JSON.stringify({ ...formData, zipCode }));
      router.push("/try/sqft");
    } catch (error) {
      console.error("Error submitting lead:", error);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            <span className="text-lg font-semibold text-primary">NovaraCleaning</span>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <a href="tel:+1234567890" className="gap-2">
              <Phone className="h-4 w-4" />
              <span className="hidden md:inline">(123) 456-7890</span>
            </a>
          </Button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="flex-1 container py-12 lg:py-20">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left Content */}
          <div className="space-y-6">
            <Badge variant="secondary" className="gap-1">
              🎉 New Year Special - Limited Time!
            </Badge>
            
            <h1 className="text-4xl lg:text-5xl font-bold tracking-tight">
              Professional House Cleaning
              <span className="text-primary block">Starting at $189/mo</span>
            </h1>
            
            <p className="text-lg text-muted-foreground max-w-md">
              Join thousands of happy homeowners enjoying spotless homes. 
              Your first clean is included with membership!
            </p>

            <div className="flex flex-col gap-2">
              {[
                "Background-checked cleaners",
                "100% satisfaction guarantee",
                "Eco-friendly products",
              ].map((feature, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                  <span>{feature}</span>
                </div>
              ))}
            </div>

            {/* Trust Signals */}
            <div className="flex items-center gap-6 pt-2">
              <div className="flex items-center gap-1">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
                ))}
                <span className="ml-1 text-sm font-medium">4.9/5</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <Shield className="h-4 w-4 text-blue-500" />
                <span>Google Guaranteed</span>
              </div>
            </div>
          </div>

          {/* Right Form */}
          <Card className="shadow-lg">
            <CardHeader className="text-center pb-4">
              <CardTitle>Get Your Quote</CardTitle>
              <CardDescription>
                {step === "zip" 
                  ? "Enter your ZIP code to check availability"
                  : "Enter your details to see available services"
                }
              </CardDescription>
            </CardHeader>
            <CardContent>
              {step === "zip" ? (
                <form onSubmit={handleZipSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="zipCode">ZIP Code</Label>
                    <Input
                      id="zipCode"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={5}
                      placeholder="Enter your ZIP code"
                      value={zipCode}
                      onChange={(e) => setZipCode(e.target.value.replace(/\D/g, ""))}
                      className="h-12 text-lg"
                      autoFocus
                    />
                  </div>

                  <Button
                    type="submit"
                    size="lg"
                    className="w-full"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Checking...
                      </>
                    ) : (
                      <>
                        Check Availability
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>

                  <p className="text-center text-xs text-muted-foreground">
                    Takes less than 2 minutes to book
                  </p>
                </form>
              ) : (
                <form onSubmit={handleLeadSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First Name</Label>
                      <Input
                        id="firstName"
                        placeholder="John"
                        value={formData.firstName}
                        onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
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
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="john@example.com"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="(555) 123-4567"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      required
                    />
                  </div>

                  <Button
                    type="submit"
                    size="lg"
                    className="w-full"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        Continue
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>

                  <p className="text-center text-xs text-muted-foreground">
                    By continuing, you agree to our Terms of Service and Privacy Policy.
                  </p>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Features Section */}
      <section className="border-t bg-muted/30 py-16">
        <div className="container">
          <h2 className="text-2xl font-bold text-center mb-10">
            Why Choose NovaraCleaning?
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: Shield,
                title: "Trusted Professionals",
                description: "All cleaners are background-checked, insured, and trained to our high standards.",
              },
              {
                icon: Clock,
                title: "Flexible Scheduling",
                description: "Book online 24/7. Easily reschedule or modify your appointments anytime.",
              },
              {
                icon: CheckCircle,
                title: "Satisfaction Guaranteed",
                description: "Not happy? We'll come back and make it right, or your money back.",
              },
            ].map((feature, i) => (
              <Card key={i} className="text-center border-0 shadow-none bg-transparent">
                <CardContent className="pt-6">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Promo Banner */}
      <section className="bg-primary text-primary-foreground py-10">
        <div className="container text-center space-y-4">
          <h2 className="text-2xl font-bold">
            New Year Special: Save $50 on Your First Clean! 🎊
          </h2>
          <p className="text-primary-foreground/90">
            Use code <Badge variant="secondary" className="mx-1 font-mono">NEWYEAR</Badge> at checkout
          </p>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          >
            Claim Your Discount
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-6">
        <div className="container flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <span className="font-medium">NovaraCleaning</span>
          </div>
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} NovaraCleaning. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

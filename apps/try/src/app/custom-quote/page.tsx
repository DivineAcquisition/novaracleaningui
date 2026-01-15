"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";
import {
  Sparkles,
  ArrowLeft,
  Home,
  Send,
  CheckCircle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

export default function CustomQuotePage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    zipCode: "",
    sqft: "",
    details: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.firstName || !formData.email || !formData.phone || !formData.sqft) {
      toast.error("Please fill in all required fields");
      return;
    }

    setIsSubmitting(true);
    try {
      // Create lead
      const { error } = await supabase.from("leads").insert({
        email: formData.email,
        phone: formData.phone,
        first_name: formData.firstName,
        last_name: formData.lastName,
        zip_code: formData.zipCode,
        source: "custom-quote",
        notes: `Square footage: ${formData.sqft}. Additional details: ${formData.details}`,
      });

      if (error) throw error;

      // Fire webhook
      try {
        await supabase.functions.invoke("send-lead-capture-webhook", {
          body: {
            ...formData,
            source: "custom-quote",
            type: "large_home",
          },
        });
      } catch (webhookError) {
        console.error("Webhook error:", webhookError);
      }

      setIsSubmitted(true);
      toast.success("Quote request submitted!");
    } catch (error) {
      console.error("Submit error:", error);
      toast.error("Failed to submit. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 text-center space-y-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold">Quote Request Received!</h2>
            <p className="text-muted-foreground">
              Thanks for your interest! Our team will review your request and get back to you within 24 hours with a custom quote.
            </p>
            <Link href="/">
              <Button className="mt-4">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Home
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2">
            <Sparkles className="h-7 w-7 text-primary" />
            <span className="text-xl font-bold text-primary">NovaraCleaning</span>
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 max-w-2xl">
        <Link href="/sqft">
          <Button variant="ghost" className="mb-6">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>

        <Card>
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Home className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">Custom Quote Request</CardTitle>
            <CardDescription>
              For homes over 5,000 sq ft, we create personalized quotes to ensure you get the best service and pricing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name *</Label>
                  <Input
                    id="firstName"
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone *</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zipCode">ZIP Code</Label>
                  <Input
                    id="zipCode"
                    value={formData.zipCode}
                    onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sqft">Approximate Square Footage *</Label>
                <Input
                  id="sqft"
                  type="number"
                  placeholder="e.g., 6500"
                  value={formData.sqft}
                  onChange={(e) => setFormData({ ...formData, sqft: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="details">Additional Details</Label>
                <Textarea
                  id="details"
                  placeholder="Tell us about your home: number of bedrooms, bathrooms, any special requirements..."
                  value={formData.details}
                  onChange={(e) => setFormData({ ...formData, details: e.target.value })}
                  rows={4}
                />
              </div>

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Request Custom Quote
                  </>
                )}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                We typically respond within 24 hours with a personalized quote.
              </p>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

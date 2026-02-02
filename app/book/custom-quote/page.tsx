"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Home,
  Phone,
  Mail,
  User,
  CheckCircle,
  Loader2,
  ArrowLeft,
  Building,
} from "lucide-react";
import { BookingHeader } from "@/components/booking/BookingHeader";
import { BookingFooter } from "@/components/booking/BookingFooter";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export default function CustomQuote() {
  const router = useRouter();
  const { bookingData } = useBooking();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    firstName: bookingData.firstName || "",
    lastName: bookingData.lastName || "",
    email: bookingData.email || "",
    phone: bookingData.phone || "",
    squareFootage: "",
    propertyType: "",
    additionalDetails: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.firstName || !formData.email || !formData.phone) {
      toast.error("Please fill in all required fields");
      return;
    }

    setIsSubmitting(true);

    try {
      // Submit custom quote request
      const { error } = await supabase.from("custom_quotes").insert({
        full_name: `${formData.firstName} ${formData.lastName}`.trim(),
        email: formData.email,
        phone: formData.phone,
        address: bookingData.zipCode || "Not provided",
        sqft: parseInt(formData.squareFootage.replace(/,/g, "")) || 5000,
        notes: `Property Type: ${formData.propertyType}\n${formData.additionalDetails}`,
        status: "pending",
      });

      if (error) throw error;

      setIsSubmitted(true);
      toast.success("Quote request submitted!");
    } catch (error: any) {
      console.error("Quote submission error:", error);
      toast.error("Failed to submit. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-gradient-hero">
        <BookingHeader currentStep={2} totalSteps={6} stepLabel="Custom Quote" />

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="container max-w-lg mx-auto px-4 py-12"
        >
          <Card className="text-center border-0 shadow-xl">
            <CardContent className="p-8">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", delay: 0.2 }}
                className="mx-auto w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mb-6"
              >
                <CheckCircle className="w-10 h-10 text-white" />
              </motion.div>

              <h1 className="text-2xl font-bold mb-2">Request Received!</h1>
              <p className="text-muted-foreground mb-6">
                We&apos;ll contact you within 24 hours with a custom quote for your property.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 mb-6 text-left">
                <p className="text-sm text-muted-foreground mb-1">Submitted for:</p>
                <p className="font-medium">
                  {formData.firstName} {formData.lastName}
                </p>
                <p className="text-sm text-muted-foreground">{formData.email}</p>
              </div>

              <Button onClick={() => router.push("/")} className="w-full bg-gradient-primary">
                Return Home
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-hero pb-24">
      <BookingHeader currentStep={2} totalSteps={6} stepLabel="Custom Quote" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="container max-w-lg mx-auto px-4 py-8"
      >
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            className="mx-auto w-16 h-16 bg-gradient-primary rounded-2xl flex items-center justify-center mb-4 shadow-lg"
          >
            <Building className="w-8 h-8 text-white" />
          </motion.div>
          <h1 className="text-2xl md:text-3xl font-bold mb-2">Large Property Quote</h1>
          <p className="text-muted-foreground">
            For homes over 5,000 sq ft, we provide personalized quotes
          </p>
        </div>

        <Card className="border-0 shadow-xl">
          <CardHeader>
            <CardTitle className="text-lg">Tell us about your property</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="firstName">First Name *</Label>
                  <div className="relative mt-1">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="firstName"
                      value={formData.firstName}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, firstName: e.target.value }))
                      }
                      className="pl-10"
                      placeholder="John"
                      required
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="lastName">Last Name</Label>
                  <div className="relative mt-1">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="lastName"
                      value={formData.lastName}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, lastName: e.target.value }))
                      }
                      className="pl-10"
                      placeholder="Doe"
                    />
                  </div>
                </div>
              </div>

              <div>
                <Label htmlFor="email">Email *</Label>
                <div className="relative mt-1">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                    className="pl-10"
                    placeholder="john@example.com"
                    required
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="phone">Phone *</Label>
                <div className="relative mt-1">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))}
                    className="pl-10"
                    placeholder="(555) 123-4567"
                    required
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="sqft">Approximate Square Footage</Label>
                <div className="relative mt-1">
                  <Home className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="sqft"
                    value={formData.squareFootage}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, squareFootage: e.target.value }))
                    }
                    className="pl-10"
                    placeholder="e.g., 6,500"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="propertyType">Property Type</Label>
                <Input
                  id="propertyType"
                  value={formData.propertyType}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, propertyType: e.target.value }))
                  }
                  className="mt-1"
                  placeholder="e.g., Single family home, Estate, etc."
                />
              </div>

              <div>
                <Label htmlFor="details">Additional Details</Label>
                <Textarea
                  id="details"
                  value={formData.additionalDetails}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, additionalDetails: e.target.value }))
                  }
                  className="mt-1"
                  placeholder="Tell us about any special requirements..."
                  rows={4}
                />
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push("/book/sqft")}
                  className="flex-1"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 bg-gradient-primary"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    "Request Quote"
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>

      <BookingFooter />
    </div>
  );
}

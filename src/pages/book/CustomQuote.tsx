import {
  RiArrowLeftLine,
  RiCheckboxCircleLine,
  RiHomeLine,
  RiLoader4Line
} from "@remixicon/react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatPhoneNumber, getRawPhoneNumber, isValidPhoneNumber } from "@/lib/input-formatters";
import { SEO } from "@/components/SEO";

export default function CustomQuote() {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    address: '',
    sqft: '',
    notes: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'phone') {
      setFormData(prev => ({
        ...prev,
        [name]: formatPhoneNumber(value)
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isValidPhoneNumber(formData.phone)) {
      toast.error("Please enter a valid 10-digit phone number");
      return;
    }

    setIsSubmitting(true);

    try {
      const { data, error } = await supabase.functions.invoke('create-quote', {
        body: {
          fullName: formData.fullName,
          email: formData.email,
          phone: getRawPhoneNumber(formData.phone), // Store raw digits only
          address: formData.address,
          sqft: parseInt(formData.sqft),
          notes: formData.notes,
        },
      });

      if (error) throw error;

      setIsSuccess(true);
      toast.success('Quote request submitted successfully!');
    } catch (error: any) {
      console.error('Quote submission error:', error);
      toast.error(error.message || 'Failed to submit quote request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBack = () => {
    navigate("/book/home");
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-gradient-hero flex items-center justify-center px-4 py-12">
        <Card className="max-w-2xl w-full shadow-xl border-success/20">
          <CardHeader className="text-center space-y-4 pb-8">
            <div className="mx-auto w-20 h-20 bg-success/10 rounded-full flex items-center justify-center mb-4 animate-in zoom-in duration-500">
              <RiCheckboxCircleLine className="w-12 h-12 text-success" />
            </div>
            <CardTitle className="text-2xl md:text-4xl font-bold">Request Received!</CardTitle>
            <CardDescription className="text-sm md:text-base">
              We'll contact you within 24 hours with a custom quote
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-6">
            <div className="bg-gradient-to-br from-success/5 to-primary/5 rounded-lg p-6">
              <p className="text-center text-muted-foreground">
                Our team will review your home size and requirements to provide you with an accurate quote for your {formData.sqft}+ sq ft property.
              </p>
            </div>
            
            <Button
              size="lg"
              className="w-full h-14 text-base font-semibold bg-gradient-primary shadow-neon"
              onClick={() => navigate("/")}
            >
              Return to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-hero">
      <SEO title="Custom Quote" description="Request a custom quote for homes over 5,000 sq ft. We'll get back to you within 24 hours." />
      <div className="container max-w-3xl mx-auto px-4 py-12">
        <Card className="shadow-xl">
          <CardHeader className="text-center space-y-2 pb-8">
            <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <RiHomeLine className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="text-xl md:text-3xl font-bold">Request a Custom Quote</CardTitle>
            <CardDescription className="text-sm">
              For homes over 5,000 sq ft, we provide personalized quotes
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full Name *</Label>
                  <Input
                    id="fullName"
                    name="fullName"
                    value={formData.fullName}
                    onChange={handleChange}
                    required
                    placeholder="John Doe"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email *</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    value={formData.email}
                    onChange={handleChange}
                    required
                    placeholder="john@example.com"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number *</Label>
                  <Input
                    id="phone"
                    name="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={handleChange}
                    required
                    placeholder="(555) 123-4567"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sqft">Approximate Square Footage *</Label>
                  <Input
                    id="sqft"
                    name="sqft"
                    type="number"
                    min="5000"
                    value={formData.sqft}
                    onChange={handleChange}
                    required
                    placeholder="6500"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Property Address *</Label>
                <Input
                  id="address"
                  name="address"
                  value={formData.address}
                  onChange={handleChange}
                  required
                  placeholder="123 Main St, City, State ZIP"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Additional Notes (Optional)</Label>
                <Textarea
                  id="notes"
                  name="notes"
                  value={formData.notes}
                  onChange={handleChange}
                  placeholder="Any specific requirements or questions..."
                  rows={4}
                />
              </div>

              <div className="flex gap-4 pt-6">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={handleBack}
                  disabled={isSubmitting}
                  className="h-14"
                >
                  <RiArrowLeftLine className="mr-2 w-5 h-5" />
                  Back
                </Button>
                <Button
                  type="submit"
                  size="lg"
                  className="flex-1 h-14 text-base font-semibold bg-gradient-primary shadow-lavender"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <RiLoader4Line className="mr-2 w-5 h-5 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    'Request Custom Quote'
                  )}
                </Button>
              </div>

              <p className="text-center text-xs text-muted-foreground">
                We'll review your request and contact you within 24 hours with a personalized quote
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
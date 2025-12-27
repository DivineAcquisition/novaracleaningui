import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { useUTMTracking } from "@/hooks/use-utm-tracking";
import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin, ArrowRight, ArrowLeft, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BookingProgressBar } from "@/components/booking/BookingProgressBar";

// Validation schemas
const contactSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(50, "Max 50 characters"),
  lastName: z.string().trim().min(1, "Last name is required").max(50, "Max 50 characters"),
  email: z.string().trim().email("Please enter a valid email"),
  phone: z.string().regex(/^\(\d{3}\) \d{3}-\d{4}$/, "Please enter a valid phone number"),
});

type ContactFormData = z.infer<typeof contactSchema>;

// Phone formatting helper
function formatPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export default function BookingZip() {
  const navigate = useNavigate();
  const { updateBookingData, setCurrentStep } = useBooking();
  const { getUTMData } = useUTMTracking();

  // Phase state
  const [phase, setPhase] = useState<1 | 2>(1);
  
  // ZIP code state
  const [zipCode, setZipCode] = useState("");
  const [zipValidating, setZipValidating] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);
  const [cityState, setCityState] = useState<{ city: string; state: string } | null>(null);

  // Contact form state
  const [contactForm, setContactForm] = useState<ContactFormData>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  });
  const [contactErrors, setContactErrors] = useState<Partial<Record<keyof ContactFormData, string>>>({});
  const [submitting, setSubmitting] = useState(false);

  // Handle ZIP validation
  const handleZipSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setZipError(null);

    if (zipCode.length !== 5 || !/^\d+$/.test(zipCode)) {
      setZipError("Please enter a valid 5-digit ZIP code");
      return;
    }

    setZipValidating(true);
    console.log("[BookingZip] Validating ZIP:", zipCode);

    try {
      const { data, error } = await supabase.functions.invoke("validate-zip", {
        body: { zipCode },
      });

      if (error) {
        console.error("[BookingZip] ZIP validation error:", error);
        setZipError("Error checking availability. Please try again.");
        return;
      }

      if (!data.valid) {
        setZipError(data.message || "We don't service this area yet.");
        return;
      }

      console.log("[BookingZip] ZIP validated:", data);
      setCityState({ city: data.city, state: data.state });
      toast.success(`Great news! We service ${data.city}, ${data.state}`);
      setPhase(2);
    } catch (err) {
      console.error("[BookingZip] Unexpected error:", err);
      setZipError("Something went wrong. Please try again.");
    } finally {
      setZipValidating(false);
    }
  };

  // Handle contact form submission
  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setContactErrors({});

    // Validate form
    const result = contactSchema.safeParse(contactForm);
    if (!result.success) {
      const errors: Partial<Record<keyof ContactFormData, string>> = {};
      result.error.errors.forEach((err) => {
        const field = err.path[0] as keyof ContactFormData;
        errors[field] = err.message;
      });
      setContactErrors(errors);
      return;
    }

    setSubmitting(true);
    console.log("[BookingZip] Submitting lead:", contactForm);

    try {
      // Get UTM tracking data
      const utmData = getUTMData();

      // Prepare payload
      const payload = {
        firstName: contactForm.firstName.trim(),
        lastName: contactForm.lastName.trim(),
        email: contactForm.email.trim().toLowerCase(),
        phone: contactForm.phone,
        zipCode,
        city: cityState?.city || "",
        state: cityState?.state || "",
        landingPage: utmData.landingPage || window.location.pathname,
        referrer: utmData.referrer || document.referrer,
        timestamp: new Date().toISOString(),
        utmSource: utmData.utmSource,
        utmMedium: utmData.utmMedium,
        utmCampaign: utmData.utmCampaign,
        utmContent: utmData.utmContent,
        utmTerm: utmData.utmTerm,
      };

      // Send to lead webhook (non-blocking)
      supabase.functions.invoke("emit-lead-webhook", { body: payload })
        .then(({ error }) => {
          if (error) console.error("[BookingZip] Lead webhook error:", error);
          else console.log("[BookingZip] Lead webhook sent successfully");
        });

      // Update booking context
      updateBookingData({
        zipCode,
        firstName: contactForm.firstName.trim(),
        lastName: contactForm.lastName.trim(),
        email: contactForm.email.trim().toLowerCase(),
        phone: contactForm.phone,
        city: cityState?.city,
        state: cityState?.state,
      });

      toast.success("Welcome! Let's find the perfect cleaning for you.");

      // Navigate after short delay
      setTimeout(() => {
        setCurrentStep(2);
        navigate("/book/sqft");
      }, 500);
    } catch (err) {
      console.error("[BookingZip] Submit error:", err);
      toast.error("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  // Handle going back to ZIP entry
  const handleChangeZip = () => {
    setPhase(1);
    setCityState(null);
    setZipError(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <BookingProgressBar currentStep={1} totalSteps={6} />

      <div className="container max-w-md mx-auto px-4 py-8">
        <Card className="shadow-sm">
          <AnimatePresence mode="wait">
            {phase === 1 ? (
              <motion.div
                key="phase1"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
              >
                <CardHeader className="text-center pb-4">
                  <div className="mx-auto w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mb-3">
                    <MapPin className="w-7 h-7 text-primary" />
                  </div>
                  <CardTitle className="text-xl">Where do you need cleaning?</CardTitle>
                  <CardDescription>
                    Enter your ZIP code to check if we service your area
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleZipSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="zipCode">ZIP Code</Label>
                      <Input
                        id="zipCode"
                        type="text"
                        placeholder="Enter 5-digit ZIP"
                        value={zipCode}
                        onChange={(e) => {
                          setZipCode(e.target.value.replace(/\D/g, "").slice(0, 5));
                          setZipError(null);
                        }}
                        className="h-12 text-lg text-center tracking-widest"
                        maxLength={5}
                        autoFocus
                      />
                      {zipError && (
                        <p className="text-sm text-destructive">{zipError}</p>
                      )}
                    </div>
                    <Button
                      type="submit"
                      size="lg"
                      className="w-full h-12"
                      disabled={zipCode.length !== 5 || zipValidating}
                    >
                      {zipValidating ? (
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
                  </form>

                </CardContent>
              </motion.div>
            ) : (
              <motion.div
                key="phase2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <CardHeader className="text-center pb-4">
                  <div className="inline-flex items-center justify-center gap-2 text-primary text-sm font-medium mb-2">
                    <MapPin className="h-4 w-4" />
                    {cityState?.city}, {cityState?.state} {zipCode}
                  </div>
                  <CardTitle className="text-xl">Your Contact Info</CardTitle>
                  <CardDescription>
                    We'll use this to confirm your booking
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleContactSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="firstName">First Name</Label>
                        <Input
                          id="firstName"
                          placeholder="John"
                          value={contactForm.firstName}
                          onChange={(e) => setContactForm(prev => ({ ...prev, firstName: e.target.value }))}
                          className={contactErrors.firstName ? "border-destructive" : ""}
                        />
                        {contactErrors.firstName && (
                          <p className="text-xs text-destructive">{contactErrors.firstName}</p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="lastName">Last Name</Label>
                        <Input
                          id="lastName"
                          placeholder="Doe"
                          value={contactForm.lastName}
                          onChange={(e) => setContactForm(prev => ({ ...prev, lastName: e.target.value }))}
                          className={contactErrors.lastName ? "border-destructive" : ""}
                        />
                        {contactErrors.lastName && (
                          <p className="text-xs text-destructive">{contactErrors.lastName}</p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="john@example.com"
                        value={contactForm.email}
                        onChange={(e) => setContactForm(prev => ({ ...prev, email: e.target.value }))}
                        className={contactErrors.email ? "border-destructive" : ""}
                      />
                      {contactErrors.email && (
                        <p className="text-xs text-destructive">{contactErrors.email}</p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="phone">Phone</Label>
                      <Input
                        id="phone"
                        type="tel"
                        placeholder="(555) 555-5555"
                        value={contactForm.phone}
                        onChange={(e) => setContactForm(prev => ({ 
                          ...prev, 
                          phone: formatPhoneNumber(e.target.value) 
                        }))}
                        className={contactErrors.phone ? "border-destructive" : ""}
                      />
                      {contactErrors.phone && (
                        <p className="text-xs text-destructive">{contactErrors.phone}</p>
                      )}
                    </div>

                    <Button
                      type="submit"
                      size="lg"
                      className="w-full h-12"
                      disabled={submitting}
                    >
                      {submitting ? (
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

                    <button
                      type="button"
                      onClick={handleChangeZip}
                      className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1"
                    >
                      <ArrowLeft className="h-3 w-3" />
                      Change ZIP code
                    </button>
                  </form>
                </CardContent>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        {/* Terms notice */}
        <p className="text-xs text-center text-muted-foreground mt-6">
          By continuing, you agree to our{" "}
          <a href="/terms" className="underline hover:text-foreground">Terms of Service</a>
          {" "}and{" "}
          <a href="/privacy" className="underline hover:text-foreground">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}

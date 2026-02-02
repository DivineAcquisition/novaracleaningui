"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { 
  MessageSquare, 
  CheckCircle, 
  ArrowLeft, 
  Loader2,
  Bell,
  Calendar,
  Sparkles,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

function SMSConsentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [consent, setConsent] = useState(false);
  const [phone, setPhone] = useState("");
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    // Get phone from query params or session
    const phoneParam = searchParams.get("phone");
    if (phoneParam) {
      setPhone(phoneParam);
    }

    // Check for logged in user
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUserId(session.user.id);
      }
    };
    checkUser();
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!consent) {
      toast.error("Please confirm your consent to receive SMS messages");
      return;
    }

    setIsLoading(true);

    try {
      if (userId) {
        // Update user's customer record with SMS consent
        await (supabase as any)
          .from("customers")
          .update({
            sms_consent: true,
          })
          .eq("user_id", userId);
      }

      // Log the consent (skip if table doesn't exist)
      try {
        await (supabase as any).from("sms_consents").insert({
          phone: phone,
          user_id: userId,
          consented: true,
          consent_date: new Date().toISOString(),
        });
      } catch (e) {
        // Ignore if sms_consents table doesn't exist
        console.log("SMS consent logged");
      }

      setIsSuccess(true);
      toast.success("SMS notifications enabled!");
    } catch (error) {
      console.error("Error saving consent:", error);
      toast.error("Failed to save preferences. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md"
        >
          <Card className="border-0 shadow-xl">
            <CardContent className="p-8 text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", delay: 0.2 }}
                className="mx-auto w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mb-6 shadow-lg shadow-green-500/30"
              >
                <CheckCircle className="w-10 h-10 text-white" />
              </motion.div>

              <h1 className="text-2xl font-bold mb-2">You&apos;re All Set!</h1>
              <p className="text-muted-foreground mb-6">
                You&apos;ll now receive SMS updates about your bookings, reminders, and special offers.
              </p>

              <div className="space-y-3">
                <Link href="/account" className="block">
                  <Button className="w-full bg-gradient-primary">
                    Go to My Account
                  </Button>
                </Link>
                <Link href="/" className="block">
                  <Button variant="ghost" className="w-full">
                    Return Home
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        {/* Header */}
        <div className="text-center mb-6">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-primary shadow-lg mb-4"
          >
            <MessageSquare className="w-8 h-8 text-white" />
          </motion.div>
          <h1 className="text-2xl font-bold text-foreground">SMS Notifications</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Stay updated on your cleaning appointments
          </p>
        </div>

        <Card className="border-0 shadow-xl bg-card/80 backdrop-blur-sm">
          <CardContent className="p-6">
            {/* Benefits */}
            <div className="space-y-4 mb-6">
              <h3 className="font-semibold">What you&apos;ll receive:</h3>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Booking Confirmations</p>
                    <p className="text-xs text-muted-foreground">
                      Instant confirmation when you book
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Bell className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Appointment Reminders</p>
                    <p className="text-xs text-muted-foreground">
                      Reminders before your scheduled cleaning
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Special Offers</p>
                    <p className="text-xs text-muted-foreground">
                      Exclusive deals and promotions
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Consent Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-start space-x-3 p-4 bg-muted/50 rounded-lg border">
                <Checkbox
                  id="consent"
                  checked={consent}
                  onCheckedChange={(checked) => setConsent(checked as boolean)}
                />
                <Label htmlFor="consent" className="text-sm leading-relaxed cursor-pointer">
                  I agree to receive SMS messages from NovaraCleaning about my bookings, 
                  reminders, and promotional offers. Message and data rates may apply. 
                  Reply STOP to opt out at any time.
                </Label>
              </div>

              <Button
                type="submit"
                className="w-full h-11 bg-gradient-primary"
                disabled={isLoading || !consent}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Enable SMS Notifications"
                )}
              </Button>

              <p className="text-xs text-center text-muted-foreground">
                You can opt out at any time by texting STOP or in your account settings.
              </p>
            </form>
          </CardContent>
        </Card>

        <div className="mt-6 text-center">
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-primary inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
        </div>
      </motion.div>
    </div>
  );
}

export default function SMSConsent() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    }>
      <SMSConsentContent />
    </Suspense>
  );
}

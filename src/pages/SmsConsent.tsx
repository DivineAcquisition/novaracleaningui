"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatPhoneNumber } from "@/lib/input-formatters";
import { MessageSquare, Shield, Bell, Clock } from "lucide-react";

const SmsConsent = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    consent: false,
  });

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    setFormData({ ...formData, phone: formatted });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.consent) {
      toast.error("Please consent to receive SMS notifications");
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.functions.invoke("sms-consent", {
        body: {
          firstName: formData.firstName,
          lastName: formData.lastName,
          phone: formData.phone.replace(/\D/g, ""),
          email: formData.email,
          ipAddress: "",
          userAgent: navigator.userAgent,
        },
      });

      if (error) throw error;

      toast.success("SMS consent recorded successfully!");
      setTimeout(() => router.push("/cleaner/profile"), 2000);
    } catch (error: any) {
      console.error("Error submitting consent:", error);
      toast.error(error.message || "Failed to submit consent");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="container max-w-2xl py-12 px-4">
        <div className="mb-8 text-center">
          <MessageSquare className="mx-auto h-16 w-16 text-primary mb-4" />
          <h1 className="text-4xl font-bold text-foreground mb-2">SMS Notifications</h1>
          <p className="text-muted-foreground text-lg">
            Stay connected with instant updates about your jobs
          </p>
        </div>

        <Card className="card-outlined-hover mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-primary" />
              What You'll Receive
            </CardTitle>
            <CardDescription>
              We'll send you SMS notifications for:
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>New job offers and assignment updates</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>Booking confirmations and changes</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>Schedule reminders for upcoming jobs</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>Payment and earnings notifications</span>
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card className="card-outlined mb-6">
          <CardHeader>
            <CardTitle>SMS Consent Form</CardTitle>
            <CardDescription>
              Please provide your information to opt-in to SMS notifications
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name *</Label>
                  <Input
                    id="firstName"
                    required
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    placeholder="John"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name *</Label>
                  <Input
                    id="lastName"
                    required
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    placeholder="Doe"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number *</Label>
                <Input
                  id="phone"
                  type="tel"
                  required
                  value={formData.phone}
                  onChange={handlePhoneChange}
                  placeholder="(555) 555-5555"
                  maxLength={14}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email (optional)</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="john@example.com"
                />
              </div>

              <div className="space-y-4 pt-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="consent"
                    checked={formData.consent}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, consent: checked as boolean })
                    }
                    className="mt-1"
                  />
                  <div>
                    <label
                      htmlFor="consent"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      I consent to receive SMS notifications *
                    </label>
                    <p className="text-xs text-muted-foreground mt-1">
                      By checking this box and providing your phone number, you consent to receive
                      automated SMS/text messages from Novara Cleaning at the phone number
                      provided. Message frequency varies. Message and data rates may apply.
                    </p>
                  </div>
                </div>
              </div>

              <Button type="submit" disabled={loading} className="w-full" size="lg">
                {loading ? "Submitting..." : "Enable SMS Notifications"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="card-outlined bg-muted/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Shield className="h-5 w-5 text-primary" />
              Your Privacy & Rights
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p className="flex items-start gap-2">
              <Clock className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
              <span>
                <strong>Opt-out anytime:</strong> Reply STOP to any message to unsubscribe
                immediately
              </span>
            </p>
            <p>
              <strong>Need help?</strong> Reply HELP to any message for assistance
            </p>
            <p>
              <strong>Privacy:</strong> We will never share your phone number with third parties.
              Your information is protected and used only for service notifications.
            </p>
            <p className="text-xs pt-2 border-t">
              By opting in, you agree to our{" "}
              <a href="#" className="text-primary hover:underline">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="#" className="text-primary hover:underline">
                Privacy Policy
              </a>
              . Consent is not required to use our services.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default SmsConsent;

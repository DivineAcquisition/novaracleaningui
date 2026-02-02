"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  CheckCircle,
  Sparkles,
  Shield,
  Clock,
  Star,
  MapPin,
  User,
  Phone,
  Mail,
  Loader2,
  Home as HomeIcon,
  Award,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { formatPhoneNumber } from "@/lib/input-formatters";
import { toast } from "sonner";

const TRUST_BADGES = [
  { icon: Shield, label: "Insured & Bonded" },
  { icon: Award, label: "Google Guaranteed" },
  { icon: Star, label: "5-Star Rated" },
  { icon: Clock, label: "Same-Day Available" },
];

const FEATURES = [
  { title: "Professional Teams", desc: "Background-checked, trained cleaners" },
  { title: "All Supplies Included", desc: "We bring everything needed" },
  { title: "Satisfaction Guarantee", desc: "Free re-clean within 48 hours" },
];

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

  // Check if on app subdomain and redirect to auth
  useEffect(() => {
    if (typeof window !== "undefined") {
      const hostname = window.location.hostname;
      if (hostname.startsWith("app.") && !user) {
        router.push("/auth");
      }
    }
  }, [user, router]);

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

    // Send lead capture (fire and forget)
    supabase.functions
      .invoke("send-lead-capture-webhook", {
        body: {
          firstName,
          lastName,
          email,
          phone: formattedPhone,
          zipCode,
          city: cityState.split(", ")[0] || "",
          state: cityState.split(", ")[1] || "",
          source: "Website",
        },
      })
      .catch(console.error);

    router.push("/book/sqft");
  };

  const handleChangeZip = () => {
    setStep("zip");
    setZipCode("");
    setCityState("");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-purple-50/30 to-white">
      {/* Header */}
      <header className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-primary flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold">NovaraCleaning</span>
          </Link>
          
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <Link href="/account">
                  <Button variant="ghost" size="sm">
                    My Account
                  </Button>
                </Link>
                <Button variant="outline" size="sm" onClick={signOut}>
                  Sign Out
                </Button>
              </>
            ) : (
              <Link href="/auth">
                <Button variant="outline" size="sm">
                  Sign In
                </Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="container mx-auto px-4 py-12 md:py-20">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left Content */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
            >
              <Badge className="mb-4 bg-green-100 text-green-700 border-green-200">
                <CheckCircle className="w-3 h-3 mr-1" />
                Serving DFW Metro Area
              </Badge>
              
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-6">
                Professional Home
                <span className="block bg-gradient-to-r from-primary to-purple-500 bg-clip-text text-transparent">
                  Cleaning Services
                </span>
              </h1>
              
              <p className="text-lg text-muted-foreground mb-8 max-w-lg">
                Book trusted, vetted cleaners in minutes. Satisfaction guaranteed or we&apos;ll re-clean for free.
              </p>

              {/* Trust Badges */}
              <div className="flex flex-wrap gap-4 mb-8">
                {TRUST_BADGES.map((badge, i) => (
                  <motion.div
                    key={badge.label}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 + i * 0.1 }}
                    className="flex items-center gap-2 text-sm text-muted-foreground"
                  >
                    <badge.icon className="w-4 h-4 text-primary" />
                    <span>{badge.label}</span>
                  </motion.div>
                ))}
              </div>

              {/* Features - Desktop */}
              <div className="hidden lg:grid grid-cols-3 gap-4 mt-8">
                {FEATURES.map((feature, i) => (
                  <motion.div
                    key={feature.title}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 + i * 0.1 }}
                    className="p-4 rounded-xl bg-white border shadow-sm"
                  >
                    <h4 className="font-semibold text-sm mb-1">{feature.title}</h4>
                    <p className="text-xs text-muted-foreground">{feature.desc}</p>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* Right - Booking Card */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <Card className="border-0 shadow-2xl shadow-primary/10 overflow-hidden">
                <div className="bg-gradient-primary p-6 text-white">
                  <h2 className="text-2xl font-bold mb-1">Get Instant Pricing</h2>
                  <p className="text-white/80 text-sm">
                    See exact prices in under 60 seconds
                  </p>
                </div>

                <CardContent className="p-6">
                  <AnimatePresence mode="wait">
                    {step === "zip" ? (
                      <motion.form
                        key="zip"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        onSubmit={handleZipSubmit}
                        className="space-y-4"
                      >
                        <div>
                          <Label className="text-base font-semibold mb-2 block">
                            What&apos;s your ZIP code?
                          </Label>
                          <div className="relative">
                            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                            <Input
                              type="text"
                              placeholder="Enter ZIP code"
                              value={zipCode}
                              onChange={(e) => setZipCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                              className="pl-10 h-14 text-lg"
                              maxLength={5}
                              autoFocus
                            />
                          </div>
                        </div>

                        <Button
                          type="submit"
                          disabled={zipCode.length !== 5 || isValidating}
                          className="w-full h-14 text-lg bg-gradient-primary hover:opacity-90"
                        >
                          {isValidating ? (
                            <>
                              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                              Checking...
                            </>
                          ) : (
                            <>
                              Check Availability
                              <ArrowRight className="w-5 h-5 ml-2" />
                            </>
                          )}
                        </Button>

                        <p className="text-xs text-center text-muted-foreground">
                          No credit card required • Free quotes
                        </p>
                      </motion.form>
                    ) : (
                      <motion.form
                        key="contact"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        onSubmit={handleContactSubmit}
                        className="space-y-4"
                      >
                        {/* ZIP Success Badge */}
                        <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-200">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="w-5 h-5 text-green-600" />
                            <div>
                              <p className="text-sm font-medium text-green-700">
                                We service {cityState}!
                              </p>
                              <p className="text-xs text-green-600">ZIP: {zipCode}</p>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={handleChangeZip}
                            className="text-green-600 hover:text-green-700"
                          >
                            Change
                          </Button>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label>First Name</Label>
                            <div className="relative mt-1">
                              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                              <Input
                                value={firstName}
                                onChange={(e) => setFirstName(e.target.value)}
                                className="pl-10 h-12"
                                placeholder="John"
                              />
                            </div>
                          </div>
                          <div>
                            <Label>Last Name</Label>
                            <div className="relative mt-1">
                              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                              <Input
                                value={lastName}
                                onChange={(e) => setLastName(e.target.value)}
                                className="pl-10 h-12"
                                placeholder="Doe"
                              />
                            </div>
                          </div>
                        </div>

                        <div>
                          <Label>Email</Label>
                          <div className="relative mt-1">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                              type="email"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              className="pl-10 h-12"
                              placeholder="john@example.com"
                            />
                          </div>
                        </div>

                        <div>
                          <Label>Phone</Label>
                          <div className="relative mt-1">
                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                              type="tel"
                              value={phone}
                              onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
                              className="pl-10 h-12"
                              placeholder="(555) 123-4567"
                            />
                          </div>
                        </div>

                        <Button
                          type="submit"
                          disabled={!firstName || !lastName || !email || !phone || isSubmitting}
                          className="w-full h-14 text-lg bg-gradient-primary hover:opacity-90"
                        >
                          {isSubmitting ? (
                            <>
                              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                              Please wait...
                            </>
                          ) : (
                            <>
                              Get Instant Quote
                              <ArrowRight className="w-5 h-5 ml-2" />
                            </>
                          )}
                        </Button>

                        <p className="text-xs text-center text-muted-foreground">
                          By continuing, you agree to receive SMS updates
                        </p>
                      </motion.form>
                    )}
                  </AnimatePresence>
                </CardContent>
              </Card>

              {/* Social Proof */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
                className="flex items-center justify-center gap-6 mt-6"
              >
                <div className="flex -space-x-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-purple-500 border-2 border-white flex items-center justify-center text-white text-xs font-bold"
                    >
                      {String.fromCharCode(64 + i)}
                    </div>
                  ))}
                </div>
                <div className="text-sm">
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                  <p className="text-muted-foreground">500+ happy customers</p>
                </div>
              </motion.div>
            </motion.div>
          </div>

          {/* Features - Mobile */}
          <div className="lg:hidden grid grid-cols-1 sm:grid-cols-3 gap-4 mt-12">
            {FEATURES.map((feature, i) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + i * 0.1 }}
                className="p-4 rounded-xl bg-white border shadow-sm"
              >
                <h4 className="font-semibold text-sm mb-1">{feature.title}</h4>
                <p className="text-xs text-muted-foreground">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t mt-20 py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} NovaraCleaning. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

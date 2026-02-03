import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { 
  ArrowRight, 
  CheckCircle2, 
  Sparkles, 
  Clock, 
  Shield, 
  Star,
  Calendar,
  CreditCard,
  Home,
  Users,
  Zap,
  MapPin
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const FEATURES = [
  {
    icon: Clock,
    title: "On-Time Guarantee",
    description: "We show up when we say we will, every single time"
  },
  {
    icon: Shield,
    title: "Vetted Cleaners",
    description: "Background-checked and professionally trained"
  },
  {
    icon: CreditCard,
    title: "Easy Booking",
    description: "Book in under 2 minutes, pay securely online"
  },
  {
    icon: Star,
    title: "5-Star Service",
    description: "Consistently rated excellent by our customers"
  }
];

const PROCESS_STEPS = [
  {
    step: 1,
    title: "Enter Your ZIP",
    description: "Check if we service your area",
    icon: MapPin
  },
  {
    step: 2,
    title: "Select Home Size",
    description: "Tell us about your space",
    icon: Home
  },
  {
    step: 3,
    title: "Choose Service",
    description: "Pick standard, deep, or move cleaning",
    icon: Sparkles
  },
  {
    step: 4,
    title: "Pick Date & Time",
    description: "Schedule what works for you",
    icon: Calendar
  }
];

const TESTIMONIALS = [
  {
    name: "Sarah M.",
    location: "Dallas, TX",
    text: "Finally found cleaners who actually show up on time! My house has never looked better.",
    rating: 5
  },
  {
    name: "Mike R.",
    location: "Plano, TX",
    text: "The booking process was so easy. In 2 minutes I had my first clean scheduled.",
    rating: 5
  },
  {
    name: "Jennifer L.",
    location: "Frisco, TX",
    text: "Switched from another service and the difference is night and day. Highly recommend!",
    rating: 5
  }
];

const Index = () => {
  const navigate = useNavigate();
  const { updateBookingData } = useBooking();
  const [zipCode, setZipCode] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState("");

  const handleZipSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (zipCode.length !== 5) {
      setError("Please enter a valid 5-digit ZIP code");
      return;
    }

    setIsValidating(true);
    setError("");

    try {
      // Check if ZIP is in service coverage
      const { data: coverage } = await supabase
        .from('service_coverage_zones')
        .select('city, state')
        .eq('zip_code', zipCode)
        .eq('is_active', true)
        .single();

      // Update booking data with ZIP
      updateBookingData({ zipCode });

      // Navigate to sqft page
      navigate("/book/sqft");
    } catch (err) {
      // Still allow navigation even if lookup fails
      updateBookingData({ zipCode });
      navigate("/book/sqft");
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-lg">Novara</span>
          </div>
          <Badge variant="secondary" className="text-xs border border-green-500/20 bg-green-500/10 text-green-600">
            <Zap className="w-3 h-3 mr-1" />
            Book in 2 min
          </Badge>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-purple-500/5" />
        <div className="relative max-w-6xl mx-auto px-4 py-12 md:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Left: Hero Text + ZIP Entry */}
            <div className="space-y-6">
              <Badge className="bg-primary/10 text-primary border border-primary/20">
                Professional Home Cleaning
              </Badge>
              
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold leading-tight">
                Stop Spending Your Day Off{" "}
                <span className="text-primary">Scrubbing Bathrooms</span>
              </h1>
              
              <p className="text-lg text-muted-foreground">
                Professional cleaning that shows up on time, every time. 
                Book in under 2 minutes and reclaim your weekends.
              </p>

              {/* ZIP Entry Card */}
              <Card className="border border-border shadow-lg">
                <CardContent className="p-5">
                  <form onSubmit={handleZipSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        Enter your ZIP code to get started
                      </label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={5}
                            placeholder="12345"
                            value={zipCode}
                            onChange={(e) => {
                              setZipCode(e.target.value.replace(/\D/g, ''));
                              setError("");
                            }}
                            className={cn(
                              "h-12 pl-10 text-lg border",
                              error ? "border-destructive" : "border-border"
                            )}
                            autoFocus
                          />
                        </div>
                        <Button 
                          type="submit"
                          disabled={zipCode.length !== 5 || isValidating}
                          className="h-12 px-6 bg-gradient-to-r from-primary to-purple-600 border-0"
                        >
                          {isValidating ? "..." : "Get Quote"}
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                      </div>
                      {error && (
                        <p className="text-xs text-destructive">{error}</p>
                      )}
                    </div>
                  </form>

                  {/* Quick trust signals */}
                  <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      Free quotes
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      No commitment
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      Instant pricing
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right: Process Visual */}
            <div className="hidden lg:block">
              <Card className="border border-border shadow-xl bg-gradient-to-br from-muted/50 to-background">
                <CardContent className="p-6">
                  <div className="text-center mb-6">
                    <Badge variant="secondary" className="mb-2 border border-border">
                      How It Works
                    </Badge>
                    <h3 className="text-lg font-semibold">Book in 4 Simple Steps</h3>
                  </div>
                  
                  <div className="space-y-4">
                    {PROCESS_STEPS.map((step, index) => {
                      const Icon = step.icon;
                      return (
                        <div key={step.step} className="flex items-start gap-4">
                          <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border",
                            index === 0 
                              ? "bg-primary text-white border-primary" 
                              : "bg-muted text-muted-foreground border-border"
                          )}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{step.title}</p>
                            <p className="text-xs text-muted-foreground">{step.description}</p>
                          </div>
                          {index === 0 && (
                            <Badge className="ml-auto bg-green-500/10 text-green-600 border border-green-500/20 text-[10px]">
                              You are here
                            </Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-6 pt-6 border-t border-border text-center">
                    <p className="text-xs text-muted-foreground">
                      Average booking time: <span className="font-semibold text-foreground">1 min 47 sec</span>
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-12 md:py-16 border-t border-border bg-muted/30">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-bold mb-2">Why Choose Novara?</h2>
            <p className="text-muted-foreground">Professional cleaning you can actually count on</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {FEATURES.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <Card key={index} className="border border-border shadow-sm">
                  <CardContent className="p-4 md:p-5 text-center">
                    <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3 border border-primary/20">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <h3 className="font-semibold text-sm mb-1">{feature.title}</h3>
                    <p className="text-xs text-muted-foreground">{feature.description}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Social Proof Section */}
      <section className="py-12 md:py-16 border-t border-border">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-10">
            <div className="flex items-center justify-center gap-1 mb-2">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="w-5 h-5 fill-amber-400 text-amber-400" />
              ))}
            </div>
            <h2 className="text-2xl md:text-3xl font-bold mb-2">Loved by Homeowners</h2>
            <p className="text-muted-foreground">Join thousands of happy customers</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {TESTIMONIALS.map((testimonial, index) => (
              <Card key={index} className="border border-border shadow-sm">
                <CardContent className="p-5">
                  <div className="flex items-center gap-1 mb-3">
                    {[...Array(testimonial.rating)].map((_, i) => (
                      <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                  <p className="text-sm mb-4">"{testimonial.text}"</p>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <Users className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{testimonial.name}</p>
                      <p className="text-xs text-muted-foreground">{testimonial.location}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-12 md:py-16 border-t border-border bg-gradient-to-br from-primary/5 to-purple-500/5">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <h2 className="text-2xl md:text-3xl font-bold mb-4">
            Ready for a Cleaner Home?
          </h2>
          <p className="text-muted-foreground mb-6">
            Get your instant quote in less than 2 minutes. No commitment required.
          </p>

          {/* Second ZIP Entry */}
          <Card className="border border-border shadow-lg max-w-md mx-auto">
            <CardContent className="p-5">
              <form onSubmit={handleZipSubmit} className="space-y-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={5}
                      placeholder="Enter ZIP code"
                      value={zipCode}
                      onChange={(e) => {
                        setZipCode(e.target.value.replace(/\D/g, ''));
                        setError("");
                      }}
                      className="h-12 pl-10 text-lg border border-border"
                    />
                  </div>
                  <Button 
                    type="submit"
                    disabled={zipCode.length !== 5 || isValidating}
                    className="h-12 px-6 bg-gradient-to-r from-primary to-purple-600 border-0"
                  >
                    {isValidating ? "..." : "Start"}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-border bg-muted/30">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center">
                <Sparkles className="w-3 h-3 text-white" />
              </div>
              <span className="font-semibold text-sm">Novara Cleaning</span>
            </div>
            <div className="flex items-center gap-6 text-xs text-muted-foreground">
              <span>© 2024 Novara Cleaning</span>
              <a href="#" className="hover:text-foreground">Privacy</a>
              <a href="#" className="hover:text-foreground">Terms</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
